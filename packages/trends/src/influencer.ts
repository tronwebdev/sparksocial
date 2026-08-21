import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import { Trend, TrendSourceName } from './trend.js';
import { scoreTrend } from './rank.js';

/**
 * `trend.influencer.*` — the second of PRD §8.9's two watchlists.
 *
 *   *"Inputs/Config: Filters … Brand safety filter, Watchlist keywords,
 *   Influencer watchlist"*
 *
 * The keyword one has been real since P5 (`trend.watchlist`). This one had no
 * storage, no tool and no screen — and the reason it is a *feature* rather than
 * a list is the second tool here: watching an account has to mean something, and
 * what it means is that the account's recent posts become trend candidates,
 * scored by the same relevance and safety machinery `trend.rank` uses on
 * everything else.
 *
 * ── The seam, and why it is empty in this build ───────────────────────────
 *
 * Reading a named account's posts is a *listening* capability, so it sits behind
 * the same platform approvals as the engagement inbox — CLAUDE.md's scope note,
 * §8's integrations register. `InfluencerSource` is therefore a seam with no
 * configured implementation here, exactly like `PlatformAdapter` before the
 * aggregator and `MessageTransport` before the WhatsApp client: the watchlist,
 * the scoring and the screen are all real and testable today, and
 * `trend.influencer.review` refuses **by name** when nothing is configured
 * rather than returning a fabricated feed.
 *
 * That refusal is the honest half of this feature. A watchlist that silently
 * returned invented posts would be worse than one that says it cannot see them
 * yet.
 */

/** The platforms a handle can be watched on — `Platform` in `@sparksocial/publish`, minus the aggregator-only long tail. */
export const InfluencerPlatform = z.enum(['instagram', 'tiktok', 'linkedin', 'x', 'youtube_shorts']);
export type InfluencerPlatform = z.infer<typeof InfluencerPlatform>;

/**
 * One spelling per account.
 *
 * Platforms are inconsistent about the leading `@` and about case between their
 * own surfaces, and two rows for one account would show a brand watching
 * `@Competitor` and `competitor` as two different things — then fail to remove
 * either from the screen that displayed the other spelling.
 */
export function normaliseHandle(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}

/**
 * Where a watched account's recent posts come from.
 *
 * A seam for the same reason as `TrendSource`: every real implementation is
 * behind a credential and an approval, and the ranking is worth building now
 * and worth nothing if it cannot be tested without them.
 */
export interface InfluencerSource {
  readonly name: string;
  /** Recent posts by one account, shaped as trend candidates so `scoreTrend` applies unchanged. */
  recentPosts(args: { platform: string; handle: string; limit: number }): Promise<Trend[]>;
}

/* ── trend.influencer.watch ──────────────────────────────────────────── */

const WatchEntryOut = z.object({
  platform: InfluencerPlatform,
  handle: z.string(),
  displayName: z.string().optional(),
  note: z.string().optional(),
  createdAt: z.string(),
});

export const TrendInfluencerWatchInput = z
  .object({
    genomeId: z.string().min(1),
    action: z.enum(['add', 'remove', 'list']),
    platform: InfluencerPlatform.optional(),
    /** Accepted with or without the leading `@`, in any case — normalised before storage. */
    handle: z.string().min(1).max(120).optional(),
    note: z.string().max(280).optional(),
  })
  .refine((v) => v.action === 'list' || (v.platform !== undefined && v.handle !== undefined), {
    message: 'A platform and a handle are required to add or remove a watch.',
  });

export const TrendInfluencerWatchOutput = z.object({ watchlist: z.array(WatchEntryOut) });

