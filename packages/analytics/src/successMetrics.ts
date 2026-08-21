import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';

/**
 * `analytics.success_metrics` — PRD §5, all of it.
 *
 * §5 names fourteen metrics across six groups, and none of them were measured.
 * `tool_calls`, `content_items`, `engagement_messages`, `opportunities` and
 * `recipe_outputs` held the raw material for nearly all of them and nothing
 * aggregated any of it — which is the gap that made every *other* gap hard to
 * prioritise, because there was no number saying which one was hurting.
 *
 * ── What this deliberately does not do ─────────────────────────────────────
 *
 * §5's Activation group is phrased as percentages of a *population*: "% who
 * complete onboarding + connect ≥ 1 social account", "% who activate a
 * campaign". Those are company metrics across every customer, and a tenant-
 * scoped tool must not compute them — the numerator would require reading other
 * organizations' rows, which is exactly what `scoped.ts` exists to prevent.
 *
 * So this reports each brand's own activation *state* (has it connected an
 * account, has it activated a campaign, how long until its first post), which is
 * both the useful per-brand answer and the input a warehouse would aggregate to
 * get the percentage. The percentage belongs in the data layer §9 Tier 3 already
 * notes, not here.
 *
 * ── Honest about proxies ───────────────────────────────────────────────────
 *
 * Two of the fourteen are approximations, and each says so in its own field
 * rather than in a footnote nobody reads. See `draftsPerPublishedPost` and
 * `postsWithTrackedLink`.
 */

const WEEK_MS = 7 * 86_400_000;

export const SuccessMetricsInput = z.object({
  genomeId: z.string().min(1),
  /** The window every rate is computed over. 30 days matches the default campaign window. */
  windowDays: z.number().int().min(7).max(365).default(30),
});

const Activation = z.object({
  connectedAccounts: z.number().int(),
  /** §8.2's onboarding is complete when a genome exists and an account is connected. */
  onboardingComplete: z.boolean(),
  campaignActivated: z.boolean(),
  /**
   * §5's "Time to first post published automatically after activation", in
   * hours. Null when nothing has published yet — which is a different fact from
   * zero and is reported as such.
   */
  hoursToFirstPost: z.number().nullable(),
});

const Production = z.object({
  postsPublishedPerWeek: z.number(),
  /**
   * §5's "Draft edits per post" — successful `content.draft` calls over posts
   * published in the same window.
   *
   * A ratio, not a per-post average: a post can be re-drafted before it ever
   * publishes, and `tool_calls` keeps the content item id inside its `input`
   * jsonb rather than in a queryable column. Directionally right, and §5's own
   * reading of it is directional too ("too high = low quality; too low + high
   * failures = risk").
   */
  draftsPerPublishedPost: z.number().nullable(),
  /**
   * §5 asks for "Clicks for brand CTA for post published per week". Clicks live
   * in Dub, one link at a time, behind `analytics.cta_traffic` — so this is the
   * denominator only: how many published posts carried a tracked link. A
   * fabricated click total would be worse than an honest absence.
   */
  postsWithTrackedLink: z.number().int(),
});

const Discovery = z.object({
  /** §5's "Trend-to-post conversion rate": posts that came out of a trend, over trends offered. */
  trendToPostRate: z.number().nullable(),
  postsFromTrends: z.number().int(),
  /** §5's "Repurpose usage rate": how often a ranked trend was actually acted on. */
  repurposeUsageRate: z.number().nullable(),
});

const Automation = z.object({
  recipeCount: z.number().int(),
  /** §5's "Automation output approval rate" — approved over decided, ignoring what is still pending. */
  outputApprovalRate: z.number().nullable(),
});

const Engagement = z.object({
  /** §5's "Reply SLA (time to reply)", in hours, over resolved messages only. */
  replySlaHours: z.number().nullable(),
  messagesResolvedRate: z.number().nullable(),
  salesOpportunitiesPerWeek: z.number(),
  /** §5's "'Next action taken' rate" — an opportunity's recommended action actually carried out. */
  nextActionTakenRate: z.number().nullable(),
});

const Trust = z.object({
  /**
   * §5's "% of blocked/flagged prevented from publishing" — guardrail blocks and
   * policy holds as a share of every publish attempt in the window.
   */
  preventedRate: z.number().nullable(),
  publishAttempts: z.number().int(),
  blockedOrHeld: z.number().int(),
  /**
   * §5's "Incidents: off-brand or risky content published (target near-zero)".
   * A rollback is the only signal the system has that something reached a feed
   * and should not have — nobody rolls back a post they were happy with.
   */
  incidents: z.number().int(),
  awaitingReview: z.number().int(),
});

export const SuccessMetricsOutput = z.object({
  windowDays: z.number().int(),
  since: z.string(),
  activation: Activation,
  production: Production,
  discovery: Discovery,
  automation: Automation,
  engagement: Engagement,
  trust: Trust,
  why: Explanation,
});

/** Rounded to two places — these are read on a dashboard, not reconciled against a ledger. */
const r2 = (n: number) => Number(n.toFixed(2));
/** A rate with an honest empty case: no denominator means "no answer", not zero. */
const rate = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;

