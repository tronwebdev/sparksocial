import type { InfluencerWatchStore, TrendWatchlistStore } from '@sparksocial/tools/defineTool';
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

/**
 * `influencer_watchlist` backed by Postgres — §8.9's second watchlist. Same file
 * as the keyword one because they are the same feature to a reader, and separate
 * stores because they key on different things.
 */
export function createInfluencerWatchRepository(db: Database): InfluencerWatchStore {
  return {
    async add({ genomeId, orgId, platform, handle, displayName, note }) {
      const row = await scoped.addInfluencerWatch(
        db,
        { orgId, brandId: orgId, genomeId },
        { platform, handle, ...(displayName ? { displayName } : {}), ...(note ? { note } : {}) },
      );
      return toWatch(row);
    },

    async remove({ genomeId, orgId, platform, handle }) {
      await scoped.removeInfluencerWatch(db, { orgId, brandId: orgId, genomeId }, { platform, handle });
    },

    async list(genomeId, orgId) {
      const rows = await scoped.listInfluencerWatchlist(db, { orgId, brandId: orgId, genomeId });
      return rows.map(toWatch);
    },
  };
}

function toWatch(row: scoped.InfluencerWatchRow) {
  return {
    id: row.id,
    platform: row.platform,
    handle: row.handle,
    createdAt: row.createdAt,
    ...(row.displayName ? { displayName: row.displayName } : {}),
    ...(row.note ? { note: row.note } : {}),
  };
}
