import { z } from 'zod';
import { defineTool, type ToolCtx } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError, assetRoleWordList } from '@sparksocial/shared';
import { rankTrends, scoreTrend, type RankedTrend } from './rank.js';
import { assessSafety } from './safety.js';
import { suggestRepurpose } from './repurpose.js';
import { Trend, TrendSourceName, type TrendSource, getTrendById } from './trend.js';

/**
 * `trend.rank` — PRD §8.9 `DISC-01`, plan §3.2 `trend.*`.
 *
 * PRD §7.3 names trend selection as one of the four decisions that *must* carry
 * a visible `why`. That is not decoration here: the product's claim is that it
 * skips the trends a brand should not touch, and a claim like that is only
 * credible if the user can see the reasoning on each one — including the
 * rejections, which is why excluded trends come back rather than vanishing.
 */

const RankedTrendOut = z.object({
  trendId: z.string(),
  source: TrendSourceName,
  topic: z.string(),
  score: z.number(),
  relevance: z.number(),
  opportunity: z.number(),
  metrics: Trend.shape.metrics,
  factors: z.array(z.object({ label: z.string(), detail: z.string(), weight: z.number().optional() })),
});

export const TrendRankInput = z.object({
  genomeId: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
  region: z.string().optional(),
  language: z.string().optional(),
});

export const TrendRankOutput = z.object({
  trends: z.array(RankedTrendOut),
  /** Surfaced, not hidden — the refusals are the product's argument. */
  excluded: z.array(
    z.object({
      trendId: z.string(),
      topic: z.string(),
      because: z.string(),
    }),
  ),
  why: Explanation,
});

export function makeTrendRank(source: TrendSource) {
  return defineTool({
    name: 'trend.rank',
    version: 1,

    summary:
      'Rank current trends for this brand by how much of the trend is left and how credibly the brand ' +
      'can join it — not by how big it already is. Removes trends that are unsafe for this brand. ' +
      'Read-only, cheap.',

    input: TrendRankInput,
    output: TrendRankOutput,

    effect: 'read',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor', 'approver'],
    idempotent: true,
    surfaces: ['DISC-01'],

    async handler(input, ctx) {
      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

      const fetched = await source.fetch({
        limit: Math.max(input.limit * 3, 20), // over-fetch: safety removes some
        ...(input.region ? { region: input.region } : {}),
        ...(input.language ? { language: input.language } : {}),
      });

      // Everything fetched, not just what survived ranking: a trend excluded
      // for this brand is still a trend whose numbers another brand's detail
      // screen will want the history of.
      await observe(fetched, ctx, new Date());

      const { ranked, excluded } = rankTrends(genome, fetched);
      const top = ranked.slice(0, input.limit);

      ctx.logger.info('trends ranked', {
        genomeId: input.genomeId,
        fetched: fetched.length,
        ranked: ranked.length,
        excluded: excluded.length,
      });

      return {
        trends: top.map(toOutput),
        excluded: excluded.map((r) => ({
          trendId: r.trend.id,
          topic: r.trend.topic,
          because: r.safety.safe
            ? 'nothing this brand can credibly say about it'
            : (r.safety.detail ?? r.safety.reasons.join(', ')),
        })),
        why: explain(top, excluded, source.name),
      };
    },
  });
}

/**
 * Records what a fetch just saw, so `DISC-02`'s time series exists.
 *
 * Called from the *read* paths on purpose. §8.9's series has to come from
 * somewhere, and the honest options are a dedicated poller or the traffic the
 * product already generates. It is both: `trend.observe` runs on a clock so the
 * series does not go blank overnight, and every `trend.rank` contributes a
 * sample so the resolution is better than the poll interval whenever anyone is
 * actually using the feed.
 *
 * Never allowed to fail the caller. A trend feed that 500s because a history
 * table was unavailable would be trading the feature for the telemetry about
 * the feature.
 */
