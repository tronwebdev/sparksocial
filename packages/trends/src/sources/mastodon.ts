import { applyKeywordFilters, type Trend, type TrendSource } from '../trend.js';
import { timedFetch, clamp01 } from './http.js';

/**
 * MASTODON — `GET /api/v1/trends/tags` on a public instance.
 *
 * Trending hashtags with **seven days of daily usage** attached, which makes
 * this the one keyless source whose growth is measured rather than inferred:
 * today against the week before it, in one read. No key; opt-in like the
 * other keyless sources (`TREND_SOURCE_MASTODON_ENABLED=true`). The instance
 * defaults to mastodon.social, the largest; `MASTODON_TREND_INSTANCE` points
 * it at another.
 *
 * ── Metrics ──────────────────────────────────────────────────────────────
 *
 *   `volume`      Uses across the seven days.
 *   `velocity`    Today's share of the week: a tag used 500 times today and
 *                 never before reads near 1, one used 100 times every day
 *                 reads near 0.15. That is what "before saturation" means.
 *   `saturation`  The rest of the week's share — how long it has been going.
 *   `growth`      Today against the previous days' average, minus one.
 */

export interface MastodonTrendSourceConfig {
  instance?: string;
  fetchImpl?: typeof fetch;
}

interface TagHistory {
  day?: string;
  uses?: string;
  accounts?: string;
}

interface MastodonTag {
  name?: string;
  url?: string;
  history?: TagHistory[];
}

export function createMastodonTrendSource(config: MastodonTrendSourceConfig = {}): TrendSource {
  const fetchImpl = config.fetchImpl ?? fetch;
  const instance = (config.instance ?? 'mastodon.social').replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  return {
    name: 'mastodon',
    keywordSupport: 'filter',

    async fetch({ limit, keywords, excludeKeywords }) {
      const res = await timedFetch(
        `https://${instance}/api/v1/trends/tags?limit=${Math.min(20, Math.max(1, limit))}`,
        { headers: { accept: 'application/json' } },
        fetchImpl,
      );
      if (!res.ok) throw new Error(`Mastodon trends fetch failed (${instance}): ${res.status} ${res.statusText}.`);
      const tags = (await res.json()) as MastodonTag[];
      const trends = (Array.isArray(tags) ? tags : []).flatMap((t) => {
        const mapped = toTrend(t, instance);
        return mapped ? [mapped] : [];
      });
      return applyKeywordFilters(trends, {
        ...(keywords ? { keywords } : {}),
        ...(excludeKeywords ? { excludeKeywords } : {}),
      });
    },
  };
}

const n = (v: string | undefined) => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
};

export function toTrend(t: MastodonTag, instance: string): Trend | undefined {
  const name = (t.name ?? '').trim();
  if (!name) return undefined;
  /* Newest day first, as the API sends it. */
  const uses = (t.history ?? []).map((h) => n(h.uses));
  const today = uses[0] ?? 0;
  const before = uses.slice(1);
  const total = uses.reduce((s, u) => s + u, 0);
  const prevAvg = before.length ? before.reduce((s, u) => s + u, 0) / before.length : 0;

  const velocity = clamp01(total > 0 ? today / total : 0);
  const saturation = clamp01(total > 0 ? 1 - today / total : 0);
  const growth = prevAvg > 0 ? Math.min(50, today / prevAvg - 1) : today > 0 ? Math.min(50, today) : 0;

  return {
    id: `mastodon::${instance}::${name.toLowerCase()}`,
    source: 'mastodon',
    topic: `#${name}`,
    tags: [name],
    metrics: { volume: total, velocity, saturation, growth },
    samples: [{ url: t.url ?? `https://${instance}/tags/${encodeURIComponent(name)}` }],
    language: 'en',
    regions: [],
  };
}
