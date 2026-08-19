import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { analyticsCampaignReport } from '../src/campaignReport.js';

function snapshot(contentItemId: string, platform: string, likes: number, comments = 0, shares = 0) {
  return { contentItemId, platform, likes, comments, shares, views: 0, impressions: 0, syncedAt: new Date() };
}

function ctx(over: {
  campaignGet?: () => Promise<unknown>;
  slots?: () => Promise<Array<{ id: string }>>;
  listForItems?: () => Promise<unknown[]>;
} = {}): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      campaigns: {
        get: over.campaignGet ?? (async () => ({ id: 'camp_1', genomeId: 'gen_1' })),
        slots: over.slots ?? (async () => [{ id: 'ci_1' }, { id: 'ci_2' }]),
      },
      analytics: { listForItems: over.listForItems ?? (async () => []) },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('analytics.campaign_report', () => {
  it('sums totals and breaks down by platform across every slot', async () => {
    const out = await analyticsCampaignReport.handler(
      { campaignId: 'camp_1' },
      ctx({
        listForItems: async () => [
          snapshot('ci_1', 'instagram', 10, 2, 1),
          snapshot('ci_2', 'tiktok', 30, 5, 3),
          snapshot('ci_2', 'instagram', 5, 1, 0),
        ],
      }),
    );

    expect(out.totals).toEqual({ likes: 45, comments: 8, shares: 4, views: 0, impressions: 0 });
    expect(out.byPlatform).toEqual(
      expect.arrayContaining([
        { platform: 'instagram', likes: 15, comments: 3, shares: 1, views: 0, impressions: 0 },
        { platform: 'tiktok', likes: 30, comments: 5, shares: 3, views: 0, impressions: 0 },
      ]),
    );
    expect(out.postsWithMetrics).toBe(2);
  });

  it('ranks top posts by engagement (likes+comments+shares), highest first', async () => {
    const out = await analyticsCampaignReport.handler(
      { campaignId: 'camp_1' },
      ctx({
        listForItems: async () => [snapshot('ci_1', 'instagram', 10), snapshot('ci_2', 'instagram', 50)],
      }),
    );
    expect(out.topPosts[0]).toEqual({ contentItemId: 'ci_2', engagement: 50 });
    expect(out.topPosts[1]).toEqual({ contentItemId: 'ci_1', engagement: 10 });
  });

  it('does not compute or report a mix/plan comparison — that is campaign.report_vs_outcome\'s job', async () => {
    const out = await analyticsCampaignReport.handler({ campaignId: 'camp_1' }, ctx());
    expect(out).not.toHaveProperty('mix');
    expect(out).not.toHaveProperty('reweightSuggestion');
    expect(out).not.toHaveProperty('target');
  });

  it('handles a campaign with no slots yet without erroring', async () => {
    const out = await analyticsCampaignReport.handler({ campaignId: 'camp_1' }, ctx({ slots: async () => [] }));
    expect(out.totals).toEqual({ likes: 0, comments: 0, shares: 0, views: 0, impressions: 0 });
    expect(out.byPlatform).toEqual([]);
    expect(out.topPosts).toEqual([]);
  });

  it('throws NOT_FOUND for an unknown campaign', async () => {
    await expect(
      analyticsCampaignReport.handler({ campaignId: 'camp_missing' }, ctx({ campaignGet: async () => undefined })),
    ).rejects.toThrow(ToolError);
  });

  it('is a free read', () => {
    expect(analyticsCampaignReport.effect).toBe('read');
    expect(analyticsCampaignReport.idempotent).toBe(true);
  });
});
