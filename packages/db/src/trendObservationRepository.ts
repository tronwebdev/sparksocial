import { and, asc, eq, gte, sql } from 'drizzle-orm';
import type { TrendObservation, TrendObservationStore } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import { trendObservations } from './schema.js';

/**
 * `trend_observations` backed by Postgres — PRD §8.9's *"metrics + time series"*.
 *
 * **Not** scoped through `scoped.ts`, and that is the one thing worth being
 * explicit about in a file that sits next to `trendRepository.ts`, which is.
 * The watchlist records *which trends a brand is interested in* — that is
 * client-confidential and belongs behind the genome predicate. This table
 * records *what a trend's numbers were at 14:00* , which is a fact about
 * TikTok, not about a customer. Nothing here is keyed by org or genome, so
 * there is no isolation predicate available to apply and none needed; the
 * series is deliberately shared, because a per-tenant copy would be sparse
 * enough to be useless.
 */
export function createTrendObservationRepository(db: Database): TrendObservationStore {
  return {
    async record(observations) {
      if (observations.length === 0) return;

      // Deduplicate within the batch before the insert: two callers can hand us
      // the same trend twice inside one hour, and Postgres rejects an ON
      // CONFLICT statement whose own VALUES list conflicts with itself.
      const byBucket = new Map<string, TrendObservation>();
      for (const o of observations) {
        const observedAt = truncateToHour(o.observedAt);
        byBucket.set(JSON.stringify([o.source, o.trendId, observedAt.toISOString()]), { ...o, observedAt });
      }

      await db
        .insert(trendObservations)
        .values(
          [...byBucket.values()].map((o) => ({
            source: o.source,
            trendId: o.trendId,
            topic: o.topic,
            observedAt: o.observedAt,
            volume: Math.round(o.volume),
            velocityBp: toBp(o.velocity),
            saturationBp: toBp(o.saturation),
            growthBp: toBp(o.growth),
          })),
        )
        .onConflictDoUpdate({
          target: [trendObservations.source, trendObservations.trendId, trendObservations.observedAt],
          // Last write wins inside the bucket. The alternative — keep the first
          // — would mean an hour's chart point is set by whoever happened to
          // load the feed at :01 and never updated again.
          set: {
            topic: sql`excluded.topic`,
            volume: sql`excluded.volume`,
            velocityBp: sql`excluded.velocity_bp`,
            saturationBp: sql`excluded.saturation_bp`,
            growthBp: sql`excluded.growth_bp`,
          },
        });
    },

    async series({ source, trendId, sinceDays, limit }) {
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
      const rows = await db
        .select()
        .from(trendObservations)
        .where(
          and(
            eq(trendObservations.source, source),
            eq(trendObservations.trendId, trendId),
            gte(trendObservations.observedAt, since),
          ),
        )
        .orderBy(asc(trendObservations.observedAt))
        .limit(limit ?? 720); // 30 days of hourly points

      return rows.map((r) => ({
        source: r.source,
        trendId: r.trendId,
        topic: r.topic,
        observedAt: r.observedAt,
        volume: r.volume,
        velocity: fromBp(r.velocityBp),
        saturation: fromBp(r.saturationBp),
        growth: fromBp(r.growthBp),
      }));
    },
  };
}

/** 0–1 (or a signed growth rate) as an integer ×1000 — see the schema comment. */
function toBp(v: number): number {
  return Math.round(v * 1000);
}

function fromBp(v: number): number {
  return v / 1000;
}

/**
 * Floors to the hour in UTC. Deliberately not `date_trunc` in SQL: the caller
 * dedupes against the same value before the insert, so both sides have to agree
 * on the bucket, and having one of them computed in the database would make
 * that agreement invisible.
 */
export function truncateToHour(d: Date): Date {
  const out = new Date(d.getTime());
  out.setUTCMinutes(0, 0, 0);
  return out;
}
