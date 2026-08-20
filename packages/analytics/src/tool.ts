import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';
import type { AnalyticsSource } from './source.js';

/**
 * `analytics.sync` — `CC-04`'s metrics pull (plan §3.2). Reads current
 * performance for one already-published post from the platform and stores a
 * snapshot in `content_metrics`, upserted by `(contentItemId, platform)`.
 *
 * Deliberately the only tool in the `analytics.*`/`learning.*` family built
 * so far. `analytics.post_metrics`/`campaign_report`/`cta_traffic` are reads
 * over what this writes and can be added without touching this tool;
 * `learning.*` (Thompson-sampling mix reweighting, PRD's outcome loop) is a
 * materially larger feature with no schema yet and is out of scope here — the
 * `analyst` agent's `toolScopes` still names it, tracked separately.
 */

export const AnalyticsSyncInput = z.object({
  genomeId: z.string().min(1),
  contentItemId: z.string().min(1),
});

export const AnalyticsSyncOutput = z.object({
  contentItemId: z.string(),
  platform: z.string(),
  likes: z.number(),
  comments: z.number(),
  shares: z.number(),
  views: z.number(),
  impressions: z.number(),
  saves: z.number(),
  syncedAt: z.string(),
});

export interface AnalyticsSyncDeps {
  source: AnalyticsSource;
}

export function makeAnalyticsSync(deps: AnalyticsSyncDeps) {
  return defineTool({
    name: 'analytics.sync',
    version: 1,

    summary:
      'Pull current performance (likes/comments/shares/views/impressions) for one published post from the ' +
      'platform and store a snapshot.',

    input: AnalyticsSyncInput,
    output: AnalyticsSyncOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: true,

    async handler(input, ctx) {
      // Same check `publish.now` makes: the input carries a genome for
      // convenience, the verified one is `ctx.genomeId`.
      if (ctx.genomeId && input.genomeId !== ctx.genomeId) {
        throw new ToolError('ISOLATION_VIOLATION', 'That genome is not the one selected.', {
          claimed: input.genomeId,
          selected: ctx.genomeId,
        });
      }

      const item = await ctx.db.content.get(input.contentItemId, input.genomeId, ctx.orgId);
      if (!item) {
        throw new ToolError('NOT_FOUND', 'No content item with that id in this genome.');
      }
      if (item.status !== 'published' || !item.platform || !item.externalId) {
        // Nothing to poll: a draft/scheduled item was never given a receipt by
        // `publish.now`, so there is no platform post id to ask about yet.
        throw new ToolError('INVALID_INPUT', 'Only a published post with a recorded receipt can be synced.', {
          status: item.status,
        });
      }

      const metrics = await deps.source.fetchMetrics({ platform: item.platform, externalId: item.externalId });

      const snapshot = await ctx.db.analytics.record({
        genomeId: input.genomeId,
        orgId: ctx.orgId,
        contentItemId: item.id,
        platform: item.platform,
        ...metrics,
        // `RawPostMetrics.saves` is optional on the vendor seam — a platform
        // that does not report saves must not have to invent a number, and
        // absent genuinely means none were reported.
        saves: metrics.saves ?? 0,
      });

      return {
        contentItemId: snapshot.contentItemId,
        platform: snapshot.platform,
        likes: snapshot.likes,
        comments: snapshot.comments,
        shares: snapshot.shares,
        views: snapshot.views,
        impressions: snapshot.impressions,
        saves: snapshot.saves,
        syncedAt: snapshot.syncedAt.toISOString(),
      };
    },
  });
}