async function observe(trends: Trend[], ctx: ToolCtx, now: Date): Promise<void> {
  if (trends.length === 0) return;
  try {
    await ctx.db.trendObservations.record(
      trends.map((t) => ({
        source: t.source,
        trendId: t.id,
        topic: t.topic,
        observedAt: now,
        volume: t.metrics.volume,
        velocity: t.metrics.velocity,
        saturation: t.metrics.saturation,
        growth: t.metrics.growth,
      })),
    );
  } catch (e) {
    ctx.logger.warn('trend observation not recorded', { error: e instanceof Error ? e.message : String(e) });
  }
}

function toOutput(r: RankedTrend) {
  return {
    trendId: r.trend.id,
    source: r.trend.source,
    topic: r.trend.topic,
    score: r.score,
    relevance: r.relevance,
    opportunity: r.opportunity,
    metrics: r.trend.metrics,
    factors: r.factors,
  };
}

/**
 * PRD §7.3's required explanation for trend selection.
 *
 * Leads with what was *rejected*, because that is the non-obvious half. Anyone
 * can show a user a list of popular topics; the claim worth explaining is why
 * four of them were removed.
 */
function explain(top: RankedTrend[], excluded: RankedTrend[], sourceName: string): Explanation {
  const best = top[0];

  return {
    summary: best
      ? `${best.trend.topic} — ${best.factors[0]?.detail ?? 'best available opportunity'}.` +
        (excluded.length ? ` ${excluded.length} other trend${excluded.length === 1 ? '' : 's'} skipped.` : '')
      : 'Nothing worth joining right now — every current trend is either saturated, off-brand, or unsafe for this brand.',
    factors: [
      { label: 'source', detail: sourceName },
      { label: 'ranked on', detail: 'how much of the trend is left × how credibly this brand can join it' },
      ...(excluded.length ? [{ label: 'skipped', detail: `${excluded.length}` }] : []),
    ],
    evidence: top.slice(0, 5).map((r) => ({
      kind: 'trend' as const,
      id: r.trend.id,
      note: `${r.trend.topic} (${Math.round(r.score * 100)}%)`,
    })),
    // The rejections, named individually. This is the part a user checks when
    // deciding whether to trust the feed.
    alternatives: excluded.slice(0, 5).map((r) => ({
      option: r.trend.topic,
      rejectedBecause: r.safety.safe
        ? 'nothing this brand can credibly say about it'
        : (r.safety.detail ?? r.safety.reasons.join(', ')),
    })),
  };
}

const READ_SCOPES = ['owner', 'admin', 'editor', 'approver'] as const;

/* ── trend.fetch ─────────────────────────────────────────────────────── */

export const TrendFetchInput = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  region: z.string().optional(),
  language: z.string().optional(),
});

export const TrendFetchOutput = z.object({ trends: z.array(Trend), source: z.string() });

export function makeTrendFetch(source: TrendSource) {
  return defineTool({
    name: 'trend.fetch',
    version: 1,

    summary:
      'Raw trend feed — unranked, unfiltered, not scored against any brand. `trend.rank` is what most ' +
      'callers want; this is the browse-everything escape hatch behind it.',

    input: TrendFetchInput,
    output: TrendFetchOutput,

    effect: 'read',
    autonomy: 'auto',
    scopes: [...READ_SCOPES],
    idempotent: true,
    surfaces: ['DISC-01'],

    async handler(input) {
      const trends = await source.fetch({
        limit: input.limit,
        ...(input.region ? { region: input.region } : {}),
        ...(input.language ? { language: input.language } : {}),
      });
      return { trends, source: source.name };
    },
  });
}

/* ── trend.observe ────────────────────────────────────────── */

export const TrendObserveInput = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  region: z.string().optional(),
  language: z.string().optional(),
});

export const TrendObserveOutput = z.object({
  observed: z.number(),
  source: z.string(),
  at: z.string(),
});

/**
 * The clock-driven half of §8.9's time series.
 *
 * `trend.rank` already records what it sees, which gives good resolution while
 * somebody is using the product and none at all overnight or on a quiet
 * weekend — and a gap in the middle of a series is worse than a coarse series,
 * because the chart has no way to show that the flat stretch is missing data
 * rather than a flat trend. This tool exists so the sampling interval is a
 * decision rather than a side effect of traffic.
 *
 * Takes no `genomeId`: it is measuring the outside world, and the rows it
 * writes are shared by every brand. That is also why it is not on any screen —
 * `surfaces` is empty and the only caller is the scheduler.
 */
