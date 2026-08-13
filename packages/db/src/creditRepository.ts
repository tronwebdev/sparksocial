import { randomUUID } from 'node:crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { CreditStore } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import { creditLedger, orgBudgets } from './schema.js';

/**
 * `credit_ledger` + `org_budgets` backed by Postgres — plan §9.
 *
 * Not routed through `scoped.ts`: spend is organisation-level accounting, not
 * genome-confidential material, same rationale as `brands` and `campaigns`.
 * Every query here filters on `orgId`.
 */
export function createCreditRepository(db: Database): CreditStore {
  return {
    async budget(orgId, now) {
      const [capRow] = await db
        .select({ cap: orgBudgets.monthlyCapCents })
        .from(orgBudgets)
        .where(eq(orgBudgets.orgId, orgId))
        .limit(1);

      let cap = capRow?.cap;
      if (cap === undefined) {
        // Upsert on first read, like `brands.get`. `onConflictDoNothing` plus a
        // re-read handles two requests for a new org arriving together.
        await db.insert(orgBudgets).values({ orgId }).onConflictDoNothing();
        const [created] = await db
          .select({ cap: orgBudgets.monthlyCapCents })
          .from(orgBudgets)
          .where(eq(orgBudgets.orgId, orgId))
          .limit(1);
        cap = created?.cap ?? DEFAULT_MONTHLY_CAP_CENTS;
      }

      const [spent] = await db
        .select({ total: sql<string>`coalesce(sum(${creditLedger.costCents}), 0)` })
        .from(creditLedger)
        .where(and(eq(creditLedger.orgId, orgId), gte(creditLedger.at, periodStart(now))));

      // `sum()` comes back as a string from the driver — Postgres widens the
      // sum of an int4 column to bigint, and bigint is not safe as a JS number
      // in general. It is here (cents, capped monthly), but parsing explicitly
      // beats relying on the driver's coercion, which differs across versions.
      return { monthlyCapCents: cap, spentCents: Number(spent?.total ?? 0) };
    },

    async record({ callId, orgId, brandId, tool, costCents, at }) {
      await db
        .insert(creditLedger)
        .values({
          id: randomUUID(),
          orgId,
          callId,
          tool,
          costCents,
          at,
          ...(brandId ? { brandId } : {}),
        })
        // The unique index on `call_id` is the guarantee; this is what turns
        // hitting it into a no-op instead of an exception. `invokeTool` calls
        // this *after* the tool succeeded, so throwing here would fail a call
        // whose side effects already happened.
        .onConflictDoNothing({ target: creditLedger.callId });
    },
  };
}

/** Mirrors the column default in `schema.ts`. */
const DEFAULT_MONTHLY_CAP_CENTS = 500_00;

/**
 * First instant of the current calendar month, UTC.
 *
 * UTC rather than the brand's locale on purpose. A period boundary that moves
 * with the viewer would let the same ledger produce two different balances, and
 * the one thing a spend limit cannot be is ambiguous about which side of the
 * line a charge fell on.
 */
export function periodStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
