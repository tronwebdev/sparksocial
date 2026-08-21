import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ScopedDb, ToolCtx } from '@sparksocial/tools/defineTool';
import { analyticsSuccessMetrics } from '../src/successMetrics.js';

/**
 * PRD §5's fourteen metrics.
 *
 * The behaviour worth pinning is not the arithmetic — it is the *empty* cases.
 * A dashboard that reports 0% approval for a recipe nobody has reviewed, or a
 * two-minute reply SLA for an inbox nobody has answered, is confidently wrong,
 * and confidently wrong is worse than blank.
 */

type Rows = Awaited<ReturnType<ScopedDb['metrics']['successMetrics']>>;
type Calls = Awaited<ReturnType<ScopedDb['metrics']['toolActivity']>>;

const ROWS: Rows = {
  connectedAccounts: 0,
  campaignCount: 0,
  firstCampaignStartAt: null,
  firstPublishedAt: null,
  publishedInWindow: 0,
  postsWithTrackedLink: 0,
  postsFromTrends: 0,
  recipeCount: 0,
  outputsApproved: 0,
  outputsRejected: 0,
  messagesInWindow: 0,
  messagesResolved: 0,
  meanReplySeconds: null,
  opportunitiesInWindow: 0,
  opportunitiesRouted: 0,
  publishedEverBlocked: 0,
  rolledBack: 0,
  needsReview: 0,
};

const CALLS: Calls = {
  publishAttempts: 0,
  publishBlocked: 0,
  publishHeld: 0,
  draftCalls: 0,
  trendsRanked: 0,
  repurposeCalls: 0,
};

const ctx = (rows: Partial<Rows> = {}, calls: Partial<Calls> = {}): ToolCtx =>
  ({
    orgId: 'org_1',
    genomeId: 'gen_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 10_000 },
    db: {
      metrics: {
        successMetrics: async () => ({ ...ROWS, ...rows }),
        toolActivity: async () => ({ ...CALLS, ...calls }),
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  }) as unknown as ToolCtx;

const run = (rows: Partial<Rows> = {}, calls: Partial<Calls> = {}, windowDays = 28) =>
  analyticsSuccessMetrics.handler({ genomeId: 'gen_1', windowDays }, ctx(rows, calls));

describe('analytics.success_metrics — rates', () => {
  it('computes posts per week over the window, not over the month', async () => {
    const out = await run({ publishedInWindow: 12 }, {}, 28);
    expect(out.production.postsPublishedPerWeek).toBe(3);
  });

  it('measures time to first post from campaign activation, not from creation', async () => {
    // §5's metric is "after activation" — measuring from the row's creation
    // would credit SPARK with time nobody was waiting.
    const out = await run({
      firstCampaignStartAt: new Date('2026-08-01T09:00:00Z'),
      firstPublishedAt: new Date('2026-08-02T15:00:00Z'),
    });
    expect(out.activation.hoursToFirstPost).toBe(30);
  });

  it('reports the approval rate over decided outputs only', async () => {
    // 6 approved, 2 rejected, and however many still pending — a healthy recipe
    // nobody has got to yet must not read as a rejected one.
    const out = await run({ outputsApproved: 6, outputsRejected: 2 });
    expect(out.automation.outputApprovalRate).toBe(0.75);
  });

  it('counts both blocks and holds as prevented, over every attempt', async () => {
    const out = await run({}, { publishAttempts: 20, publishBlocked: 2, publishHeld: 3 });
    expect(out.trust.blockedOrHeld).toBe(5);
    expect(out.trust.preventedRate).toBe(0.25);
  });

  it('treats a rollback as the incident signal', async () => {
    // Nobody rolls back a post they were happy with, which makes it the only
    // honest signal that something reached a feed and should not have.
    const out = await run({ rolledBack: 2 });
    expect(out.trust.incidents).toBe(2);
    // The headline is asserted in the headline block below — with no campaign,
    // "nothing is measured yet" correctly outranks it.
  });

  it('reports trend-to-post against trends actually offered', async () => {
    const out = await run({ postsFromTrends: 3 }, { trendsRanked: 12, repurposeCalls: 6 });
    expect(out.discovery.trendToPostRate).toBe(0.25);
    expect(out.discovery.repurposeUsageRate).toBe(0.5);
  });

  it('converts the reply SLA to hours', async () => {
    const out = await run({ meanReplySeconds: 5_400 });
    expect(out.engagement.replySlaHours).toBe(1.5);
  });
});

describe('analytics.success_metrics — the empty cases', () => {
  it('reports null, not zero, for every rate with no denominator', async () => {
    const out = await run();
    expect(out.production.draftsPerPublishedPost).toBeNull();
    expect(out.discovery.trendToPostRate).toBeNull();
    expect(out.discovery.repurposeUsageRate).toBeNull();
    expect(out.automation.outputApprovalRate).toBeNull();
    expect(out.engagement.messagesResolvedRate).toBeNull();
    expect(out.engagement.nextActionTakenRate).toBeNull();
    expect(out.trust.preventedRate).toBeNull();
  });

  it('reports null for time-to-first-post when nothing has published', async () => {
    // A brand mid-first-week has not taken zero hours to publish.
    const out = await run({ firstCampaignStartAt: new Date('2026-08-01T00:00:00Z') });
    expect(out.activation.hoursToFirstPost).toBeNull();
  });

  it('reports null for the reply SLA when nothing has been answered', async () => {
    const out = await run({ messagesInWindow: 40, messagesResolved: 0 });
    expect(out.engagement.replySlaHours).toBeNull();
    expect(out.engagement.messagesResolvedRate).toBe(0);
  });
});

describe('analytics.success_metrics — the headline says what needs acting on', () => {
  it('leads with "no campaign" over everything else', async () => {
    const out = await run({ connectedAccounts: 0, campaignCount: 0 });
    expect(out.why.summary).toContain('no campaign');
  });

  it('leads with incidents once a campaign is running', async () => {
    const out = await run({ campaignCount: 1, connectedAccounts: 2, rolledBack: 1 });
    expect(out.why.summary).toContain('rolled back');
  });

  it('says so when SPARK is drafting into a void', async () => {
    // Planning and drafting with nothing connected is the single most confusing
    // state to be in, because the product looks like it is working.
    const out = await run({ campaignCount: 1, connectedAccounts: 0 });
    expect(out.why.summary).toContain('no account is connected');
  });

  it('flags a half-unanswered inbox', async () => {
    const out = await run({
      campaignCount: 1,
      connectedAccounts: 1,
      messagesInWindow: 30,
      messagesResolved: 6,
    });
    expect(out.why.summary).toContain('waiting');
  });

  it('otherwise reports cadence and what is queued', async () => {
    const out = await run({
      campaignCount: 1,
      connectedAccounts: 1,
      publishedInWindow: 8,
      needsReview: 2,
    });
    expect(out.why.summary).toContain('posts a week');
    expect(out.why.summary).toContain('awaiting review');
  });
});

describe('analytics.success_metrics — scope', () => {
  it('refuses a genome that is not the one selected', async () => {
    await expect(
      analyticsSuccessMetrics.handler({ genomeId: 'gen_other', windowDays: 30 }, ctx()),
    ).rejects.toThrow(ToolError);
  });

  it('is not readable by an agency’s client', async () => {
    // These numbers include a brand's failure modes. An agency's client seeing
    // the agency's miss rate is a commercial decision, not a product one.
    expect(analyticsSuccessMetrics.scopes).not.toContain('client');
  });
});
