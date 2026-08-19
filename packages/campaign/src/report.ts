import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ContentPillar, Explanation, ToolError } from '@sparksocial/shared';
import type { CampaignPlan } from './plan.js';

/**
 * `campaign.report_vs_outcome` — engine spec §6.8 Step 6, the campaign
 * flow's last step and the one nothing implemented: *"Report against the
 * STATED OUTCOME, not vanity metrics. 'You wanted 40 bookings. You're at 27
 * with nine days left. Craft is doing 3× offer, so I'm shifting four offer
 * slots to craft.' → reweight → repeat."*
 *
 * ── Why this reports volume/mix, and is explicit about what it cannot ──────
 *
 * A numeric target ("40 bookings") only became capturable this pass —
 * `campaign.create`'s `targetCount`/`targetLabel` — because nothing asked for
 * one before. Even with it captured, *attainment* against a conversion-style
 * target (bookings, trials, sales) needs customer-side instrumentation this
 * product does not have yet (plan §13 open decision #4: "reach and engagement
 * are easy; bookings and trials need customer-side instrumentation... decide
 * the v1 signal set before building the sampler, or the sampler learns on the
 * wrong reward"). Reporting a fabricated attainment number against an
 * untracked target would be exactly the kind of invented fact this codebase's
 * guardrails elsewhere exist to prevent (claim grounding, the CTA that's
 * pulled verbatim rather than generated). So this tool reports what it can
 * actually measure honestly — volume delivered vs. planned, mix actual vs.
 * planned, and real engagement roll-ups from `content_metrics` — and says so
 * plainly when a stated target has no attainment signal behind it yet, rather
 * than inventing one.
 *
 * The reweight suggestion IS real: mix actual vs. mix planned are both
 * genuine counts, so "craft is 3× offer relative to plan" is a true
 * statement computable today, unlike a fabricated bookings number.
 */

export const ReportVsOutcomeInput = z.object({
  campaignId: z.string().min(1),
});

const PillarDelta = z.object({
  pillar: ContentPillar,
  planned: z.number(),
  actual: z.number(),
  /** actual / planned, or null when nothing was planned for this pillar (avoids a divide-by-zero reading as "0% of nothing"). */
  ratio: z.number().nullable(),
});

export const ReportVsOutcomeOutput = z.object({
  campaignId: z.string(),
  objective: z.string(),
  windowDays: z.number(),
  daysElapsed: z.number(),
  daysRemaining: z.number(),
  target: z.object({ count: z.number(), label: z.string() }).nullable(),
  /**
   * Whether the target has a real attainment signal behind it yet. Always
   * 'not_measurable' today — no target this alpha sets is backed by
   * customer-side conversion tracking — kept as an enum rather than a bare
   * boolean so a future real signal (Dub-attributed bookings, say) has
   * somewhere to report 'measured' without changing the shape.
   */
  targetStatus: z.enum(['no_target', 'not_measurable']),
  volume: z.object({
    planned: z.number(),
    published: z.number(),
    scheduledRemaining: z.number(),
  }),
  mix: z.array(PillarDelta),
  engagement: z.object({
    postsWithMetrics: z.number(),
    likes: z.number(),
    comments: z.number(),
    shares: z.number(),
    views: z.number(),
    impressions: z.number(),
  }),
  reweightSuggestion: z
    .object({ overDelivered: z.string().nullable(), underDelivered: z.string().nullable(), detail: z.string() })
    .nullable(),
  why: Explanation,
});

