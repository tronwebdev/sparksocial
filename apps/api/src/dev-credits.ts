import { randomUUID } from 'node:crypto';
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
  // `tool` is carried so `spendByTool` can group on it, the same as the real
  // ledger's column. Without it the dev store could answer "how much" and not
  // "on what", which is the whole of what `org.usage.get` adds.
  const charged = new Map<string, { orgId: string; tool: string; costCents: number; at: Date }>();

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

    /**
     * Mirrors `creditRepository.spendByTool`, including the exclusion that
     * matters: grants are negative rows and are left out, or
     * `org.credits.grant` shows up as the biggest line item on the panel.
     */
    async spendByTool(orgId, now, limit) {
      const from = periodStart(now).getTime();
      const byTool = new Map<string, { costCents: number; calls: number }>();

      for (const e of charged.values()) {
        if (e.orgId !== orgId || e.at.getTime() < from || e.costCents <= 0) continue;
        const acc = byTool.get(e.tool) ?? { costCents: 0, calls: 0 };
        acc.costCents += e.costCents;
        acc.calls += 1;
        byTool.set(e.tool, acc);
      }

      return [...byTool.entries()]
        .map(([tool, acc]) => ({ tool, ...acc }))
        .sort((a, b) => b.costCents - a.costCents)
        .slice(0, limit);
    },

    async record({ callId, orgId, tool, costCents, at }) {
      // First write wins, like `onConflictDoNothing`.
      if (charged.has(callId)) return;
      charged.set(callId, { orgId, tool, costCents, at });
    },

    async grant({ orgId, amountCents }) {
      charged.set(`grant_${randomUUID()}`, {
        orgId,
        // Named so a grant is legible in `entries()` and excluded by name as
        // well as by sign in `spendByTool`.
        tool: 'org.credits.grant',
        costCents: -Math.abs(amountCents),
        at: new Date(),
      });
    },
  };
}
