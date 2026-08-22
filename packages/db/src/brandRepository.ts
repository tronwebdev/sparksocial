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
            postsPerWeek: DEFAULT_POSTS_PER_WEEK,
            // Same column defaults as the schema. Both are non-optional on
            // `BrandGovernance`: a brand always has a strict-mode answer and a
            // zone, and this fallback must not be the one place they are absent.
            strictMode: false,
            timezone: 'UTC',
            engagementAutonomy: 'off',
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

    async setFrequency({ brandId, orgId, postsPerWeek }) {
      await db
        .insert(brands)
        .values({ id: brandId, orgId, postsPerWeek })
        .onConflictDoUpdate({
          target: brands.id,
          set: { postsPerWeek, updatedAt: new Date() },
        });

      const [row] = await db
        .select()
        .from(brands)
        .where(and(eq(brands.id, brandId), eq(brands.orgId, orgId)))
        .limit(1);

      if (!row) throw new Error(`Brand ${brandId} is not in this organisation.`);
      return toGovernance(row);
    },

    async setPolicy({ brandId, orgId, patch }) {
      const set: Partial<typeof brands.$inferInsert> = { updatedAt: new Date() };
      if (patch.familyOverrides !== undefined) set.familyOverrides = patch.familyOverrides ?? null;
      if (patch.restrictedPlatforms !== undefined) set.restrictedPlatforms = patch.restrictedPlatforms ?? null;
      if (patch.restrictedContentTypes !== undefined) set.restrictedContentTypes = patch.restrictedContentTypes ?? null;
      if (patch.quietWindows !== undefined) {
        set.quietWindows = patch.quietWindows
          ? patch.quietWindows.map((w) => ({ from: w.from.toISOString(), to: w.to.toISOString(), reason: w.reason }))
          : null;
      }
      if (patch.permissions !== undefined) set.permissions = patch.permissions ?? null;
      if (patch.publishRoles !== undefined) set.publishRoles = patch.publishRoles ?? null;
      if (patch.maxPendingReview !== undefined) set.maxPendingReview = patch.maxPendingReview ?? null;

      await db
        .insert(brands)
        .values({ id: brandId, orgId, ...set })
        .onConflictDoUpdate({ target: brands.id, set });

      const [row] = await db
        .select()
        .from(brands)
        .where(and(eq(brands.id, brandId), eq(brands.orgId, orgId)))
        .limit(1);

      if (!row) throw new Error(`Brand ${brandId} is not in this organisation.`);
      return toGovernance(row);
    },

    /**
     * `brand.governance.set`. Same merge-not-replace shape as `setPolicy` above,
     * and for the same reason: onboarding writes the timezone, the settings
     * screen writes the restricted topics, and neither may clear the other's work.
     */
    async setGovernance({ brandId, orgId, patch }) {
      const set: Partial<typeof brands.$inferInsert> = { updatedAt: new Date() };
      if (patch.restrictedTopics !== undefined) set.restrictedTopics = patch.restrictedTopics ?? null;
      if (patch.claimsToAvoid !== undefined) set.claimsToAvoid = patch.claimsToAvoid ?? null;
      if (patch.strictMode !== undefined) set.strictMode = patch.strictMode;
      if (patch.toneVector !== undefined) set.toneVector = patch.toneVector ?? null;
      if (patch.bannedPhrases !== undefined) set.bannedPhrases = patch.bannedPhrases ?? null;
      if (patch.logoUrl !== undefined) set.logoUrl = patch.logoUrl ?? null;
      if (patch.brandColors !== undefined) set.brandColors = patch.brandColors ?? null;
      if (patch.timezone !== undefined) set.timezone = patch.timezone;
      if (patch.postingWindows !== undefined) set.postingWindows = patch.postingWindows ?? null;
      if (patch.engagementAutonomy !== undefined) set.engagementAutonomy = patch.engagementAutonomy;
      if (patch.salesQualification !== undefined) set.salesQualification = patch.salesQualification;
      if (patch.salesHandoff !== undefined) set.salesHandoff = patch.salesHandoff;
      if (patch.salesDestination !== undefined) set.salesDestination = patch.salesDestination;
      if (patch.salesEscalationKeywords !== undefined) set.salesEscalationKeywords = patch.salesEscalationKeywords;
      if (patch.engagementTypes !== undefined) set.engagementTypes = patch.engagementTypes ?? null;

      await db
        .insert(brands)
        .values({ id: brandId, orgId, ...set })
        .onConflictDoUpdate({ target: brands.id, set });

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

/** Mirrors the column default in `schema.ts`. */
const DEFAULT_POSTS_PER_WEEK = 3;

function toGovernance(row: typeof brands.$inferSelect): BrandGovernance {
  return {
    brandId: row.id,
    name: row.name,
    approvalMode: row.approvalMode as ApprovalMode,
    createdAt: row.createdAt,
    agentPaused: row.agentPaused,
    postsPerWeek: row.postsPerWeek,
    ...(row.pausedAt ? { pausedAt: row.pausedAt } : {}),
    ...(row.pausedBy ? { pausedBy: row.pausedBy } : {}),
    ...(row.pauseReason ? { pauseReason: row.pauseReason } : {}),
    ...(row.familyOverrides ? { familyOverrides: row.familyOverrides as BrandGovernance['familyOverrides'] } : {}),
    ...(row.restrictedPlatforms ? { restrictedPlatforms: row.restrictedPlatforms } : {}),
    ...(row.restrictedContentTypes ? { restrictedContentTypes: row.restrictedContentTypes } : {}),
    ...(row.quietWindows
      ? { quietWindows: row.quietWindows.map((w) => ({ from: new Date(w.from), to: new Date(w.to), reason: w.reason })) }
      : {}),
    ...(row.permissions ? { permissions: row.permissions } : {}),
    ...(row.publishRoles ? { publishRoles: row.publishRoles as BrandGovernance['publishRoles'] } : {}),
    ...(row.maxPendingReview !== null ? { maxPendingReview: row.maxPendingReview } : {}),
    // Non-optional on `BrandGovernance` — every brand has a strict-mode answer
    // and a zone, and "unset" is not one of them. The column defaults carry it.
    strictMode: row.strictMode,
    timezone: row.timezone,
    engagementAutonomy: row.engagementAutonomy as BrandGovernance['engagementAutonomy'],
    ...(row.salesQualification ? { salesQualification: row.salesQualification } : {}),
    ...(row.salesHandoff ? { salesHandoff: row.salesHandoff } : {}),
    ...(row.salesDestination ? { salesDestination: row.salesDestination } : {}),
    ...(row.salesEscalationKeywords ? { salesEscalationKeywords: row.salesEscalationKeywords } : {}),
    ...(row.restrictedTopics ? { restrictedTopics: row.restrictedTopics } : {}),
    ...(row.claimsToAvoid ? { claimsToAvoid: row.claimsToAvoid } : {}),
    ...(row.toneVector ? { toneVector: row.toneVector } : {}),
    ...(row.bannedPhrases ? { bannedPhrases: row.bannedPhrases } : {}),
    ...(row.logoUrl ? { logoUrl: row.logoUrl } : {}),
    ...(row.brandColors ? { brandColors: row.brandColors } : {}),
    ...(row.postingWindows ? { postingWindows: row.postingWindows } : {}),
    ...(row.engagementTypes ? { engagementTypes: row.engagementTypes } : {}),
  };
}
