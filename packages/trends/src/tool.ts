import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import { rankTrends, type RankedTrend } from './rank.js';
import { Trend, TrendSourceName, type TrendSource } from './trend.js';

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
