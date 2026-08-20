import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import type { CreditStore } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';

/**
 * `org.usage.get` — PRD §8.12's "usage slice and alerts", and the answer to
 * §12's open question: *"Credit model: what consumes credits, and how budget
 * alerts work?"*
 *
 * ── Why this did not exist ─────────────────────────────────────────────────
 *
 * Costs are recorded on every paid tool and `credit_ledger` is real. There was
 * no way to *read* it: `CreditStore` exposed `budget()` (a cap and a total, used
 * by `policy.ts` rule 4 on the hot path) and `grant()`, and the only place a
 * balance ever surfaced to a caller was the response to `org.credits.grant`.
 * Rendering a usage panel therefore meant granting credits to display a number,
 * which is not a thing anyone should be able to do by opening a settings page.
 *
 * ── What "what consumes credits" is answerable with ───────────────────────
 *
 * The ledger carries one row per charge with the tool that made it, so the
 * breakdown is a `group by tool` — no new instrumentation. That is deliberately
 * the whole answer: §12 asks which tools consume credits, and the honest source
 * for that is what has actually been charged, not a table of list prices.
 *
 * ── Alerts are a threshold and a verdict, not a notification here ──────────
 *
 * This tool reports whether spend has crossed 50/80/100% of the cap and says so
 * in its `why`. It does not *send* anything: `human.notify` is the channel and
 * sending on a read would mean a settings page emitting notifications. A
 * scheduled job that reads this and notifies is the natural next piece, and is
 * a different tool with a different effect.
 */

export const OrgUsageGetInput = z.object({
  /** Cap the breakdown. The tail of a long-tail spend is noise on a panel. */
  topTools: z.number().int().min(1).max(50).default(10),
});

const ToolSpend = z.object({
  tool: z.string(),
  costCents: z.number().int(),
  calls: z.number().int(),
  /** Share of this period's spend, 0–1. Computed here so two callers cannot disagree. */
  share: z.number(),
});

export const OrgUsageGetOutput = z.object({
  monthlyCapCents: z.number().int(),
  spentCents: z.number().int(),
  remainingCents: z.number().int(),
  /** 0–1, clamped. Above 1 is possible after an overspend and reads as nonsense on a bar. */
  usedFraction: z.number(),
  /** `ok` · `warning` (≥50%) · `critical` (≥80%) · `exhausted` (≥100%). */
  alert: z.enum(['ok', 'warning', 'critical', 'exhausted']),
  byTool: z.array(ToolSpend),
  periodStart: z.string(),
  why: Explanation,
});

/** The thresholds the alert bands are drawn at. Named so a product decision is a one-line change. */
export const USAGE_WARNING_FRACTION = 0.5;
export const USAGE_CRITICAL_FRACTION = 0.8;

export interface UsageDeps {
  credits: CreditStore;
}

export function makeOrgUsageGet(deps: UsageDeps) {
  return defineTool({
    name: 'org.usage.get',
    version: 1,

    summary:
      "This month's credit spend for the org: the cap, what is left, which tools spent it, and whether " +
      'spend has crossed a warning threshold. Free, read-only.',

    input: OrgUsageGetInput,
    output: OrgUsageGetOutput,

    effect: 'read',
    autonomy: 'auto',
    /**
     * Not `viewer` or `client`. Spend is commercial information about the
     * organization rather than about the work — an agency's client should not
     * read what the agency is paying per video, and a viewer invited to see a
     * calendar has no reason to see a bill.
     */
    scopes: ['owner', 'admin'],
    idempotent: true,
    surfaces: ['SET-ORG-01', 'SET-WS-01'],

    async handler(input, ctx) {
      const now = new Date();
      const [{ monthlyCapCents, spentCents }, breakdown] = await Promise.all([
        deps.credits.budget(ctx.orgId, now),
        deps.credits.spendByTool(ctx.orgId, now, input.topTools),
      ]);

      if (monthlyCapCents <= 0) {
        // A zero cap is the "no ledger configured" state `readBudget` documents,
        // not a real plan. Saying so beats reporting infinite headroom or
        // dividing by zero.
        throw new ToolError(
          'UPSTREAM_FAILED',
          'No spend cap is configured for this organization, so usage cannot be reported against one.',
          { orgId: ctx.orgId },
        );
      }

      const usedFraction = Math.max(0, Math.min(1, spentCents / monthlyCapCents));
      const alert: z.infer<typeof OrgUsageGetOutput>['alert'] =
        spentCents >= monthlyCapCents
          ? 'exhausted'
          : usedFraction >= USAGE_CRITICAL_FRACTION
            ? 'critical'
            : usedFraction >= USAGE_WARNING_FRACTION
              ? 'warning'
              : 'ok';

      const byTool = breakdown.map((r) => ({
        tool: r.tool,
        costCents: r.costCents,
        calls: r.calls,
        // Against actual spend, not the cap: this answers "what did the money go
        // on", and a share of the cap would read as 3% for everything early in a
        // month.
        share: spentCents > 0 ? Number((r.costCents / spentCents).toFixed(4)) : 0,
      }));

      const money = (c: number) => `$${(c / 100).toFixed(2)}`;
      const biggest = byTool[0];

      return {
        monthlyCapCents,
        spentCents,
        remainingCents: Math.max(0, monthlyCapCents - spentCents),
        usedFraction,
        alert,
        byTool,
        periodStart: startOfPeriod(now).toISOString(),
        why: {
          summary:
            alert === 'exhausted'
              ? `This month's ${money(monthlyCapCents)} is spent. Paid tools are refused until the period rolls over.`
              : `${money(spentCents)} of ${money(monthlyCapCents)} used this month${
                  biggest ? `, mostly on ${biggest.tool}` : ''
                }.`,
          factors: byTool.slice(0, 5).map((t) => ({
            label: t.tool,
            weight: t.share,
            detail: `${money(t.costCents)} across ${t.calls} call${t.calls === 1 ? '' : 's'}`,
          })),
          evidence: [
            {
              kind: 'metric' as const,
              id: 'credit_ledger',
              note: `${byTool.length} tool(s) charged since ${startOfPeriod(now).toISOString().slice(0, 10)}`,
            },
          ],
          alternatives: [],
        },
      };
    },
  });
}

/**
 * Calendar month, matching `creditRepository`'s own `periodStart`.
 *
 * Duplicated rather than exported from `packages/db`, because `packages/agency`
 * must not import the database layer — and a *third* definition is what would
 * actually be dangerous here. Both are "first of the month, UTC"; if that ever
 * becomes a billing-anniversary window it belongs on `CreditStore` as a method
 * so there is one answer.
 */
function startOfPeriod(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
