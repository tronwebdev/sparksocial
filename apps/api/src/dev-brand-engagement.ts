import type { BrandEngagementStore, PlatformEngagementRow } from '@sparksocial/tools/defineTool';

/**
 * In-memory per-platform engagement overrides — the dev counterpart to
 * `packages/db/src/brandEngagementRepository.ts`.
 *
 * Seeds nothing, deliberately. An absent row means "follow the brand", so a dev
 * store that pre-populated all five platforms would make the inheritance path —
 * the one every existing brand is on — the one path never exercised locally.
 */
export function createDevBrandEngagementStore(): BrandEngagementStore & { size(): number } {
  /** Keyed `${brandId}:${platform}`, mirroring the unique index. */
  const rows = new Map<string, PlatformEngagementRow & { brandId: string; orgId: string }>();
  const key = (brandId: string, platform: string) => `${brandId}:${platform}`;

  const copy = (r: PlatformEngagementRow): PlatformEngagementRow => ({
    platform: r.platform,
    autonomy: r.autonomy,
    engagementTypes: r.engagementTypes ? [...r.engagementTypes] : null,
    enabled: r.enabled,
  });

  return {
    size: () => rows.size,

    async list(brandId, orgId) {
      return [...rows.values()]
        .filter((r) => r.brandId === brandId && r.orgId === orgId)
        .map(copy);
    },

    async set({ brandId, orgId, platform, autonomy, engagementTypes, enabled }) {
      const k = key(brandId, platform);
      const existing = rows.get(k);
      /**
       * Merge, matching the repository's `onConflictDoUpdate`: only the fields
       * the caller named are written. A dev store that replaced the row would
       * make "set enabled" silently clear an autonomy override here and not in
       * production, which is the divergence these mirrors exist to prevent.
       */
      const row =
        existing && existing.orgId === orgId
          ? existing
          : { brandId, orgId, platform, autonomy: null, engagementTypes: null, enabled: true };
      if (autonomy !== undefined) row.autonomy = autonomy;
      if (engagementTypes !== undefined) row.engagementTypes = engagementTypes;
      if (enabled !== undefined) row.enabled = enabled;
      rows.set(k, row);
      return copy(row);
    },

    async clear(brandId, orgId, platform) {
      const row = rows.get(key(brandId, platform));
      if (row && row.orgId === orgId) rows.delete(key(brandId, platform));
    },
  };
}
