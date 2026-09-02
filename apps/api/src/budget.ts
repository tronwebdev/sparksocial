import type { CreditStore, ToolCtx } from '@sparksocial/tools';
import { creditCategoryFor } from '@sparksocial/shared/credits';

/**
 * Turn a ledger reading into the `budget` shape `policy.ts` rule 4 expects.
 *
 * Shared by both resolvers rather than written twice. The two of them already
 * diverged once on `agentPaused` — `dev-auth.ts` dropped it and the kill switch
 * was inert in a running system while every unit test passed — and a spend
 * limit that is enforced under Clerk and permissive in development is the same
 * bug with a larger bill attached.
 */
export async function readBudget(
  credits: CreditStore | undefined,
  orgId: string,
  now: Date = new Date(),
): Promise<ToolCtx['budget']> {
  /**
   * No ledger configured means no enforcement, and it says so loudly at boot
   * (`index.ts`) rather than quietly here.
   *
   * The permissive default is deliberate and is the *only* place in this file
   * where permissive is right: a missing ledger is a misconfiguration, and
   * failing every paid tool call closed would take the product down rather than
   * protect anyone's money. Compare `brands.get`, where the conservative
   * default is correct because the risk runs the other way.
   */
  if (!credits) return { remainingCents: Number.MAX_SAFE_INTEGER, monthlyCapCents: 0 };

  const { monthlyCapCents, spentCents, byTool, allocationsCents } = await credits.budget(orgId, now);

  /**
   * Per-category sub-caps, turned into what is *left* under each.
   *
   * Only the categories the workspace actually bounded appear. An unbounded
   * category must stay absent rather than arriving as a large number, because
   * `policy.ts` keys its check on presence: a default would make "no allocation
   * set" indistinguishable from "an allocation that happens to be generous", and
   * the two behave differently the moment someone lowers the monthly cap.
   */
  const spentByCategory = new Map<string, number>();
  /**
   * Tolerant of a store that returns no breakdown, for the same reason a missing
   * ledger is tolerated above: no breakdown means no sub-caps, and the monthly
   * cap still applies. Throwing here would take out every paid call in the
   * product over a field that only narrows what is allowed.
   */
  for (const row of byTool ?? []) {
    const category = creditCategoryFor(row.tool);
    if (!category) continue;
    spentByCategory.set(category, (spentByCategory.get(category) ?? 0) + row.costCents);
  }

  const remainingByCategory: Record<string, number> = {};
  for (const [category, capCents] of Object.entries(allocationsCents ?? {})) {
    remainingByCategory[category] = Math.max(0, capCents - (spentByCategory.get(category) ?? 0));
  }

  return {
    // Clamped at zero. A negative remaining is arithmetically correct after an
    // overspend and reads as nonsense on a usage bar, and `policy.ts` compares
    // `estimated > remaining` — which is already false for every positive
    // estimate once this hits zero.
    remainingCents: Math.max(0, monthlyCapCents - spentCents),
    monthlyCapCents,
    ...(Object.keys(remainingByCategory).length ? { remainingByCategory } : {}),
  };
}