export function makeTrendObserve(source: TrendSource) {
  return defineTool({
    name: 'trend.observe',
    version: 1,

    summary:
      'Sample every trend the source currently reports and append it to the shared metric history behind ' +
      'the DISC-02 time series. Not brand-specific and not on a screen — the scheduler is the only caller.',

    input: TrendObserveInput,
    output: TrendObserveOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin'],
    // Bucketed to the hour and last-write-wins, so running it twice in an hour
    // leaves the same rows behind as running it once.
    idempotent: true,

    async handler(input, ctx) {
      const now = new Date();
      const fetched = await source.fetch({
        limit: input.limit,
        ...(input.region ? { region: input.region } : {}),
        ...(input.language ? { language: input.language } : {}),
      });

      // Not via `observe()`: a scheduled sampler that swallowed its own write
      // failure would report success while the series quietly stopped growing.
      await ctx.db.trendObservations.record(
        fetched.map((t) => ({
          source: t.source,
          trendId: t.id,
          topic: t.topic,
          observedAt: now,
          volume: t.metrics.volume,
          velocity: t.metrics.velocity,
          saturation: t.metrics.saturation,
          growth: t.metrics.growth,
        })),
      );

      ctx.logger.info('trends observed', { source: source.name, observed: fetched.length });
      return { observed: fetched.length, source: source.name, at: now.toISOString() };
    },
  });
}

/* ── trend.detail ────────────────────────────────────────────────────── */

const SafetyOut = z.object({ safe: z.boolean(), reasons: z.array(z.string()), detail: z.string().optional() });
const FactorsOut = z.array(z.object({ label: z.string(), detail: z.string(), weight: z.number().optional() }));

export const TrendDetailInput = z.object({
  genomeId: z.string().min(1),
  trendId: z.string().min(1),
  /** How far back the §8.9 time series reaches. 14 days is two full weekly cycles. */
  seriesDays: z.number().int().min(1).max(90).default(14),
});

/** One point on the `DISC-02` chart. */
const SeriesPoint = z.object({
  at: z.string(),
  volume: z.number(),
  velocity: z.number(),
  saturation: z.number(),
  growth: z.number(),
});

export const TrendDetailOutput = z.object({
  trend: Trend,
  score: z.number(),
  relevance: z.number(),
  opportunity: z.number(),
  safety: SafetyOut,
  factors: FactorsOut,
  /**
   * §8.9's *"metrics + time series"*. Oldest first. Empty until the trend has
   * been seen more than once — and empty is the correct answer then, not a
   * flat line through today's value, which would read as "stable" when the
   * truth is "unknown".
   */
  series: z.array(SeriesPoint),
  /**
   * What the history says, in words, so the chart is not the only place the
   * direction is stated. Null when there is not yet enough history to say.
   */
  trajectory: z
    .object({
      direction: z.enum(['climbing', 'flat', 'cooling']),
      /** Change in saturation across the window, as a fraction. */
      saturationChange: z.number(),
      /** Change in volume across the window, as a multiple of the first point. */
      volumeChange: z.number().nullable(),
      observations: z.number(),
      spanHours: z.number(),
    })
    .nullable(),
  why: Explanation,
});

