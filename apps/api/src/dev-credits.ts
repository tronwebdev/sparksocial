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
  const charged = new Map<
    string,
    { orgId: string; brandId?: string; tool: string; costCents: number; at: Date }
  >();
  const caps = new Map<string, number>();
  /** `${orgId}:${brandId}` → cap. Absent is no cap, never zero. */
  const brandCaps = new Map<string, number>();
  const allocations = new Map<string, Record<string, number>>();

  return {
    entries: () => [...charged.entries()].map(([callId, e]) => ({ callId, costCents: e.costCents })),

    async budget(orgId, now) {
      const from = periodStart(now).getTime();
      let spentCents = 0;
      const byToolCents = new Map<string, number>();
      for (const e of charged.values()) {
        if (e.orgId !== orgId || e.at.getTime() < from) continue;
        spentCents += e.costCents;
        byToolCents.set(e.tool, (byToolCents.get(e.tool) ?? 0) + e.costCents);
      }
      return {
        monthlyCapCents: caps.get(orgId) ?? monthlyCapCents,
        spentCents,
        byTool: [...byToolCents].map(([tool, costCents]) => ({ tool, costCents })),
        allocationsCents: { ...(allocations.get(orgId) ?? {}) },
      };
    },

    /**
     * The dev store honours allocations for the same reason it honours the cap:
     * a limit that only bites in production is a limit nobody exercises until a
     * customer does.
     */
    /*
     * Brand caps, held in the same map-of-numbers spirit as the rest of this
     * store. A brand with no entry has no cap, which is the production
     * meaning too — absent is unlimited-within-the-org, never zero.
     */
    async brandBudget(orgId, brandId) {
      const cap = brandCaps.get(`${orgId}:${brandId}`);
      let spent = 0;
      for (const e of charged.values()) {
        if (e.orgId === orgId && e.brandId === brandId) spent += e.costCents;
      }
      return { capCents: cap ?? null, spentCents: spent };
    },

    async listBrandBudgets(orgId) {
      return [...brandCaps.entries()]
        .filter(([k]) => k.startsWith(`${orgId}:`))
        .map(([k, monthlyCapCents]) => ({ brandId: k.slice(orgId.length + 1), monthlyCapCents }));
    },

    async setBrandBudget({ orgId, brandId, monthlyCapCents }) {
      const key = `${orgId}:${brandId}`;
      if (monthlyCapCents === null) brandCaps.delete(key);
      else brandCaps.set(key, monthlyCapCents);
    },

    async setBudget({ orgId, monthlyCapCents: cap, allocationsCents }) {
      if (cap !== undefined) caps.set(orgId, cap);
      if (allocationsCents !== undefined) allocations.set(orgId, { ...allocationsCents });
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

    async record({ callId, orgId, brandId, tool, costCents, at }) {
      // First write wins, like `onConflictDoNothing`.
      if (charged.has(callId)) return;
      // `brandId` is kept so this store can answer the per-brand question too.
      // The real ledger has carried the column from the start; the dev store
      // dropped it on the floor, so a brand cap here was uncheckable.
      charged.set(callId, { orgId, ...(brandId ? { brandId } : {}), tool, costCents, at });
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
