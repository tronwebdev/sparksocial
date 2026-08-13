import type { CreditStore } from '@sparksocial/tools/defineTool';
import { periodStart } from '@sparksocial/db/creditRepository';
import { envNum } from './env.js';

/**
 * In-memory credit ledger — the dev counterpart to
 * `packages/db/src/creditRepository.ts`.
 *
 * Enforces the same two properties as the Postgres one, because both are
 * properties of the *ledger* rather than of the storage:
 *
 * 1. **One charge per call.** The unique index becomes a Set membership check.
 * 2. **The period boundary is UTC calendar month.** Shared with the real
 *    implementation via `periodStart` rather than reimplemented — two copies of
 *    a date boundary is exactly the kind of thing that agrees in tests and
 *    disagrees on the 1st.
 *
 * The cap is settable so local development can exercise the deny path without
 * spending five dollars of real vendor calls to reach it.
 */
export function createDevCreditStore(
  monthlyCapCents = envNum('DEV_MONTHLY_CAP_CENTS', 500_00),
): CreditStore & { entries(): Array<{ callId: string; costCents: number }> } {
  const charged = new Map<string, { orgId: string; costCents: number; at: Date }>();

  return {
    entries: () => [...charged.entries()].map(([callId, e]) => ({ callId, costCents: e.costCents })),

    async budget(orgId, now) {
      const from = periodStart(now).getTime();
      let spentCents = 0;
      for (const e of charged.values()) {
        if (e.orgId === orgId && e.at.getTime() >= from) spentCents += e.costCents;
      }
      return { monthlyCapCents, spentCents };
    },

    async record({ callId, orgId, costCents, at }) {
      // First write wins, like `onConflictDoNothing`.
      if (charged.has(callId)) return;
      charged.set(callId, { orgId, costCents, at });
    },
  };
}