export function makeTrendDetail(source: TrendSource) {
  return defineTool({
    name: 'trend.detail',
    version: 1,

    summary: 'Full detail on one trend for this brand — the DISC-02 screen: samples, safety verdict, ' +
      'and the same scoring breakdown trend.rank uses, for a trend already known by id.',

    input: TrendDetailInput,
    output: TrendDetailOutput,

    effect: 'read',
    autonomy: 'auto',
    scopes: [...READ_SCOPES],
    idempotent: true,
    surfaces: ['DISC-02'],

    async handler(input, ctx) {
      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

      const trend = await getTrendById(source, input.trendId);
      if (!trend) throw new ToolError('NOT_FOUND', 'No such trend.', { trendId: input.trendId });

      // Record before reading, so opening the detail screen on a trend nobody
      // has ranked today still puts today's point on the chart.
      await observe([trend], ctx, new Date());

      const observations = await ctx.db.trendObservations
        .series({ source: trend.source, trendId: trend.id, sinceDays: input.seriesDays })
        .catch((e: unknown) => {
          ctx.logger.warn('trend series unavailable', { error: e instanceof Error ? e.message : String(e) });
          return [];
        });

      const scored = scoreTrend(genome, trend);
      const trajectory = summariseTrajectory(observations);
      return {
        trend,
        score: scored.score,
        relevance: scored.relevance,
        opportunity: scored.opportunity,
        safety: { safe: scored.safety.safe, reasons: scored.safety.reasons, ...(scored.safety.detail ? { detail: scored.safety.detail } : {}) },
        factors: scored.factors,
        series: observations.map((o) => ({
          at: o.observedAt.toISOString(),
          volume: o.volume,
          velocity: o.velocity,
          saturation: o.saturation,
          growth: o.growth,
        })),
        trajectory,
        why: explainOne(scored, source.name, trajectory),
      };
    },
  });
}

/* ── trend.safety_filter ─────────────────────────────────────────────── */

const SafetyFilterEntry = z.object({
  trendId: z.string().optional(),
  topic: z.string().optional(),
  tags: z.array(z.string()).default([]),
  language: z.string().optional(),
});

export const TrendSafetyFilterInput = z.object({
  genomeId: z.string().min(1),
  trends: z.array(SafetyFilterEntry).min(1).max(25),
});

export const TrendSafetyFilterOutput = z.object({
  results: z.array(
    z.object({
      trendId: z.string().optional(),
      topic: z.string(),
      safe: z.boolean(),
      reasons: z.array(z.string()),
      detail: z.string().optional(),
    }),
  ),
});

export function makeTrendSafetyFilter(source: TrendSource) {
  return defineTool({
    name: 'trend.safety_filter',
    version: 1,

    summary:
      'Standalone safety check for one or more trends or ad-hoc topics — the same hard-exclusion check ' +
      '`trend.rank` runs on every trend it sees, callable directly for a topic that is not (yet) a ' +
      'tracked trend.',

    input: TrendSafetyFilterInput,
    output: TrendSafetyFilterOutput,

    effect: 'read',
    autonomy: 'auto',
    scopes: [...READ_SCOPES],
    idempotent: true,

    async handler(input, ctx) {
      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

      const results = await Promise.all(
        input.trends.map(async (entry) => {
          let trend: Trend | undefined = entry.trendId ? await getTrendById(source, entry.trendId) : undefined;
          if (!trend) {
            if (!entry.topic) {
              throw new ToolError(
                'INVALID_INPUT',
                entry.trendId
                  ? `No such trend ${entry.trendId}, and no topic given to check it ad hoc.`
                  : 'Each entry needs a trendId or a topic.',
                { trendId: entry.trendId },
              );
            }
            trend = adhocTrend(entry.topic, entry.tags, entry.language);
          }
          const verdict = assessSafety(genome, trend);
          return {
            ...(entry.trendId ? { trendId: entry.trendId } : {}),
            topic: trend.topic,
            safe: verdict.safe,
            reasons: verdict.reasons,
            ...(verdict.detail ? { detail: verdict.detail } : {}),
          };
        }),
      );

      return { results };
    },
  });
}

function adhocTrend(topic: string, tags: string[], language?: string): Trend {
  return {
    id: 'adhoc',
    source: 'manual',
    topic,
    tags,
    metrics: { volume: 0, velocity: 0, saturation: 0, growth: 0 },
    samples: [],
    language: language ?? 'en',
  };
}

/* ── trend.repurpose ─────────────────────────────────────────────────── */

const RepurposeSuggestionOut = z.object({
  playbookId: z.string(),
  playbookName: z.string(),
  pillar: z.string(),
  mode: z.string(),
  intent: z.string(),
  unlockable: z.boolean(),
  missingRoles: z.array(z.string()),
  matchedOn: z.array(z.string()),
});

