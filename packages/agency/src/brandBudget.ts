import { z } from 'zod';
import { ToolError } from '@sparksocial/shared';
import { centsToCredits } from '@sparksocial/shared/credits';
import { defineTool } from '@sparksocial/tools/defineTool';
import type { CreditStore } from '@sparksocial/tools/defineTool';

/**
 * `brand.budget.*` — one client's hard monthly ceiling inside the org's.
 *
 * ── The gap these close ───────────────────────────────────────────────────
 *
 * `credit_ledger` has carried `brand_id` on every row since it was written, so
 * an agency could always *see* that one client had eaten the month. It could
 * not stop the next one: the only ceiling was the org's, and the first brand to
 * spend it spent everybody's. `org.budget.set`'s per-category sub-caps bound
 * what the money is spent *on*, never who spends it.
 *
 * ── Hard, and what that means ─────────────────────────────────────────────
 *
 * `policy.ts` refuses a call that would cross the cap, the same way it refuses
 * one that would cross the org's — `budget.brand_exceeded`, checked after the
 * org cap and before the category one, so the answer a person gets is the one
 * they cannot fix by raising something smaller.
 *
 * The alternative was a soft cap: let it through, flag it. `org.usage.get`
 * already has that, in its `ok | warning | critical | exhausted` bands, and
 * warnings were never the missing piece. A limit that only warned would leave
 * the agency exactly where it started — able to describe the overspend
 * afterwards and unable to prevent it.
 *
 * The cost is real and worth stating: a brand that hits its cap goes quiet.
 * Its agent stops drafting, rendering and publishing until the month turns or
 * somebody raises the number. That is what "hard" means, and it is why setting
 * one is an owner's decision rather than a default.
 *
 * ── Absent, and zero ──────────────────────────────────────────────────────
 *
 * No cap is the default and must stay reachable: `null` removes the row.
 * Zero is a different instruction — "this brand spends nothing" — and a screen
 * that cleared a cap by writing zero would freeze the brand it meant to free.
 * The two stay distinguishable from the tool input down to the column.
 */

export const BrandBudgetSetInput = z.object({
  brandId: z.string().min(1),
  /**
   * The brand's ceiling in cents, or `null` to remove it.
   *
   * Not bounded by the org's cap here, deliberately. An org that lowers its own
   * monthly cap below a brand's would otherwise have to walk every brand down
   * first, and the org cap is checked before the brand's at spend time anyway —
   * so a brand cap above it is harmless, and refusing it would be a rule that
   * protects nothing and blocks a legitimate order of operations.
   */
  monthlyCapCents: z.number().int().min(0).max(100_000_00).nullable(),
});

export const BrandBudgetSetOutput = z.object({
  brandId: z.string(),
  monthlyCapCents: z.number().int().nullable(),
  monthlyCapCredits: z.number().int().nullable(),
  spentCents: z.number().int(),
  /** What is left under the new cap right now. Null when there is no cap. */
  remainingCents: z.number().int().nullable(),
});

export const BrandBudgetListOutput = z.object({
  brands: z.array(
    z.object({
      brandId: z.string(),
      monthlyCapCents: z.number().int(),
      monthlyCapCredits: z.number().int(),
      spentCents: z.number().int(),
      remainingCents: z.number().int(),
      /** True once this brand can no longer spend — the screen's red row. */
      exhausted: z.boolean(),
    }),
  ),
});

export interface BrandBudgetDeps {
  credits: Pick<CreditStore, 'brandBudget' | 'listBrandBudgets' | 'setBrandBudget'>;
}

export function makeBrandBudgetSet(deps: BrandBudgetDeps) {
  return defineTool({
    name: 'brand.budget.set',
    version: 1,

    summary:
      "One brand's hard monthly spending limit, inside the organisation's. A brand that reaches it stops " +
      'spending until the month turns or the limit is raised — drafting, rendering and publishing all ' +
      'refuse. Pass null to remove the limit. Owner only.',

    input: BrandBudgetSetInput,
    output: BrandBudgetSetOutput,

    effect: 'write',
    autonomy: 'auto',
    /*
     * Owner, matching `org.budget.set` and for its reason: this is a ceiling on
     * what the organisation can be billed for one client, and an admin who
     * could raise the limit they are spending against is not a limit. It is
     * also the switch that can silence a client's agent, which is not an
     * operational setting.
     */
    scopes: ['owner'],
    /** A set, not an increment. The same cap twice leaves the same cap. */
    idempotent: true,

    async handler(input, ctx) {
      await deps.credits.setBrandBudget({
        orgId: ctx.orgId,
        brandId: input.brandId,
        monthlyCapCents: input.monthlyCapCents,
      });

      // Read back rather than echo. `brand.settings.patch` returned its input
      // and reported a write that never happened; a tool that answers from
      // what it was handed cannot tell a caller the difference.
      const after = await deps.credits.brandBudget(ctx.orgId, input.brandId, new Date());

      ctx.logger.info('brand budget set', {
        orgId: ctx.orgId,
        brandId: input.brandId,
        monthlyCapCents: input.monthlyCapCents,
      });

      return {
        brandId: input.brandId,
        monthlyCapCents: after.capCents,
        monthlyCapCredits: after.capCents === null ? null : centsToCredits(after.capCents),
        spentCents: after.spentCents,
        remainingCents: after.capCents === null ? null : Math.max(0, after.capCents - after.spentCents),
      };
    },
  });
}

export function makeBrandBudgetList(deps: BrandBudgetDeps) {
  return defineTool({
    name: 'brand.budget.list',
    version: 1,

    summary:
      'Every brand in this organisation that has a spending limit, with what it has spent against it this ' +
      'month. Brands with no limit are not listed — they are bounded only by the organisation. Free.',

    input: z.object({}),
    output: BrandBudgetListOutput,

    effect: 'read',
    autonomy: 'auto',
    /*
     * Wider than `set`, narrower than everything: who is spending the shared
     * balance is an administrative question, and an admin who can see the org's
     * usage should be able to see how it divides. A client role must not —
     * this lists other clients.
     */
    scopes: ['owner', 'admin'],
    idempotent: true,

    async handler(_input, ctx) {
      const caps = await deps.credits.listBrandBudgets(ctx.orgId);
      const now = new Date();

      /*
       * One read per capped brand. Bounded by how many brands an org has
       * bothered to cap, which is small by construction — a brand with no cap
       * has no row — and this is a settings screen, not a hot path.
       */
      const brands = await Promise.all(
        caps.map(async (c) => {
          const { spentCents } = await deps.credits.brandBudget(ctx.orgId, c.brandId, now);
          const remainingCents = Math.max(0, c.monthlyCapCents - spentCents);
          return {
            brandId: c.brandId,
            monthlyCapCents: c.monthlyCapCents,
            monthlyCapCredits: centsToCredits(c.monthlyCapCents),
            spentCents,
            remainingCents,
            exhausted: remainingCents === 0,
          };
        }),
      );

      return { brands };
    },
  });
}

/** Thrown by neither tool today; exported so a caller can narrow on it later. */
export const BRAND_BUDGET_NOT_FOUND = () =>
  new ToolError('NOT_FOUND', 'That brand has no spending limit.', {});