export const trendInfluencerWatch = defineTool({
  name: 'trend.influencer.watch',
  version: 1,

  summary:
    'Add, remove, or list the accounts this brand is studying — competitors, customers, formats worth ' +
    'learning from. §8.9\'s influencer watchlist. Free.',

  input: TrendInfluencerWatchInput,
  output: TrendInfluencerWatchOutput,

  effect: 'write',
  autonomy: 'auto',
  /**
   * Not `viewer` or `client`, unlike the trend feed itself. A list of the
   * accounts a brand studies is frequently a list of its competitors — it is
   * strategy, not content, and an agency's client should not be handed the
   * agency's research on their rivals.
   */
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,
  surfaces: ['DISC-01'],

  async handler(input, ctx) {
    if (ctx.genomeId && input.genomeId !== ctx.genomeId) {
      throw new ToolError('ISOLATION_VIOLATION', 'That genome is not the one selected.', {
        claimed: input.genomeId,
        selected: ctx.genomeId,
      });
    }

    if (input.action === 'add') {
      const handle = normaliseHandle(input.handle!);
      if (!handle) throw new ToolError('INVALID_INPUT', 'That handle is empty once the @ is removed.', { handle: input.handle });
      await ctx.db.influencers.add({
        genomeId: input.genomeId,
        orgId: ctx.orgId,
        platform: input.platform!,
        handle,
        ...(input.note ? { note: input.note } : {}),
      });
    } else if (input.action === 'remove') {
      await ctx.db.influencers.remove({
        genomeId: input.genomeId,
        orgId: ctx.orgId,
        platform: input.platform!,
        // Normalised on the way out too — otherwise removing `@Competitor`
        // would miss the row stored as `competitor`.
        handle: normaliseHandle(input.handle!),
      });
    }

    const watchlist = await ctx.db.influencers.list(input.genomeId, ctx.orgId);
    return {
      watchlist: watchlist.map((w) => ({
        platform: w.platform as InfluencerPlatform,
        handle: w.handle,
        createdAt: w.createdAt.toISOString(),
        ...(w.displayName ? { displayName: w.displayName } : {}),
        ...(w.note ? { note: w.note } : {}),
      })),
    };
  },
});

/* ── trend.influencer.review ─────────────────────────────────────────── */

const ReviewedPost = z.object({
  platform: InfluencerPlatform,
  handle: z.string(),
  trendId: z.string(),
  topic: z.string(),
  source: TrendSourceName,
  score: z.number(),
  relevance: z.number(),
  opportunity: z.number(),
  safe: z.boolean(),
  /** Present when the safety check refused it — the reason, not just the verdict. */
  unsafeBecause: z.string().optional(),
  metrics: Trend.shape.metrics,
});

export const TrendInfluencerReviewInput = z.object({
  genomeId: z.string().min(1),
  /** Per watched account. Small on purpose: this is "what have they been doing", not an archive. */
  postsPerAccount: z.number().int().min(1).max(20).default(5),
  limit: z.number().int().min(1).max(50).default(15),
});

export const TrendInfluencerReviewOutput = z.object({
  posts: z.array(ReviewedPost),
  /** Accounts on the watchlist that produced nothing — a source failure or genuinely quiet. */
  quiet: z.array(z.object({ platform: InfluencerPlatform, handle: z.string(), because: z.string() })),
  why: Explanation,
});

/**
 * What the watched accounts have been posting, scored for *this* brand.
 *
 * The whole point of the watchlist: a competitor's post is only worth acting on
 * if this brand could credibly make something like it, which is the question
 * `scoreTrend` already answers for every other trend. Reusing it rather than
 * writing a second scorer is what stops "relevant to us" meaning two different
 * things in two places.
 *
 * Unsafe posts are returned, flagged, not filtered — same choice `trend.rank`
 * makes and for the same reason: the refusals are the product's argument, and a
 * competitor doing something this brand must not do is genuinely useful to see.
 */