export const TrendRepurposeInput = z.object({ genomeId: z.string().min(1), trendId: z.string().min(1) });

export const TrendRepurposeOutput = z.object({
  suggestion: RepurposeSuggestionOut.nullable(),
  why: Explanation,
});

export function makeTrendRepurpose(source: TrendSource) {
  return defineTool({
    name: 'trend.repurpose',
    version: 1,

    summary:
      'Suggest the best-fit playbook this brand can actually run right now, plus an intent line, for ' +
      "joining a trend. Read-only — doesn't create anything; pass the suggested playbookId/intent to " +
      'content.draft to generate a real post.',

    input: TrendRepurposeInput,
    output: TrendRepurposeOutput,

    effect: 'read',
    autonomy: 'auto',
    scopes: [...READ_SCOPES],
    idempotent: true,
    surfaces: ['DISC-01', 'DISC-02'],

    async handler(input, ctx) {
      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

      const trend = await getTrendById(source, input.trendId);
      if (!trend) throw new ToolError('NOT_FOUND', 'No such trend.', { trendId: input.trendId });

      const safety = assessSafety(genome, trend);
      if (!safety.safe) {
        const because = safety.detail ?? safety.reasons.join(', ');
        return {
          suggestion: null,
          why: { summary: `Not safe to join — ${because}.`, factors: [{ label: 'safety', detail: because }], evidence: [], alternatives: [] },
        };
      }

      const assets = await ctx.db.assets.inventory(input.genomeId, ctx.orgId);
      const { suggestion, ranked } = suggestRepurpose(genome, assets, trend);

      if (!suggestion) {
        return {
          suggestion: null,
          why: { summary: 'No playbook fits this genome right now.', factors: [], evidence: [], alternatives: [] },
        };
      }

      return {
        suggestion,
        why: {
          summary: `${suggestion.playbookName} — ${suggestion.intent}`,
          factors: [
            { label: 'matched on', detail: suggestion.matchedOn.join(', ') || 'best available fit, no direct tag overlap' },
            { label: 'pillar', detail: suggestion.pillar },
          ],
          evidence: [{ kind: 'trend' as const, id: trend.id, note: trend.topic }],
          alternatives: ranked
            .filter((r) => r.playbook.playbook_id !== suggestion.playbookId)
            .slice(0, 3)
            .map((r) => ({
              option: r.playbook.name,
              rejectedBecause: r.unlockable ? `needs ${assetRoleWordList(r.missingRoles)} first` : 'lower match on this trend',
            })),
        },
      };
    },
  });
}

/* ── trend.reshare ───────────────────────────────────────────────────── */

const BeatWithAsset = z.object({ kind: z.string(), assetId: z.string().optional() }).passthrough();

const ReshareSuggestionOut = z.object({
  playbookId: z.string(),
  referencedAssetIds: z.array(z.string()),
  intent: z.string(),
});

export const TrendReshareInput = z.object({
  genomeId: z.string().min(1),
  trendId: z.string().min(1),
  contentItemId: z.string().min(1),
});

export const TrendReshareOutput = z.object({
  suggestion: ReshareSuggestionOut.nullable(),
  why: Explanation,
});