export const analyticsSuccessMetrics = defineTool({
  name: 'analytics.success_metrics',
  version: 1,

  summary:
    "PRD §5's success metrics for one brand over a window: activation, production, discovery, " +
    'automation, engagement and trust. Free, read-only, computed from what already happened.',

  input: SuccessMetricsInput,
  output: SuccessMetricsOutput,

  effect: 'read',
  autonomy: 'auto',
  /**
   * Not `client`. These numbers include a brand's failure modes — incidents,
   * blocked posts, an unanswered inbox — and an agency's client seeing the
   * agency's miss rate is a commercial decision rather than a product one.
   */
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,
  surfaces: ['CC-04', 'DASH-B-01'],

  async handler(input, ctx) {
    if (ctx.genomeId && input.genomeId !== ctx.genomeId) {
      throw new ToolError('ISOLATION_VIOLATION', 'That genome is not the one selected.', {
        claimed: input.genomeId,
        selected: ctx.genomeId,
      });
    }

    const now = new Date();
    const since = new Date(now.getTime() - input.windowDays * 86_400_000);
    const weeks = input.windowDays / 7;

    const [rows, calls] = await Promise.all([
      ctx.db.metrics.successMetrics(input.genomeId, ctx.orgId, since),
      // Audit-derived numbers: what was attempted, what was refused, and how
      // much drafting it took. `tool_calls` is not genome-scoped storage — it is
      // the audit log — so it has its own reader.
      ctx.db.metrics.toolActivity(ctx.orgId, input.genomeId, since),
    ]);

    const publishAttempts = calls.publishAttempts;
    const blockedOrHeld = calls.publishBlocked + calls.publishHeld;

    const hoursToFirstPost =
      rows.firstCampaignStartAt && rows.firstPublishedAt
        ? r2(Math.max(0, rows.firstPublishedAt.getTime() - rows.firstCampaignStartAt.getTime()) / 3_600_000)
        : null;

    const activation = {
      connectedAccounts: rows.connectedAccounts,
      onboardingComplete: rows.connectedAccounts > 0,
      campaignActivated: rows.campaignCount > 0,
      hoursToFirstPost,
    };

    const production = {
      postsPublishedPerWeek: r2(rows.publishedInWindow / weeks),
      draftsPerPublishedPost: rate(calls.draftCalls, rows.publishedInWindow),
      postsWithTrackedLink: rows.postsWithTrackedLink,
    };

    const discovery = {
      // Against trends *offered*, not trends that exist: the conversion being
      // measured is "we showed you this and you made something", and the feed is
      // where the showing happens.
      trendToPostRate: rate(rows.postsFromTrends, calls.trendsRanked),
      postsFromTrends: rows.postsFromTrends,
      repurposeUsageRate: rate(calls.repurposeCalls, calls.trendsRanked),
    };

    const automation = {
      recipeCount: rows.recipeCount,
      // Over *decided* outputs. Including pending ones would make a healthy
      // recipe nobody has reviewed yet look like a rejected one.
      outputApprovalRate: rate(rows.outputsApproved, rows.outputsApproved + rows.outputsRejected),
    };

    const engagement = {
      replySlaHours: rows.meanReplySeconds === null ? null : r2(rows.meanReplySeconds / 3_600),
      messagesResolvedRate: rate(rows.messagesResolved, rows.messagesInWindow),
      salesOpportunitiesPerWeek: r2(rows.opportunitiesInWindow / weeks),
      nextActionTakenRate: rate(rows.opportunitiesRouted, rows.opportunitiesInWindow),
    };

    const trust = {
      preventedRate: rate(blockedOrHeld, publishAttempts),
      publishAttempts,
      blockedOrHeld,
      incidents: rows.rolledBack,
      awaitingReview: rows.needsReview,
    };

    /**
     * The summary leads with whichever number most needs acting on, because a
     * dashboard that opens with "all fine" when it is not is worse than no
     * dashboard. Ordered by how much damage the thing does if ignored.
     */
    const headline = !activation.campaignActivated
      ? 'Nothing is measured yet — this brand has no campaign running.'
      : trust.incidents > 0
        ? `${trust.incidents} post${trust.incidents === 1 ? '' : 's'} had to be rolled back after publishing.`
        : activation.connectedAccounts === 0
          ? 'SPARK is planning and drafting, but no account is connected so nothing can publish.'
          : engagement.messagesResolvedRate !== null && engagement.messagesResolvedRate < 0.5
            ? `Less than half the inbox has been answered — ${rows.messagesInWindow - rows.messagesResolved} still waiting.`
            : `${production.postsPublishedPerWeek} posts a week, ${trust.awaitingReview} awaiting review.`;

    return {
      windowDays: input.windowDays,
      since: since.toISOString(),
      activation,
      production,
      discovery,
      automation,
      engagement,
      trust,
      why: {
        summary: headline,
        factors: [
          { label: 'Posts per week', detail: String(production.postsPublishedPerWeek) },
          {
            label: 'Prevented from publishing',
            ...(trust.preventedRate !== null ? { weight: trust.preventedRate } : {}),
            detail: `${blockedOrHeld} of ${publishAttempts} attempts`,
          },
          {
            label: 'Reply SLA',
            detail: engagement.replySlaHours === null ? 'nothing answered yet' : `${engagement.replySlaHours}h`,
          },
          {
            label: 'Trend-to-post',
            ...(discovery.trendToPostRate !== null ? { weight: discovery.trendToPostRate } : {}),
            detail: `${rows.postsFromTrends} of ${calls.trendsRanked} trends acted on`,
          },
        ],
        evidence: [
          {
            kind: 'metric' as const,
            id: 'tool_calls',
            note: `${publishAttempts} publish attempt(s), ${calls.draftCalls} draft(s) since ${since.toISOString().slice(0, 10)}`,
          },
        ],
        alternatives: [],
      },
    };
  },
});

export { WEEK_MS };
