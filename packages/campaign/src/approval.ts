import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';

/**
 * APPROVAL MODE — PRD §7.1/§9, engine spec §6.8 Step 5.
 *
 *   *"Recommend 'review first week, then autopublish' explicitly — it is the
 *   setting that gets people to autopublish at all."*
 *
 * That sentence is the whole design. Autopublish is the product: an account
 * that needs a human to approve every post is a scheduler with extra steps. But
 * nobody switches it on cold, so the ladder's middle rung is the one that
 * actually converts — a week of watching, then it graduates itself.
 *
 * The policy engine (`policy.ts`) has implemented all three rungs from the
 * start. These tools are what let a brand *be* on one.
 */

const ApprovalMode = z.enum(['autopublish', 'review_first_week', 'review_everything']);

/** Kept beside the copy it explains — `policy.ts` owns the enforcement constant. */
const REVIEW_FIRST_WEEK_DAYS = 7;

export const ApprovalGetInput = z.object({});

export const ApprovalGetOutput = z.object({
  brandId: z.string(),
  approvalMode: ApprovalMode,
  /** Null unless on `review_first_week` and still inside it. */
  graduatesInDays: z.number().nullable(),
  recommended: ApprovalMode,
  why: Explanation,
});

export const approvalGet = defineTool({
  name: 'brand.approval.get',
  version: 1,

  summary:
    'What this brand does before publishing — autopublish, review the first week, or review everything — ' +
    'and when a first-week review graduates. Free.',

  input: ApprovalGetInput,
  output: ApprovalGetOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,

  async handler(_input, ctx) {
    const brandId = requireBrand(ctx.brandId);
    const governance = await ctx.db.brands.get(brandId, ctx.orgId);

    const graduatesInDays =
      governance.approvalMode === 'review_first_week' ? remainingReviewDays(governance.createdAt) : null;

    return {
      brandId: governance.brandId,
      approvalMode: governance.approvalMode,
      graduatesInDays,
      recommended: 'review_first_week' as const,
      why: explain(governance.approvalMode, graduatesInDays),
    };
  },
});

export const ApprovalSetInput = z.object({ mode: ApprovalMode });

export const ApprovalSetOutput = z.object({
  brandId: z.string(),
  approvalMode: ApprovalMode,
  graduatesInDays: z.number().nullable(),
  why: Explanation,
});

export const approvalSet = defineTool({
  name: 'brand.approval.set',
  version: 1,

  summary:
    'Set what this brand does before publishing. Recommend "review the first week" — it is the setting ' +
    'that gets people comfortable enough to autopublish at all.',

  input: ApprovalSetInput,
  output: ApprovalSetOutput,

  effect: 'write',
  // Changing what stands between the agent and a public feed is an owner/admin
  // decision. An editor can draft and schedule; they cannot lower the gate.
  autonomy: 'auto',
  scopes: ['owner', 'admin'],
  idempotent: true,
  surfaces: ['CMP-01.5'],

  async handler(input, ctx) {
    const brandId = requireBrand(ctx.brandId);
    const governance = await ctx.db.brands.setApprovalMode(brandId, ctx.orgId, input.mode);

    ctx.logger.info('approval mode set', { brandId, mode: input.mode });

    const graduatesInDays =
      governance.approvalMode === 'review_first_week' ? remainingReviewDays(governance.createdAt) : null;

    return {
      brandId: governance.brandId,
      approvalMode: governance.approvalMode,
      graduatesInDays,
      why: explain(governance.approvalMode, graduatesInDays),
    };
  },
});

function requireBrand(brandId: string | undefined): string {
  if (!brandId) {
    throw new ToolError('INVALID_INPUT', 'A brand must be selected to read or change approval mode.');
  }
  return brandId;
}

/**
 * Days left before `review_first_week` graduates to autopublish.
 *
 * Measured from the brand's creation, not from when the mode was set: the point
 * of the rung is a week of watching the *account*, and re-setting the same mode
 * on day six must not restart the clock.
 */
export function remainingReviewDays(createdAt: Date, now: Date = new Date()): number {
  const elapsed = Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000);
  return Math.max(0, REVIEW_FIRST_WEEK_DAYS - elapsed);
}

function explain(mode: z.infer<typeof ApprovalMode>, graduatesInDays: number | null): Explanation {
  const summary =
    mode === 'autopublish'
      ? 'Posts go out on schedule without waiting for you.'
      : mode === 'review_everything'
        ? 'Every post waits for your approval.'
        : graduatesInDays && graduatesInDays > 0
          ? `Reviewing everything for ${graduatesInDays} more day${graduatesInDays === 1 ? '' : 's'}, then posting on schedule.`
          : 'The first week is over — posts now go out on schedule.';

  return {
    summary,
    factors: [
      { label: 'mode', detail: mode },
      ...(graduatesInDays !== null ? [{ label: 'graduates in', detail: `${graduatesInDays} days` }] : []),
    ],
    evidence: [{ kind: 'rule', id: `approval_mode.${mode}`, note: 'enforced in the policy engine, not in the UI' }],
    // Naming the rejected option is the recommendation §6.8 Step 5 asks for,
    // and it is more honest as a trade-off than as a nudge.
    alternatives:
      mode === 'review_everything'
        ? [
            {
              option: 'Review the first week, then autopublish',
              rejectedBecause: 'you chose to review everything — most people switch after a week of watching',
            },
          ]
        : [],
  };
}
