import { z } from 'zod';
import { ToolError } from '@sparksocial/shared';
import {
  CREDIT_CATEGORIES,
  CREDIT_CATEGORY_LABEL,
  centsToCredits,
  type CreditCategory,
} from '@sparksocial/shared/credits';
import { defineTool } from '@sparksocial/tools/defineTool';
import type { CreditStore } from '@sparksocial/tools/defineTool';
import { PLAN_CAPS_CENTS } from './org.js';

/**
 * `org.budget.set` — the monthly cap and the per-category allocations.
 *
 * ── Why one tool and not two ──────────────────────────────────────────────
 *
 * The rule that makes allocations mean anything is that they cannot add up to
 * more than the cap. That rule spans both values, so separate writes would force
 * every workspace lowering its cap to pass through a state the rule forbids —
 * and the usual escape (validate loosely, reconcile later) is exactly how a
 * limit becomes advisory.
 *
 * ── Why the cap can go down but not up ────────────────────────────────────
 *
 * "Spend no more than $200 this month even though my plan allows $500" is a
 * workspace's own decision and there is no reason to refuse it. Raising the cap
 * past the plan is not the same kind of request: it is a billing change, and a
 * screen that let an owner grant themselves more headroom would make the plan
 * tier decorative. So the plan's cap is the ceiling, and the error says which
 * plan the ceiling came from rather than just refusing the number.
 */

const AllocationInput = z
  .record(z.string(), z.number().int().min(0))
  .describe('Cents per category, keyed by category id. A category left out has no sub-cap.');

export const OrgBudgetSetInput = z
  .object({
    /**
     * The workspace's own ceiling for the month, at or below the plan's.
     * Omitted leaves it alone.
     */
    monthlyCapCents: z.number().int().min(0).optional(),
    /**
     * The complete set of sub-caps. **Replaces** what is stored: a category left
     * out is one the workspace has removed the sub-cap from, which is the only
     * way a single field can express removal. Omitted entirely leaves the
     * existing set alone.
     */
    allocationsCents: AllocationInput.optional(),
  })
  .refine((v) => v.monthlyCapCents !== undefined || v.allocationsCents !== undefined, {
    message: 'Nothing to set — pass a monthly cap, allocations, or both.',
  });

const AllocationOut = z.object({
  category: z.string(),
  label: z.string(),
  capCents: z.number().int(),
  capCredits: z.number().int(),
});

export const OrgBudgetSetOutput = z.object({
  monthlyCapCents: z.number().int(),
  monthlyCapCredits: z.number().int(),
  /** Only the categories that have a sub-cap. An absent category is unbounded within the cap. */
  allocations: z.array(AllocationOut),
  /**
   * What is left of the cap once every allocation is taken out — the headroom a
   * category with no sub-cap draws on. Zero is legitimate (fully allocated) and
   * is worth showing, because it means an uncapped category can no longer spend.
   */
  unallocatedCents: z.number().int(),
});

export interface OrgBudgetDeps {
  credits: Pick<CreditStore, 'budget' | 'setBudget'>;
}

export function makeOrgBudgetSet(deps: OrgBudgetDeps) {
  return defineTool({
    name: 'org.budget.set',
    version: 1,

    summary:
      "The workspace's monthly spend limit and how much of it each kind of work may use. The limit can " +
      'be set at or below the plan allows, and the per-kind limits together cannot exceed it. Owner only.',

    input: OrgBudgetSetInput,
    output: OrgBudgetSetOutput,

    effect: 'write',
    autonomy: 'auto',
    // Not `admin`: this is the ceiling on what the org can be billed, and an
    // admin who could raise their own spending limit is not a limit.
    scopes: ['owner'],
    /**
     * Idempotent, and genuinely so: this is a set, not an increment. Sending the
     * same cap twice leaves the same cap, which is the property `invoke.ts` is
     * asking about — unlike `org.credits.grant`, where a repeat adds money.
     */
    idempotent: true,

    async handler(input, ctx) {
      const settings = await ctx.db.orgSettings.get(ctx.orgId);
      const planCeiling = PLAN_CAPS_CENTS[settings.plan as keyof typeof PLAN_CAPS_CENTS] ?? settings.monthlyCapCents;
      const current = await deps.credits.budget(ctx.orgId, new Date());

      const monthlyCapCents = input.monthlyCapCents ?? current.monthlyCapCents;
      if (monthlyCapCents > planCeiling) {
        throw new ToolError(
          'INVALID_INPUT',
          `The ${settings.plan} plan allows up to $${(planCeiling / 100).toFixed(2)} a month. ` +
            `Set a lower limit, or change plan to raise the ceiling.`,
          { planCeiling, requested: monthlyCapCents },
        );
      }

      const allocationsCents = input.allocationsCents ?? current.allocationsCents;

      const unknown = Object.keys(allocationsCents).filter(
        (c) => !CREDIT_CATEGORIES.includes(c as CreditCategory),
      );
      if (unknown.length) {
        throw new ToolError('INVALID_INPUT', `Not a kind of spending this workspace has: ${unknown.join(', ')}.`, {
          unknown,
          known: CREDIT_CATEGORIES,
        });
      }

      const allocated = Object.values(allocationsCents).reduce((n, c) => n + c, 0);
      if (allocated > monthlyCapCents) {
        /**
         * The check that keeps the allocation bars honest. Without it a workspace
         * can allocate $900 of a $500 limit, every bar reads as having room, and
         * the first refusal comes from the monthly cap with a message about a
         * limit the screen never showed as close.
         */
        throw new ToolError(
          'INVALID_INPUT',
          `Those add up to $${(allocated / 100).toFixed(2)}, which is more than the $${(
            monthlyCapCents / 100
          ).toFixed(2)} monthly limit. Lower one of them, or raise the limit first.`,
          { allocated, monthlyCapCents },
        );
      }

      await deps.credits.setBudget({
        orgId: ctx.orgId,
        ...(input.monthlyCapCents !== undefined ? { monthlyCapCents } : {}),
        ...(input.allocationsCents !== undefined ? { allocationsCents } : {}),
      });

      ctx.logger.info('budget set', { orgId: ctx.orgId, monthlyCapCents, allocated });

      return {
        monthlyCapCents,
        monthlyCapCredits: centsToCredits(monthlyCapCents),
        allocations: Object.entries(allocationsCents).map(([category, capCents]) => ({
          category,
          label: CREDIT_CATEGORY_LABEL[category as CreditCategory],
          capCents,
          capCredits: centsToCredits(capCents),
        })),
        unallocatedCents: monthlyCapCents - allocated,
      };
    },
  });
}
