import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';

/**
 * `analytics.campaign_report` — a plain metrics rollup for a campaign, not a
 * plan comparison. `campaign.report_vs_outcome` already exists and tells the
 * *story* (posts delivered vs. planned, pillar mix vs. planned, a reweight
 * suggestion) — this is deliberately narrower and does none of that. It
 * answers "what are the actual numbers for this campaign" — total and
 * per-platform engagement, and which posts are carrying it — for export or a
 * simple totals view, without pulling in the plan/mix machinery a numbers-only
 * reader doesn't need.
 */

export const AnalyticsCampaignReportInput = z.object({
  campaignId: z.string().min(1),
});

const PlatformTotal = z.object({
  platform: z.string(),
  likes: z.number(),
  comments: z.number(),
  shares: z.number(),
  views: z.number(),
  impressions: z.number(),
});

const TopPost = z.object({
  contentItemId: z.string(),
  engagement: z.number(),
});

export const AnalyticsCampaignReportOutput = z.object({
  campaignId: z.string(),
  postsWithMetrics: z.number(),
  totals: z.object({ likes: z.number(), comments: z.number(), shares: z.number(), views: z.number(), impressions: z.number() }),
  byPlatform: z.array(PlatformTotal),
  topPosts: z.array(TopPost),
});

const TOP_POSTS_LIMIT = 5;

export const analyticsCampaignReport = defineTool({
  name: 'analytics.campaign_report',
  version: 1,

  summary:
    'Plain engagement totals for a campaign — overall, per platform, and top posts by engagement. No plan ' +
    'comparison or reweight suggestion; see campaign.report_vs_outcome for that. Free.',

  input: AnalyticsCampaignReportInput,
  output: AnalyticsCampaignReportOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,

  async handler(input, ctx) {
    const campaign = await ctx.db.campaigns.get(input.campaignId, ctx.orgId);
    if (!campaign) throw new ToolError('NOT_FOUND', 'No such campaign.', { campaignId: input.campaignId });

    const slots = await ctx.db.campaigns.slots(campaign.id, ctx.orgId, campaign.genomeId);
    const contentItemIds = slots.map((s) => s.id);
    const rows = contentItemIds.length ? await ctx.db.analytics.listForItems(contentItemIds, ctx.orgId, campaign.genomeId) : [];

    const totals = rows.reduce(
      (acc, r) => ({
        likes: acc.likes + r.likes,
        comments: acc.comments + r.comments,
        shares: acc.shares + r.shares,
        views: acc.views + r.views,
        impressions: acc.impressions + r.impressions,
      }),
      { likes: 0, comments: 0, shares: 0, views: 0, impressions: 0 },
    );

    const byPlatformMap = new Map<string, { likes: number; comments: number; shares: number; views: number; impressions: number }>();
    for (const r of rows) {
      const cur = byPlatformMap.get(r.platform) ?? { likes: 0, comments: 0, shares: 0, views: 0, impressions: 0 };
      byPlatformMap.set(r.platform, {
        likes: cur.likes + r.likes,
        comments: cur.comments + r.comments,
        shares: cur.shares + r.shares,
        views: cur.views + r.views,
        impressions: cur.impressions + r.impressions,
      });
    }
    const byPlatform = [...byPlatformMap.entries()].map(([platform, t]) => ({ platform, ...t }));

    const engagementByItem = new Map<string, number>();
    for (const r of rows) {
      engagementByItem.set(r.contentItemId, (engagementByItem.get(r.contentItemId) ?? 0) + r.likes + r.comments + r.shares);
    }
    const topPosts = [...engagementByItem.entries()]
      .map(([contentItemId, engagement]) => ({ contentItemId, engagement }))
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, TOP_POSTS_LIMIT);

    return {
      campaignId: campaign.id,
      postsWithMetrics: engagementByItem.size,
      totals,
      byPlatform,
      topPosts,
    };
  },
});