export function makeTrendReshare(source: TrendSource) {
  return defineTool({
    name: 'trend.reshare',
    version: 1,

    summary:
      'Suggest reframing an existing piece of content — its own assets, its own playbook — around a ' +
      'current trend, instead of generating something new. Read-only, same "call content.draft next" ' +
      'contract as trend.repurpose.',

    input: TrendReshareInput,
    output: TrendReshareOutput,

    effect: 'read',
    autonomy: 'auto',
    scopes: [...READ_SCOPES],
    idempotent: true,
    surfaces: ['DISC-01', 'DISC-02'],

    async handler(input, ctx) {
      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

      const item = await ctx.db.content.get(input.contentItemId, input.genomeId, ctx.orgId);
      if (!item) throw new ToolError('NOT_FOUND', 'No such content item.', { contentItemId: input.contentItemId });
      if (!item.playbookId) {
        throw new ToolError('INVALID_INPUT', 'This content item has no playbook to reuse.', { contentItemId: input.contentItemId });
      }

      const trend = await getTrendById(source, input.trendId);
      if (!trend) throw new ToolError('NOT_FOUND', 'No such trend.', { trendId: input.trendId });

      const safety = assessSafety(genome, trend);
      if (!safety.safe) {
        const because = safety.detail ?? safety.reasons.join(', ');
        return {
          suggestion: null,
          why: { summary: `Not safe to join — ${because}.`, factors: [{ label: 'safety', detail: because }], evidence: [], alternatives: [] },
        };
      }

      const parsed = z.array(BeatWithAsset).safeParse(item.copy);
      const referencedAssetIds = parsed.success
        ? parsed.data.filter((b) => b.kind === 'asset' && b.assetId).map((b) => b.assetId!)
        : [];

      return {
        suggestion: {
          playbookId: item.playbookId,
          referencedAssetIds,
          intent: `Reshare with a "${trend.topic}" framing`,
        },
        why: {
          summary: `Reusing ${referencedAssetIds.length || 'no'} asset${referencedAssetIds.length === 1 ? '' : 's'} from this post, reframed around "${trend.topic}".`,
          factors: [{ label: 'source item', detail: item.playbookId }],
          evidence: [{ kind: 'trend' as const, id: trend.id, note: trend.topic }],
          alternatives: [],
        },
      };
    },
  });
}

/* ── trend.watchlist ─────────────────────────────────────────────────── */

const WatchlistEntryOut = z.object({
  trendId: z.string(),
  source: z.string(),
  topic: z.string(),
  note: z.string().optional(),
  createdAt: z.string(),
});

export const TrendWatchlistInput = z.object({
  genomeId: z.string().min(1),
  action: z.enum(['add', 'remove', 'list']),
  trendId: z.string().min(1).optional(),
  topic: z.string().min(1).optional(),
  note: z.string().max(280).optional(),
});

export const TrendWatchlistOutput = z.object({ watchlist: z.array(WatchlistEntryOut) });

export function makeTrendWatchlist(source: TrendSource) {
  return defineTool({
    name: 'trend.watchlist',
    version: 1,

    summary:
      'Add, remove, or list the trends this brand is tracking over time. The one write in the trend.* ' +
      'family — everything else here is read-only.',

    input: TrendWatchlistInput,
    output: TrendWatchlistOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: true,
    surfaces: ['DISC-01', 'DISC-02'],

    async handler(input, ctx) {
      if (input.action === 'add') {
        if (!input.trendId) throw new ToolError('INVALID_INPUT', 'A trendId is required to add a watch.');
        const found = await getTrendById(source, input.trendId);
        const topic = found?.topic ?? input.topic;
        if (!topic) {
          throw new ToolError('INVALID_INPUT', 'This trend is not in the current feed — pass a topic to watch it anyway.', {
            trendId: input.trendId,
          });
        }
        await ctx.db.trends.add({
          genomeId: input.genomeId,
          orgId: ctx.orgId,
          trendId: input.trendId,
          source: found?.source ?? 'manual',
          topic,
          ...(input.note ? { note: input.note } : {}),
        });
      } else if (input.action === 'remove') {
        if (!input.trendId) throw new ToolError('INVALID_INPUT', 'A trendId is required to remove a watch.');
        await ctx.db.trends.remove({ genomeId: input.genomeId, orgId: ctx.orgId, trendId: input.trendId });
      }

      const watchlist = await ctx.db.trends.list(input.genomeId, ctx.orgId);
      return {
        watchlist: watchlist.map((w) => ({
          trendId: w.trendId,
          source: w.source,
          topic: w.topic,
          createdAt: w.createdAt.toISOString(),
          ...(w.note ? { note: w.note } : {}),
        })),
      };
    },
  });
}

/* ── trend.explain ───────────────────────────────────────────────────── */

export const TrendExplainInput = z.object({ genomeId: z.string().min(1), trendId: z.string().min(1) });
export const TrendExplainOutput = z.object({ why: Explanation });

