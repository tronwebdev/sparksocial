import { applyKeywordFilters, type Trend, type TrendSource } from '../trend.js';
import { timedFetch, clamp01 } from './http.js';

/**
 * BLUESKY — `app.bsky.unspecced.getTrends` on the public AppView.
 *
 * ── Why this source ──────────────────────────────────────────────────────
 *
 * The PRD's social trend feeds are X (paid), TikTok Creative Center (session
 * tokens that expire), Instagram (no compliant endpoint) and Sora (no API). Of
 * the networks this product *publishes* to, Bluesky is the one that publishes
 * its trends openly: no key, no account, and each trend carries a post count
 * and the time it started — which is enough for a real rate, not a proxy.
 *
 * Keyless, so like Google Trends and Hacker News it is opt-in:
 * `TREND_SOURCE_BLUESKY_ENABLED=true`.
 *
 * ── Metrics ──────────────────────────────────────────────────────────────
 *
 *   `volume`      `postCount` — Bluesky's own count of posts in the trend.
 *   `velocity`    Posts per hour since `startedAt`, on a log curve: 1/h is
 *                 nothing, ~30/h is busy, 1,000/h is everyone. A real rate.
 *                 `status: "hot"` is Bluesky saying the same thing louder.
 *   `saturation`  Age. A trend that started 36 hours ago has been posted about
 *                 by everyone who was going to; one that started an hour ago
 *                 has not.
 *   `growth`      `0` — one read has no prior. `trend.observe` builds it.
 *   `region`      None. The trends are network-wide, not per country.
 */

export interface BlueskyTrendSourceConfig {
  /** The public AppView. Overridable for a self-hosted one. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface BskyTrend {
  topic?: string;
  displayName?: string;
  description?: string;
  link?: string;
  startedAt?: string;
  postCount?: number;
  status?: string;
  category?: string;
}

export function createBlueskyTrendSource(config: BlueskyTrendSourceConfig = {}): TrendSource {
  const fetchImpl = config.fetchImpl ?? fetch;
  const base = (config.baseUrl ?? 'https://public.api.bsky.app').replace(/\/$/, '');
  const now = config.now ?? (() => new Date());

  return {
    name: 'bluesky',
    /** The endpoint takes no query: a keyword narrows what came back. */
    keywordSupport: 'filter',

    async fetch({ limit, keywords, excludeKeywords }) {
      const res = await timedFetch(
        `${base}/xrpc/app.bsky.unspecced.getTrends?limit=${Math.min(25, Math.max(1, limit))}`,
        { headers: { accept: 'application/json' } },
        fetchImpl,
      );
      if (!res.ok) throw new Error(`Bluesky trends fetch failed: ${res.status} ${res.statusText}.`);
      const body = (await res.json()) as { trends?: BskyTrend[] };
      const at = now().getTime();
      const trends = (body.trends ?? []).flatMap((t) => {
        const mapped = toTrend(t, at);
        return mapped ? [mapped] : [];
      });
      return applyKeywordFilters(trends, {
        ...(keywords ? { keywords } : {}),
        ...(excludeKeywords ? { excludeKeywords } : {}),
      });
    },
  };
}

function toTrend(t: BskyTrend, nowMs: number): Trend | undefined {
  const topic = (t.displayName ?? '').trim();
  if (!topic) return undefined;
  const posts = typeof t.postCount === 'number' && t.postCount > 0 ? t.postCount : 0;
  const started = t.startedAt ? Date.parse(t.startedAt) : NaN;
  const hours = Number.isFinite(started) ? Math.max(0.5, (nowMs - started) / 3_600_000) : 24;
  const perHour = posts / hours;

  const velocity = clamp01(Math.log10(perHour + 1) / 3 + (t.status === 'hot' ? 0.1 : 0));
  const saturation = clamp01(hours / 48);

  return {
    id: `bluesky::${t.topic ?? topic.toLowerCase().replace(/\s+/g, '_')}`,
    source: 'bluesky',
    topic,
    tags: [t.category, t.description].filter((x): x is string => Boolean(x)),
    metrics: { volume: posts, velocity, saturation, growth: 0 },
    samples: t.link ? [{ url: `https://bsky.app${t.link}`, ...(t.description ? { caption: t.description } : {}) }] : [],
    language: 'en',
    regions: [],
  };
}
