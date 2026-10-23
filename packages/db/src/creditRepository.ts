import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, gte, sql } from 'drizzle-orm';
import type { CreditStore } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import { brandBudgets, creditLedger, orgBudgets, orgCreditAllocations } from './schema.js';

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

      /**
       * The period's spend, grouped by tool.
       *
       * Grouped rather than a bare `sum()` because the per-category sub-caps need
       * the breakdown on every paid call, and this is the same `(org_id, at)`
       * index scan with a hash aggregate over at most a few dozen rows on top —
       * cheaper than the second round-trip the alternative costs. The total is
       * summed from the same rows, which also keeps the two from disagreeing.
       *
       * Grants are included in the total (a negative row is a refund and really
       * does reduce what has been spent) and fall out of the categories on their
       * own, because `org.credits.grant` belongs to no category.
       */
      const rows = await db
        .select({
          tool: creditLedger.tool,
          costCents: sql<string>`sum(${creditLedger.costCents})`,
        })
        .from(creditLedger)
        .where(and(eq(creditLedger.orgId, orgId), gte(creditLedger.at, periodStart(now))))
        .groupBy(creditLedger.tool);

      const allocationRows = await db
        .select({ category: orgCreditAllocations.category, capCents: orgCreditAllocations.capCents })
        .from(orgCreditAllocations)
        .where(eq(orgCreditAllocations.orgId, orgId));

      // `sum()` comes back as a string from the driver — Postgres widens the
      // sum of an int4 column to bigint, and bigint is not safe as a JS number
      // in general. It is here (cents, capped monthly), but parsing explicitly
      // beats relying on the driver's coercion, which differs across versions.
      const byTool = rows.map((r) => ({ tool: r.tool, costCents: Number(r.costCents) }));

      return {
        monthlyCapCents: cap,
        spentCents: byTool.reduce((n, r) => n + r.costCents, 0),
        byTool,
        allocationsCents: Object.fromEntries(allocationRows.map((r) => [r.category, r.capCents])),
      };
    },

    /**
     * `org.usage.get`'s breakdown — one row per tool that has actually been
     * charged this period, biggest first.
     *
     * Negative rows are grants (see this table's own comment on `costCents`) and
     * are excluded: a goodwill credit is not a tool that consumed anything, and
     * including it would show `org.credits.grant` as the biggest line item on
     * the panel.
     */
    async spendByTool(orgId, now, limit) {
      const rows = await db
        .select({
          tool: creditLedger.tool,
          costCents: sql<string>`sum(${creditLedger.costCents})`,
          calls: sql<string>`count(*)`,
        })
        .from(creditLedger)
        .where(
          and(
            eq(creditLedger.orgId, orgId),
            gte(creditLedger.at, periodStart(now)),
            gt(creditLedger.costCents, 0),
          ),
        )
        .groupBy(creditLedger.tool)
        .orderBy(desc(sql`sum(${creditLedger.costCents})`))
        .limit(limit);

      // Same string-to-number reasoning as `budget` above: Postgres widens a
      // sum of int4 to bigint and the driver hands it back as a string.
      return rows.map((r) => ({
        tool: r.tool,
        costCents: Number(r.costCents),
        calls: Number(r.calls),
      }));
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

    async grant({ orgId, brandId, amountCents, reason, externalRef }) {
      // Negative costCents is a credit, per this table's own documented
      // convention ("positive is a spend, negative a refund or a goodwill
      // credit"). `callId` is null — a manual grant is not billing any real
      // tool_calls row, so there is nothing to key idempotency on the way
      // `record()` does; `org.credits.grant`'s own `idempotent: false`
      // declaration is what stops a retried call from granting twice.
      await db
        .insert(creditLedger)
        .values({
          id: randomUUID(),
          orgId,
          costCents: -Math.abs(amountCents),
          tool: 'org.credits.grant',
          reason,
          at: new Date(),
          ...(brandId ? { brandId } : {}),
          ...(externalRef ? { externalRef } : {}),
        })
        /*
         * Dropped rather than failed on a repeat.
         *
         * `credit_ledger_external_idx` is unique, so a redelivered payment
         * webhook collides here and this is a no-op — which is the correct
         * outcome and must look like success to the caller. A thrown error
         * would make the webhook answer non-2xx, and Stripe would redeliver
         * it again, forever.
         *
         * A grant with no external reference has nothing to collide on and
         * behaves exactly as it did: `org.credits.grant`'s own
         * `idempotent: false` is what guards that path.
         */
        .onConflictDoNothing({ target: creditLedger.externalRef });
    },

    /**
     * One brand's cap and its spend this period.
     *
     * Two statements rather than a join: the cap is a single-row primary-key
     * lookup and the spend is an index scan over the period, and a join would
     * make the planner choose between them. Both are on the hot path — this
     * runs on every paid call with a brand in scope — so they are issued
     * together and awaited together.
     *
     * A brand with no row has no cap. That is the state every brand starts in
     * and the one the policy reads as "bounded only by the org".
     */
    async brandBudget(orgId, brandId, now) {
      const [capRow, spendRows] = await Promise.all([
        db
          .select({ cap: brandBudgets.monthlyCapCents })
          .from(brandBudgets)
          .where(and(eq(brandBudgets.brandId, brandId), eq(brandBudgets.orgId, orgId)))
          .limit(1),
        db
          .select({ total: sql<string>`coalesce(sum(${creditLedger.costCents}), 0)` })
          .from(creditLedger)
          .where(
            and(
              eq(creditLedger.orgId, orgId),
              eq(creditLedger.brandId, brandId),
              gte(creditLedger.at, periodStart(now)),
            ),
          ),
      ]);

      return {
        capCents: capRow[0]?.cap ?? null,
        // Same bigint-as-string caution as `budget` — parsed, not coerced.
        spentCents: Number(spendRows[0]?.total ?? 0),
      };
    },

    async listBrandBudgets(orgId) {
      const rows = await db
        .select({ brandId: brandBudgets.brandId, monthlyCapCents: brandBudgets.monthlyCapCents })
        .from(brandBudgets)
        .where(eq(brandBudgets.orgId, orgId));
      return rows;
    },

    /**
     * `null` deletes the row, which is how "no cap" is expressed.
     *
     * Not a zero: zero is "this brand spends nothing", and a screen that
     * cleared a cap by writing zero would silently freeze the brand it was
     * trying to free. The two have to stay different all the way down.
     */
    async setBrandBudget({ orgId, brandId, monthlyCapCents }) {
      if (monthlyCapCents === null) {
        await db
          .delete(brandBudgets)
          .where(and(eq(brandBudgets.brandId, brandId), eq(brandBudgets.orgId, orgId)));
        return;
      }
      await db
        .insert(brandBudgets)
        .values({ brandId, orgId, monthlyCapCents })
        .onConflictDoUpdate({
          target: brandBudgets.brandId,
          set: { monthlyCapCents, orgId, updatedAt: new Date() },
        });
    },

    async setBudget({ orgId, monthlyCapCents, allocationsCents }) {
      await db.transaction(async (tx) => {
        if (monthlyCapCents !== undefined) {
          await tx
            .insert(orgBudgets)
            .values({ orgId, monthlyCapCents })
            .onConflictDoUpdate({
              target: orgBudgets.orgId,
              set: { monthlyCapCents, updatedAt: new Date() },
            });
        }

        if (allocationsCents !== undefined) {
          /**
           * Replace, not merge. The caller sends the complete set, so a category
           * it left out is one the workspace has removed the sub-cap from — and
           * merging would make removal impossible to express without a second
           * verb. Inside a transaction so a failed write cannot leave the
           * workspace with no allocations at all, which reads as "unlimited".
           */
          await tx.delete(orgCreditAllocations).where(eq(orgCreditAllocations.orgId, orgId));
          const rows = Object.entries(allocationsCents).map(([category, capCents]) => ({
            orgId,
            category,
            capCents,
            updatedAt: new Date(),
          }));
          if (rows.length) await tx.insert(orgCreditAllocations).values(rows);
        }
      });
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