export function makeTrendExplain(source: TrendSource) {
  return defineTool({
    name: 'trend.explain',
    version: 1,

    summary:
      'Just the why — the PRD §7.3 explanation for how one trend scored for this brand, or why it would ' +
      'be excluded. Same computation as trend.rank/trend.detail, returned alone for a WhyPopover that ' +
      'already has everything else.',

    input: TrendExplainInput,
    output: TrendExplainOutput,

    effect: 'read',
    autonomy: 'auto',
    scopes: [...READ_SCOPES],
    idempotent: true,

    async handler(input, ctx) {
      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

      const trend = await getTrendById(source, input.trendId);
      if (!trend) throw new ToolError('NOT_FOUND', 'No such trend.', { trendId: input.trendId });

      const scored = scoreTrend(genome, trend);
      return { why: explainOne(scored, source.name) };
    },
  });
}

function explainOne(r: RankedTrend, sourceName: string, trajectory?: Trajectory | null): Explanation {
  if (!r.safety.safe) {
    const because = r.safety.detail ?? r.safety.reasons.join(', ');
    return {
      summary: `Not safe to join — ${because}.`,
      factors: [{ label: 'safety', detail: because }],
      evidence: [{ kind: 'trend', id: r.trend.id, note: r.trend.topic }],
      alternatives: [],
    };
  }

  // The trajectory goes in front of the score when we have one. A 70% match
  // that is cooling and a 70% match that is climbing are the same number and
  // opposite decisions — which is the entire argument for §8.9's time series.
  const factors = trajectory ? [{ label: 'trajectory', detail: describeTrajectory(trajectory) }, ...r.factors] : r.factors;
  const lead = trajectory ? `${describeTrajectory(trajectory)}. ` : '';

  return {
    summary: `${r.trend.topic} — ${lead}${r.factors[0]?.detail ?? 'scored'} (${Math.round(r.score * 100)}% match).`,
    factors,
    evidence: [
      { kind: 'trend', id: r.trend.id, note: `source: ${sourceName}` },
      ...(trajectory
        ? [{ kind: 'trend' as const, id: r.trend.id, note: `${trajectory.observations} observations over ${trajectory.spanHours}h` }]
        : []),
    ],
    alternatives: [],
  };
}

/* ── the time series, read ────────────────────────────────────────── */

interface Trajectory {
  direction: 'climbing' | 'flat' | 'cooling';
  saturationChange: number;
  volumeChange: number | null;
  observations: number;
  spanHours: number;
}

/**
 * Direction is read off *saturation*, not volume.
 *
 * Volume is the tempting signal and the wrong one: a trend can keep growing in
 * absolute reach right up to the point where there is nothing left to say,
 * which is the trap §8.9's problem statement is about. Saturation rising means
 * the window is closing, whatever volume is doing.
 */
const SATURATION_NOISE = 0.03;

function summariseTrajectory(series: { observedAt: Date; volume: number; saturation: number }[]): Trajectory | null {
  // One point is not a trajectory. Reporting "flat" off a single observation
  // would be inventing a claim about the past out of a single measurement.
  if (series.length < 2) return null;

  const first = series[0]!;
  const last = series[series.length - 1]!;
  const saturationChange = last.saturation - first.saturation;
  const spanHours = Math.round((last.observedAt.getTime() - first.observedAt.getTime()) / 3_600_000);

  return {
    direction: saturationChange > SATURATION_NOISE ? 'cooling' : saturationChange < -SATURATION_NOISE ? 'climbing' : 'flat',
    saturationChange: Math.round(saturationChange * 1000) / 1000,
    volumeChange: first.volume > 0 ? Math.round((last.volume / first.volume) * 100) / 100 : null,
    observations: series.length,
    spanHours,
  };
}

function describeTrajectory(t: Trajectory): string {
  const window = t.spanHours >= 48 ? `${Math.round(t.spanHours / 24)}d` : `${t.spanHours}h`;
  const pct = Math.abs(Math.round(t.saturationChange * 100));
  if (t.direction === 'cooling') return `Closing — saturation up ${pct} points over the last ${window}`;
  if (t.direction === 'climbing') return `Still opening — saturation down ${pct} points over the last ${window}`;
  return `Holding — saturation flat over the last ${window}`;
}
