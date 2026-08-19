import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError, Explanation } from '@sparksocial/shared';

/**
 * `engage.eligibility.check` — `ENG-01`'s gate: "ineligible (campaign still
 * learning)" vs "eligible but inactive (configure now)" vs "active".
 *
 * ── The rule itself is a v1 default, not a settled product decision ────────
 * PRD §12's open-questions list names this exact gap: *"Eligibility rule for
 * engagement intelligence (time-based, volume-based, or hybrid)?"* — still
 * unanswered as of this writing. Rather than leave the gate unbuildable
 * pending that decision, this ships a hybrid rule using data the product
 * already has: a campaign must be at least `MIN_DAYS_SINCE_START` days into
 * its window (time-based — SPARK has had a chance to establish voice/cadence)
 * *and* have at least `MIN_PUBLISHED_POSTS` published posts (volume-based —
 * there is an actual publishing history to have generated real engagement
 * against). `MIN_DAYS_SINCE_START` deliberately matches the 14-day figure
 * the master plan's autonomy table already uses for `engage.reply.send`
 * ("confirm always in first 14 days") — the same "SPARK is still new here"
 * period, not a second unrelated number. Both constants are named and
 * exported so a product decision on the open question is a one-line change,
 * not a rewrite.
 */

export const MIN_DAYS_SINCE_START = 14;
export const MIN_PUBLISHED_POSTS = 5;

export const EngageEligibilityCheckInput = z.object({
  genomeId: z.string().min(1),
  campaignId: z.string().min(1),
});

export const EngageEligibilityCheckOutput = z.object({
  eligible: z.boolean(),
  daysSinceStart: z.number(),
  publishedCount: z.number(),
  reason: z.string(),
  why: Explanation,
});

export const engageEligibilityCheck = defineTool({
  name: 'engage.eligibility.check',
  version: 1,

  summary: 'Whether a campaign has cleared the engagement-intelligence learning period — v1 default rule, see docs/STATUS.md.',

  input: EngageEligibilityCheckInput,
  output: EngageEligibilityCheckOutput,

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

    const campaign = await ctx.db.campaigns.get(input.campaignId, ctx.orgId);
    if (!campaign || campaign.genomeId !== input.genomeId) {
      throw new ToolError('NOT_FOUND', 'No campaign with that id in this genome.');
    }

    const slots = await ctx.db.campaigns.slots(input.campaignId, ctx.orgId, input.genomeId);
    const publishedCount = slots.filter((s) => s.status === 'published').length;
    const daysSinceStart = Math.floor((Date.now() - campaign.startAt.getTime()) / 86_400_000);

    const clearedTime = daysSinceStart >= MIN_DAYS_SINCE_START;
    const clearedVolume = publishedCount >= MIN_PUBLISHED_POSTS;
    const eligible = clearedTime && clearedVolume;

    const reason = eligible
      ? `Cleared the learning period: ${daysSinceStart} days since start, ${publishedCount} posts published.`
      : !clearedTime
        ? `Still learning: ${daysSinceStart} of ${MIN_DAYS_SINCE_START} days since the campaign started.`
        : `Still learning: ${publishedCount} of ${MIN_PUBLISHED_POSTS} required posts published.`;

    return {
      eligible,
      daysSinceStart,
      publishedCount,
      reason,
      why: {
        summary: reason,
        factors: [
          { label: 'Days since campaign start', weight: clearedTime ? 1 : 0, detail: `${daysSinceStart}/${MIN_DAYS_SINCE_START}` },
          { label: 'Published posts', weight: clearedVolume ? 1 : 0, detail: `${publishedCount}/${MIN_PUBLISHED_POSTS}` },
        ],
        evidence: [{ kind: 'rule' as const, id: 'engage.eligibility.v1', note: 'time-based AND volume-based, PRD §12 open question' }],
        alternatives: [],
      },
    };
  },
});
