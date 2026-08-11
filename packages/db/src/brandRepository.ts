import { and, eq } from 'drizzle-orm';
import type { ApprovalMode, BrandGovernance, BrandGovernanceStore } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import { brands } from './schema.js';

/**
 * `brands` backed by Postgres — the approval ladder's storage (PRD §7.1, §9).
 *
 * Not scoped through `scoped.ts`: a governance setting is configuration, not
 * client-confidential material, so `brands` sits outside `SCOPED_TABLES` for the
 * same reason `genomes` and `campaigns` do. Every query still filters on
 * `orgId`.
 */
export function createBrandRepository(db: Database): BrandGovernanceStore {
  return {
    async get(brandId, orgId, name) {
      const [row] = await db
        .select()
        .from(brands)
        .where(and(eq(brands.id, brandId), eq(brands.orgId, orgId)))
        .limit(1);

      if (row) return toGovernance(row);

      // Upsert on first read. A brand with no row must still resolve to a
      // defined rung, and `onConflictDoNothing` + re-read handles the race
      // where two requests for a new brand arrive together.
      await db
        .insert(brands)
        .values({ id: brandId, orgId, name: name ?? '' })
        .onConflictDoNothing();

      const [created] = await db
        .select()
        .from(brands)
        .where(and(eq(brands.id, brandId), eq(brands.orgId, orgId)))
        .limit(1);

      // The schema default is `review_first_week`, deliberately — see setApprovalMode.
      return created
        ? toGovernance(created)
        : {
            brandId,
            name: name ?? '',
            approvalMode: 'review_first_week',
            createdAt: new Date(),
            agentPaused: false,
          };
    },

    async setApprovalMode(brandId, orgId, mode) {
      await db.insert(brands).values({ id: brandId, orgId, approvalMode: mode }).onConflictDoUpdate({
        target: brands.id,
        set: { approvalMode: mode, updatedAt: new Date() },
      });

      const [row] = await db
        .select()
        .from(brands)
        .where(and(eq(brands.id, brandId), eq(brands.orgId, orgId)))
        .limit(1);

      // A row that exists under a different org must not be readable here, and
      // the upsert above keys on id alone — so the scoped re-read is what makes
      // a cross-org write surface as an error rather than silently succeeding.
      if (!row) {
        throw new Error(`Brand ${brandId} is not in this organisation.`);
      }
      return toGovernance(row);
    },

    async setAgentPaused({ brandId, orgId, paused, by, reason }) {
      // Ensure the row exists, then write scoped. Same shape as
      // setApprovalMode: the upsert keys on id alone, so the scoped re-read
      // below is what stops a cross-org write succeeding silently.
      await db
        .insert(brands)
        .values({ id: brandId, orgId, agentPaused: paused })
        .onConflictDoUpdate({
          target: brands.id,
          set: {
            agentPaused: paused,
            // Cleared on resume, so a stale "paused by X three weeks ago"
            // never sits next to a running agent.
            pausedAt: paused ? new Date() : null,
            pausedBy: paused ? by : null,
            pauseReason: paused ? (reason ?? null) : null,
            updatedAt: new Date(),
          },
        });

      const [row] = await db
        .select()
        .from(brands)
        .where(and(eq(brands.id, brandId), eq(brands.orgId, orgId)))
        .limit(1);

      if (!row) throw new Error(`Brand ${brandId} is not in this organisation.`);
      return toGovernance(row);
    },
  };
}

function toGovernance(row: typeof brands.$inferSelect): BrandGovernance {
  return {
    brandId: row.id,
    name: row.name,
    approvalMode: row.approvalMode as ApprovalMode,
    createdAt: row.createdAt,
    agentPaused: row.agentPaused,
    ...(row.pausedAt ? { pausedAt: row.pausedAt } : {}),
    ...(row.pausedBy ? { pausedBy: row.pausedBy } : {}),
    ...(row.pauseReason ? { pauseReason: row.pauseReason } : {}),
  };
}
