import type { TrendWatchlistStore } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import * as scoped from './scoped.js';

/** `trend_watchlist` backed by Postgres. Genome-scoped through `scoped.ts` — which trends a brand is watching is client-confidential. */
export function createTrendRepository(db: Database): TrendWatchlistStore {
  return {
    async add({ genomeId, orgId, trendId, source, topic, note }) {
      const row = await scoped.addToTrendWatchlist(
        db,
        { orgId, brandId: orgId, genomeId },
        { trendId, source, topic, ...(note ? { note } : {}) },
      );
      return toEntry(row);
    },

    async remove({ genomeId, orgId, trendId }) {
      await scoped.removeFromTrendWatchlist(db, { orgId, brandId: orgId, genomeId }, trendId);
    },

    async list(genomeId, orgId) {
      const rows = await scoped.listTrendWatchlist(db, { orgId, brandId: orgId, genomeId });
      return rows.map(toEntry);
    },
  };
}

function toEntry(row: scoped.TrendWatchlistRow) {
  return {
    id: row.id,
    trendId: row.trendId,
    source: row.source,
    topic: row.topic,
    createdAt: row.createdAt,
    ...(row.note ? { note: row.note } : {}),
  };
}
