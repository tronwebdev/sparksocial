import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { BrandEngagementStore } from '@sparksocial/tools/defineTool';
import type { EngagementPlatform } from '@sparksocial/shared';
import type { Database } from './client.js';
import { brandEngagementSettings } from './schema.js';

/**
 * `brand_engagement_settings` backed by Postgres — `Settings WS EI Platforms`.
 *
 * Not routed through `scoped.ts`: a per-platform engagement rule is addressed to
 * a *brand* and carries no genome-confidential material, the same reason
 * `brands` and `campaigns` sit outside `SCOPED_TABLES`. Every query here still
 * filters on `orgId`.
 *
 * ── An absent row is the feature ──────────────────────────────────────────
 *
 * There is no seeding and no backfill. A brand with no rows behaves exactly as it
 * did before this table existed, because `resolvePlatformEngagement` treats a
 * missing row as "use the brand's setting" — so the table only ever holds
 * *overrides*, and reading it is optional everywhere.
 */
export function createBrandEngagementRepository(db: Database): BrandEngagementStore {
  return {
    async list(brandId, orgId) {
      const rows = await db
        .select({
          platform: brandEngagementSettings.platform,
          autonomy: brandEngagementSettings.autonomy,
          engagementTypes: brandEngagementSettings.engagementTypes,
          enabled: brandEngagementSettings.enabled,
        })
        .from(brandEngagementSettings)
        .where(and(eq(brandEngagementSettings.orgId, orgId), eq(brandEngagementSettings.brandId, brandId)));
      /*
       * The column is `text`, so Drizzle types it `string`. The only writer is
       * `set` below, reached only through `brand.engagement.platforms.set`,
       * whose input is `platform: EngagementPlatform` — so the row holds one of
       * the five or the row does not exist.
       */
      return rows.map((r) => ({
        ...r,
        platform: r.platform as EngagementPlatform,
        engagementTypes: r.engagementTypes ?? null,
      }));
    },

    async set({ brandId, orgId, platform, autonomy, engagementTypes, enabled }) {
      /**
       * `onConflictDoUpdate` on `(brand_id, platform)` rather than a read then a
       * write. Two people on the same settings screen would otherwise both read
       * "no row" and both insert, and the unique index would fail the second —
       * which is correct behaviour reported as an error. The upsert makes the
       * second a merge.
       *
       * Only the fields the caller named are written, so setting `enabled` does
       * not silently clear an autonomy override somebody else just made.
       */
      const patch: Record<string, unknown> = { updatedAt: sql`now()` };
      if (autonomy !== undefined) patch.autonomy = autonomy;
      if (engagementTypes !== undefined) patch.engagementTypes = engagementTypes;
      if (enabled !== undefined) patch.enabled = enabled;

      const [row] = await db
        .insert(brandEngagementSettings)
        .values({
          id: `bes_${randomUUID()}`,
          orgId,
          brandId,
          platform,
          ...(autonomy !== undefined ? { autonomy } : {}),
          ...(engagementTypes !== undefined ? { engagementTypes } : {}),
          ...(enabled !== undefined ? { enabled } : {}),
        })
        .onConflictDoUpdate({
          target: [brandEngagementSettings.brandId, brandEngagementSettings.platform],
          set: patch,
        })
        .returning({
          platform: brandEngagementSettings.platform,
          autonomy: brandEngagementSettings.autonomy,
          engagementTypes: brandEngagementSettings.engagementTypes,
          enabled: brandEngagementSettings.enabled,
        });
      return { ...row!, platform: row!.platform as EngagementPlatform, engagementTypes: row!.engagementTypes ?? null };
    },

    async clear(brandId, orgId, platform) {
      await db
        .delete(brandEngagementSettings)
        .where(
          and(
            eq(brandEngagementSettings.orgId, orgId),
            eq(brandEngagementSettings.brandId, brandId),
            eq(brandEngagementSettings.platform, platform),
          ),
        );
    },
  };
}