export const campaignReportVsOutcome = defineTool({
  name: 'campaign.report_vs_outcome',
  version: 1,

  summary:
    'Report a live campaign against what it set out to do: posts delivered vs. planned, actual pillar ' +
    'mix vs. planned, and real engagement so far — plus a reweight suggestion when one pillar is running ' +
    'well ahead of another. Says plainly when a stated numeric target has no real attainment data behind ' +
    'it yet, rather than inventing a number. Free.',

  input: ReportVsOutcomeInput,
  output: ReportVsOutcomeOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver'],
  idempotent: true,
  surfaces: ['CMP-01.6'],

  async handler(input, ctx) {
    const campaign = await ctx.db.campaigns.get(input.campaignId, ctx.orgId);
    if (!campaign) throw new ToolError('NOT_FOUND', 'No such campaign.', { campaignId: input.campaignId });

    const slots = await ctx.db.campaigns.slots(campaign.id, ctx.orgId, campaign.genomeId);
    const plan = campaign.plan as CampaignPlan;

    const now = Date.now();
    const elapsedMs = now - campaign.startAt.getTime();
    const daysElapsed = Math.max(0, Math.min(campaign.windowDays, Math.floor(elapsedMs / 86_400_000)));
    const daysRemaining = Math.max(0, campaign.windowDays - daysElapsed);

    const published = slots.filter((s) => s.status === 'published').length;
    const scheduledRemaining = slots.filter((s) => s.status === 'scheduled').length;

    const actualCounts = new Map<string, number>();
    for (const s of slots) {
      if (!s.pillar) continue;
      actualCounts.set(s.pillar, (actualCounts.get(s.pillar) ?? 0) + 1);
    }
    const plannedCounts = new Map<string, number>((plan?.mix ?? []).map((m) => [m.pillar as string, m.count]));
    const pillars = new Set<string>([...actualCounts.keys(), ...plannedCounts.keys()]);
    const mix = [...pillars]
      .map((pillar) => {
        const plannedCount = plannedCounts.get(pillar) ?? 0;
        const actualCount = actualCounts.get(pillar) ?? 0;
        return {
          pillar: pillar as z.infer<typeof ContentPillar>,
          planned: plannedCount,
          actual: actualCount,
          ratio: plannedCount > 0 ? Math.round((actualCount / plannedCount) * 100) / 100 : null,
        };
      })
      .sort((a, b) => b.actual - a.actual);

    const contentItemIds = slots.map((s) => s.id);
    const metrics = await ctx.db.analytics.listForItems(contentItemIds, ctx.orgId, campaign.genomeId);
    const engagement = metrics.reduce(
      (acc, m) => ({
        likes: acc.likes + m.likes,
        comments: acc.comments + m.comments,
        shares: acc.shares + m.shares,
        views: acc.views + m.views,
        impressions: acc.impressions + m.impressions,
      }),
      { likes: 0, comments: 0, shares: 0, views: 0, impressions: 0 },
    );
    const postsWithMetrics = new Set(metrics.map((m) => m.contentItemId)).size;

    const reweight = reweightSuggestion(mix);

    return {
      campaignId: campaign.id,
      objective: campaign.objective,
      windowDays: campaign.windowDays,
      daysElapsed,
      daysRemaining,
      target:
        campaign.targetCount !== undefined && campaign.targetLabel !== undefined
          ? { count: campaign.targetCount, label: campaign.targetLabel }
          : null,
      targetStatus: (campaign.targetCount !== undefined ? 'not_measurable' : 'no_target') as 'not_measurable' | 'no_target',
      volume: { planned: plan?.buildableNow ?? slots.length, published, scheduledRemaining },
      mix,
      engagement: { postsWithMetrics, ...engagement },
      reweightSuggestion: reweight,
      why: explain({ campaign, daysElapsed, daysRemaining, published, plannedVolume: plan?.buildableNow ?? slots.length, reweight }),
    };
  },
});

function reweightSuggestion(
  mix: Array<{ pillar: string; planned: number; actual: number; ratio: number | null }>,
): { overDelivered: string | null; underDelivered: string | null; detail: string } | null {
  const withRatio = mix.filter((m) => m.ratio !== null && m.planned >= 2); // ignore noise from single-slot pillars
  if (withRatio.length < 2) return null;

  const over = withRatio.reduce((a, b) => (b.ratio! > a.ratio! ? b : a));
  const under = withRatio.reduce((a, b) => (b.ratio! < a.ratio! ? b : a));
  if (over.pillar === under.pillar || over.ratio! - under.ratio! < 0.3) return null;

  return {
    overDelivered: over.pillar,
    underDelivered: under.pillar,
    detail: `${over.pillar} is running at ${Math.round(over.ratio! * 100)}% of its planned share, ${under.pillar} at ${Math.round(under.ratio! * 100)}% — worth rebalancing toward ${under.pillar} in the next regeneration.`,
  };
}

function explain(args: {
  campaign: { objective: string; targetCount?: number; targetLabel?: string };
  daysElapsed: number;
  daysRemaining: number;
  published: number;
  plannedVolume: number;
  reweight: ReturnType<typeof reweightSuggestion>;
}): Explanation {
  const { campaign, daysElapsed, daysRemaining, published, plannedVolume, reweight } = args;

  const volumeLine = `${published} of ${plannedVolume} planned posts published, ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left.`;
  const targetLine = campaign.targetCount
    ? ` You set a target of ${campaign.targetCount} ${campaign.targetLabel} — this account isn't wired to real conversion tracking yet, so I can't say how close that is; the volume and mix numbers above are what I can actually verify.`
    : '';

  return {
    summary: volumeLine + targetLine,
    factors: [
      { label: 'window', detail: `day ${daysElapsed} of ${daysElapsed + daysRemaining}` },
      { label: 'objective', detail: campaign.objective },
      ...(reweight ? [{ label: 'mix imbalance', detail: reweight.detail }] : []),
      ...(campaign.targetCount
        ? [{ label: 'target attainment', detail: 'not measurable — no conversion-tracking signal wired yet' }]
        : []),
    ],
    evidence: [],
    alternatives: campaign.targetCount
      ? [
          {
            option: `Report ${campaign.targetCount} ${campaign.targetLabel ?? ''} as a fabricated attainment estimate`,
            rejectedBecause: 'no real signal exists for it — an invented number is worse than an honest gap',
          },
        ]
      : [],
  };
}
