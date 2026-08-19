import type { AnalyticsStore } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import * as scoped from './scoped.js';

/**
 * `ScopedDb['analytics']` backed by Postgres — `analytics.sync`'s one write.
 *
 * Never touches `content_metrics` directly; delegates to `scoped.ts`, the only
 * module the isolation test permits to import scoped tables (`content_metrics`
 * carries the same client-confidential weight `content_items` does).
 */
export function createAnalyticsRepository(db: Database): AnalyticsStore {
  return {
    async record({ genomeId, orgId, ...args }) {
      const row = await scoped.upsertContentMetrics(db, { orgId, brandId: orgId, genomeId }, args);
      return {
        contentItemId: row.contentItemId,
        platform: row.platform,
        likes: row.likes,
        comments: row.comments,
        shares: row.shares,
        views: row.views,
        impressions: row.impressions,
        syncedAt: row.syncedAt,
      };
    },

    async listForItems(contentItemIds, orgId, genomeId) {
      const rows = await scoped.getContentMetricsForItems(db, { orgId, brandId: orgId, genomeId }, contentItemIds);
      return rows.map((row) => ({
        contentItemId: row.contentItemId,
        platform: row.platform,
        likes: row.likes,
        comments: row.comments,
        shares: row.shares,
        views: row.views,
        impressions: row.impressions,
        syncedAt: row.syncedAt,
      }));
    },
  };
}
