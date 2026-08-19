import type { CreditStore, ToolCtx } from '@sparksocial/tools';

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

  const { monthlyCapCents, spentCents } = await credits.budget(orgId, now);

  return {
    // Clamped at zero. A negative remaining is arithmetically correct after an
    // overspend and reads as nonsense on a usage bar, and `policy.ts` compares
    // `estimated > remaining` — which is already false for every positive
    // estimate once this hits zero.
    remainingCents: Math.max(0, monthlyCapCents - spentCents),
    monthlyCapCents,
  };
}
