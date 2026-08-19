import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';

/**
 * `analytics.post_metrics` — the read `analytics.sync`'s write has never had.
 * `campaign.report_vs_outcome` rolls metrics up across a whole campaign, but
 * there was no way to ask "how is this one post doing" directly — a
 * post-detail view had nowhere to read from except reassembling
 * `analytics.sync`'s own return value from wherever it was last logged.
 */

export const AnalyticsPostMetricsInput = z.object({
  genomeId: z.string().min(1),
  contentItemId: z.string().min(1),
});

const PlatformSnapshot = z.object({
  platform: z.string(),
  likes: z.number(),
  comments: z.number(),
  shares: z.number(),
  views: z.number(),
  impressions: z.number(),
  syncedAt: z.string(),
});

export const AnalyticsPostMetricsOutput = z.object({
  contentItemId: z.string(),
  synced: z.boolean(),
  platforms: z.array(PlatformSnapshot),
  totals: z.object({ likes: z.number(), comments: z.number(), shares: z.number(), views: z.number(), impressions: z.number() }),
});

export const analyticsPostMetrics = defineTool({
  name: 'analytics.post_metrics',
  version: 1,

  summary: 'Read the last synced performance snapshot(s) for one post, per platform it was synced on. Free.',

  input: AnalyticsPostMetricsInput,
  output: AnalyticsPostMetricsOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,

  async handler(input, ctx) {
    if (ctx.genomeId && input.genomeId !== ctx.genomeId) {
      throw new ToolError('ISOLATION_VIOLATION', 'That genome is not the one selected.', {
        claimed: input.genomeId,
        selected: ctx.genomeId,
      });
    }

    const item = await ctx.db.content.get(input.contentItemId, input.genomeId, ctx.orgId);
    if (!item) throw new ToolError('NOT_FOUND', 'No content item with that id in this genome.', { contentItemId: input.contentItemId });

    const rows = await ctx.db.analytics.listForItems([input.contentItemId], ctx.orgId, input.genomeId);
    const platforms = rows.map((r) => ({
      platform: r.platform,
      likes: r.likes,
      comments: r.comments,
      shares: r.shares,
      views: r.views,
      impressions: r.impressions,
      syncedAt: r.syncedAt.toISOString(),
    }));

    const totals = platforms.reduce(
      (acc, p) => ({
        likes: acc.likes + p.likes,
        comments: acc.comments + p.comments,
        shares: acc.shares + p.shares,
        views: acc.views + p.views,
        impressions: acc.impressions + p.impressions,
      }),
      { likes: 0, comments: 0, shares: 0, views: 0, impressions: 0 },
    );

    return { contentItemId: input.contentItemId, synced: platforms.length > 0, platforms, totals };
  },
});
