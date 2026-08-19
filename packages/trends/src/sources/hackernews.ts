import type { Trend, TrendSource } from '../trend.js';
import { timedFetch, clamp01 } from './http.js';

/**
 * HACKER NEWS — the Firebase-backed public API
 * (https://github.com/HackerNews/API). No key, no OAuth, no rate-limit
 * account required — the only fully-free-with-zero-setup source in this
 * directory. Strong fit for a SaaS/tech genome, weak fit for almost anything
 * else, which is exactly what `relevanceFor` (packages/trends/src/rank.ts)
 * exists to filter on — this source's job is to surface real candidates, not
 * to pre-guess which brand wants them.
 *
 * Same honesty rule as every other source here: `velocity`/`saturation` are
 * real proxies computed from the story's own real score/age (front-page
 * churn on HN is fast — 24h is a reasonable "fully cycled" proxy); `growth`
 * is `0`, "no signal," because nothing here stores a prior snapshot to diff
 * against.
 */

export interface HackerNewsTrendSourceConfig {
  /** How many top-story ids to sample before mapping to trends — fetching each story's detail is a separate request, so this bounds the fan-out. */
  sampleSize?: number;
  fetchImpl?: typeof fetch;
}

interface HNItem {
  id: number;
  type: string;
  title?: string;
  score?: number;
  time?: number;
  descendants?: number;
  url?: string;
  dead?: boolean;
  deleted?: boolean;
}

export function createHackerNewsTrendSource(config: HackerNewsTrendSourceConfig = {}): TrendSource {
  const fetchImpl = config.fetchImpl ?? fetch;
  const sampleSize = config.sampleSize ?? 40;

  async function fetchItem(id: number): Promise<Trend | null> {
    const res = await timedFetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {}, fetchImpl);
    if (!res.ok) throw new Error(`Hacker News item ${id} fetch failed: ${res.status} ${res.statusText}`);
    const item = (await res.json()) as HNItem | null;
    if (!item || item.type !== 'story' || item.dead || item.deleted || !item.title || item.time === undefined) return null;

    const ageHours = Math.max(0.1, Date.now() / 1000 - item.time) / 3600;
    const velocity = clamp01(Math.log10(1 + (item.score ?? 0) / ageHours) / 3);
    const saturation = clamp01(ageHours / 24);

    return {
      id: String(item.id),
      source: 'hackernews',
      topic: item.title,
      tags: item.url ? [] : ['ask_hn'],
      metrics: {
        volume: (item.score ?? 0) + (item.descendants ?? 0),
        velocity,
        saturation,
        growth: 0,
      },
      samples: [{ url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`, caption: item.title }],
      language: 'en',
    };
  }

  return {
    name: 'hackernews',

    async fetch({ limit }) {
      const idsRes = await timedFetch('https://hacker-news.firebaseio.com/v0/topstories.json', {}, fetchImpl);
      if (!idsRes.ok) throw new Error(`Hacker News topstories fetch failed: ${idsRes.status} ${idsRes.statusText}`);
      const ids = ((await idsRes.json()) as number[]).slice(0, Math.max(sampleSize, limit));

      const items = await Promise.all(
        ids.map((id) =>
          fetchItem(id).catch((error) => {
            console.warn(`[warn] hackernews trend source: item ${id} failed`, { error: error instanceof Error ? error.message : String(error) });
            return null;
          }),
        ),
      );
      return items.filter((t): t is Trend => t !== null).slice(0, limit);
    },

    async get(id) {
      return (await fetchItem(Number(id))) ?? undefined;
    },
  };
}
