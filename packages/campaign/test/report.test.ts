import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { AnalyticsStore, CampaignStore, ToolCtx } from '@sparksocial/tools';
import type { CampaignPlan } from '../src/plan.js';
import { campaignReportVsOutcome } from '../src/report.js';

/**
 * §6.8 Step 6 — "report against the stated outcome, reweight." The behaviours
 * that matter: volume/mix are real numbers computed from real slots, a stated
 * target is surfaced but never scored (no attainment signal exists yet), and
 * the reweight suggestion only fires when the imbalance is real, not noise.
 */

const START = new Date(Date.now() - 10 * 86_400_000); // 10 days into the window
const PLAN: CampaignPlan = {
  objective: 'bookings',
  windowDays: 30,
  buildableNow: 12,
  potentialWithCapture: 12,
  mix: [
    { pillar: 'community', count: 6 },
    { pillar: 'product', count: 3 },
    { pillar: 'personality', count: 3 },
  ],
  mixSource: 'cold_start',
  mixWhy: 'test',
  capture: null,
  readyPlaybookIds: [],
};

function slot(pillar: string, status: string) {
  return { id: `slot_${Math.random()}`, playbookId: 'pb_x', mode: 'assemble', pillar, status, scheduledAt: null, platform: null };
}

function campaignStore(over: {
  slots?: ReturnType<typeof slot>[];
  targetCount?: number;
  targetLabel?: string;
}): CampaignStore {
  return {
    async create() {
      throw new Error('not used in this test');
    },
    async get(campaignId, orgId) {
      if (orgId !== 'org_1') return undefined;
      return {
        id: campaignId,
        genomeId: 'gen_1',
        name: 'Test campaign',
        objective: 'bookings',
        windowDays: 30,
        startAt: START,
        status: 'active',
        plan: PLAN,
        ...(over.targetCount !== undefined ? { targetCount: over.targetCount } : {}),
        ...(over.targetLabel !== undefined ? { targetLabel: over.targetLabel } : {}),
      };
    },
    async listForGenome() {
      return [];
    },
    async replaceSlots() {
      return 0;
    },
    async slots() {
      return over.slots ?? [];
    },
    async setStatus() {},
  };
}

function ctx(campaigns: CampaignStore, analytics: Pick<AnalyticsStore, 'listForItems'>): ToolCtx {
  return {
    orgId: 'org_1',
    genomeId: 'gen_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      campaigns,
      analytics: { record: async () => { throw new Error('not used'); }, ...analytics },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('campaign.report_vs_outcome', () => {
  it('reports real volume and mix from actual slots, not the plan restated', async () => {
    const slots = [
      slot('community', 'published'),
      slot('community', 'published'),
      slot('community', 'scheduled'),
      slot('product', 'published'),
    ];
    const out = await campaignReportVsOutcome.handler(
      { campaignId: 'cmp_1' },
      ctx(campaignStore({ slots }), { listForItems: async () => [] }),
    );

    expect(out.volume).toEqual({ planned: 12, published: 3, scheduledRemaining: 1 });
    const community = out.mix.find((m) => m.pillar === 'community')!;
    expect(community).toEqual({ pillar: 'community', planned: 6, actual: 3, ratio: 0.5 });
  });

  it('never fabricates attainment against a stated target — reports it as not measurable', async () => {
    const out = await campaignReportVsOutcome.handler(
      { campaignId: 'cmp_1' },
      ctx(campaignStore({ slots: [], targetCount: 40, targetLabel: 'bookings' }), { listForItems: async () => [] }),
    );

    expect(out.target).toEqual({ count: 40, label: 'bookings' });
    expect(out.targetStatus).toBe('not_measurable');
    // The why must not claim a number it cannot back up.
    expect(out.why.summary).not.toMatch(/\d+ of 40/);
    expect(out.why.summary.toLowerCase()).toContain("can't say how close");
  });

  it('reports no_target honestly when none was set, rather than inventing one', async () => {
    const out = await campaignReportVsOutcome.handler(
      { campaignId: 'cmp_1' },
      ctx(campaignStore({ slots: [] }), { listForItems: async () => [] }),
    );
    expect(out.target).toBeNull();
    expect(out.targetStatus).toBe('no_target');
  });

  it('sums real engagement metrics across every slot in the campaign', async () => {
    const slots = [slot('community', 'published')];
    const out = await campaignReportVsOutcome.handler(
      { campaignId: 'cmp_1' },
      ctx(campaignStore({ slots }), {
        listForItems: async () => [
          { contentItemId: slots[0]!.id, platform: 'instagram', likes: 10, comments: 2, shares: 1, views: 100, impressions: 500, saves: 500, syncedAt: new Date() },
          { contentItemId: slots[0]!.id, platform: 'tiktok', likes: 5, comments: 0, shares: 0, views: 50, impressions: 200, saves: 200, syncedAt: new Date() },
        ],
      }),
    );

    expect(out.engagement).toEqual({ postsWithMetrics: 1, likes: 15, comments: 2, shares: 1, views: 150, impressions: 700 });
  });

  it('suggests a reweight only when one pillar is meaningfully ahead of another', async () => {
    // community delivered at 100% of plan, product at 0% — a real, large gap.
    const slots = [slot('community', 'published'), slot('community', 'published'), slot('community', 'published'), slot('community', 'published'), slot('community', 'published'), slot('community', 'published')];
    const out = await campaignReportVsOutcome.handler(
      { campaignId: 'cmp_1' },
      ctx(campaignStore({ slots }), { listForItems: async () => [] }),
    );

    expect(out.reweightSuggestion).not.toBeNull();
    expect(out.reweightSuggestion!.overDelivered).toBe('community');
    expect(out.reweightSuggestion!.underDelivered).toBe('product');
  });

  it('stays quiet when mix is roughly on plan — no manufactured advice', async () => {
    const slots = [slot('community', 'published'), slot('community', 'published'), slot('community', 'published'), slot('product', 'published'), slot('personality', 'published')];
    const out = await campaignReportVsOutcome.handler(
      { campaignId: 'cmp_1' },
      ctx(campaignStore({ slots }), { listForItems: async () => [] }),
    );
    expect(out.reweightSuggestion).toBeNull();
  });

  it('propagates NOT_FOUND for an unknown or out-of-scope campaign', async () => {
    await expect(
      campaignReportVsOutcome.handler(
        { campaignId: 'cmp_missing' },
        ctx(
          {
            ...campaignStore({ slots: [] }),
            async get() {
              return undefined;
            },
          },
          { listForItems: async () => [] },
        ),
      ),
    ).rejects.toThrow(ToolError);
  });

  it('is read-only and auto — reading a report is never a governance decision', () => {
    expect(campaignReportVsOutcome.effect).toBe('read');
    expect(campaignReportVsOutcome.autonomy).toBe('auto');
    expect(campaignReportVsOutcome.idempotent).toBe(true);
  });
});