export function makeTrendInfluencerReview(source: InfluencerSource | undefined) {
  return defineTool({
    name: 'trend.influencer.review',
    version: 1,

    summary:
      'What the accounts on this brand’s watchlist have posted recently, scored for relevance and brand ' +
      'safety the same way trend.rank scores anything else. Read-only.',

    input: TrendInfluencerReviewInput,
    output: TrendInfluencerReviewOutput,

    effect: 'read',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor', 'approver'],
    idempotent: true,
    surfaces: ['DISC-01'],

    async handler(input, ctx) {
      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

      const watchlist = await ctx.db.influencers.list(input.genomeId, ctx.orgId);
      if (watchlist.length === 0) {
        return {
          posts: [],
          quiet: [],
          why: {
            summary: 'No accounts are being watched yet.',
            factors: [],
            evidence: [],
            alternatives: [],
          },
        };
      }

      /**
       * Refused by name, not silently empty.
       *
       * Reading a named account's posts needs listening scopes nobody has
       * cleared in this build. Returning `posts: []` would be indistinguishable
       * from "your competitors have gone quiet", which is a materially wrong
       * thing to tell somebody.
       */
      if (!source) {
        throw new ToolError(
          'UPSTREAM_FAILED',
          'Reading a watched account’s posts needs platform listening access, which is not configured yet. ' +
            'The watchlist is saved and will be read as soon as it is.',
          { watching: watchlist.length },
        );
      }

      const posts: z.infer<typeof ReviewedPost>[] = [];
      const quiet: { platform: InfluencerPlatform; handle: string; because: string }[] = [];

      for (const account of watchlist) {
        let fetched: Trend[];
        try {
          fetched = await source.recentPosts({
            platform: account.platform,
            handle: account.handle,
            limit: input.postsPerAccount,
          });
        } catch (e) {
          // One unreachable account must not empty the whole review — and the
          // reason is reported rather than folded into "quiet", which would
          // read as a fact about them rather than about us.
          quiet.push({
            platform: account.platform as InfluencerPlatform,
            handle: account.handle,
            because: e instanceof Error ? e.message : String(e),
          });
          continue;
        }

        if (fetched.length === 0) {
          quiet.push({ platform: account.platform as InfluencerPlatform, handle: account.handle, because: 'nothing posted recently' });
          continue;
        }

        for (const trend of fetched) {
          const scored = scoreTrend(genome, trend);
          posts.push({
            platform: account.platform as InfluencerPlatform,
            handle: account.handle,
            trendId: trend.id,
            topic: trend.topic,
            source: trend.source,
            score: scored.score,
            relevance: scored.relevance,
            opportunity: scored.opportunity,
            safe: scored.safety.safe,
            ...(scored.safety.safe
              ? {}
              : { unsafeBecause: scored.safety.detail ?? scored.safety.reasons.join(', ') }),
            metrics: trend.metrics,
          });
        }
      }

      posts.sort((a, b) => b.score - a.score);
      const top = posts.slice(0, input.limit);

      return {
        posts: top,
        quiet,
        why: explainReview(top, quiet.length, watchlist.length, source.name),
      };
    },
  });
}

/**
 * §7.3's `why`. This is a selection, not an enumeration — the ordering asserts
 * "these are the ones worth your attention", and that judgement is the same one
 * `trend.rank` explains for the open feed.
 */
function explainReview(
  posts: z.infer<typeof ReviewedPost>[],
  quietCount: number,
  watched: number,
  sourceName: string,
): Explanation {
  const best = posts[0];
  const unsafe = posts.filter((p) => !p.safe).length;

  const summary = !best
    ? `Nothing from the ${watched} account${watched === 1 ? '' : 's'} you watch scored high enough to suggest.`
    : `${best.topic} from @${best.handle} scores highest (${Math.round(best.score * 100)}%).` +
      (unsafe > 0 ? ` ${unsafe} of these are things this brand should not copy.` : '');

  return {
    summary,
    factors: [
      { label: 'scored by', detail: 'the same relevance and safety check trend.rank applies to every other trend' },
      ...(quietCount > 0
        ? [{ label: 'quiet accounts', detail: `${quietCount} produced nothing — listed separately rather than counted as no signal` }]
        : []),
    ],
    evidence: best ? [{ kind: 'trend' as const, id: best.trendId, note: `source: ${sourceName}` }] : [],
    alternatives: [],
  };
}
