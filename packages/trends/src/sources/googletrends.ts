import { applyKeywordFilters, type Trend, type TrendSource } from '../trend.js';
import { timedFetch, clamp01 } from './http.js';

/**
 * GOOGLE TRENDS — the public `trends.google.com/trending/rss?geo=XX` feed.
 *
 * ── Why the RSS feed and not an API ───────────────────────────────────────
 *
 * There is no official Google Trends API. The options are the undocumented
 * `trends.google.com/trends/api/*` JSON endpoints (which answer with a
 * `)]}'` prefix, are rate-limited by IP with no account to raise, and change
 * without notice), a third-party scraper library, or this feed. The feed is
 * the honest choice: it is a stable public document Google publishes for
 * consumption, it needs no credential, and it carries the three things a trend
 * needs — a term, an approximate traffic figure, and a region.
 *
 * Because it needs no credential there is no "configured" signal to key its
 * existence on, so like Hacker News it is **opt-in only**:
 * `TREND_SOURCE_GOOGLE_ENABLED=true`. Availability is not consent to spend a
 * request on every rank.
 *
 * ── What is real here, and what is a documented proxy ─────────────────────
 *
 *   `volume`      `ht:approx_traffic` — Google's own figure ("20,000+" → 20000).
 *                 Real, and the only absolute number in the feed.
 *   `velocity`    From the item's **rank in the feed**. The feed is ordered by
 *                 how hard a term is trending right now, which is real ordinal
 *                 information; converting it to a 0–1 rate is a proxy, and is
 *                 the same class of judgement as Reddit's "48h is fully
 *                 saturated". A single feed read cannot produce a rate any other
 *                 way, and the alternative — inventing one from traffic — would
 *                 mistake a level for a rate.
 *   `saturation`  Also rank-derived, inverted: the #1 term of the day is the
 *                 one everybody has already posted about.
 *   `growth`      `0`. No prior snapshot in a single read. `trend.observe`
 *                 builds the real series.
 *   `media`       `ht:picture`, when the feed attaches a news image.
 *   `regions`     The `geo` this feed was read for. This is the one source that
 *                 makes a real region breakdown possible — see
 *                 `createMultiRegionTrendSource`.
 */

export interface GoogleTrendsSourceConfig {
  /** The default `geo` code (`US`, `GB`, `NG`…). A caller's `region` overrides it. */
  regionCode?: string;
  fetchImpl?: typeof fetch;
}

/** "20,000+" → 20000; "1,000+" → 1000; anything unparseable → 0, never a guess. */
export function parseApproxTraffic(raw: string | undefined): number {
  if (!raw) return 0;
  const digits = raw.replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

interface FeedItem {
  title: string;
  traffic: number;
  picture?: string;
  newsUrl?: string;
  newsTitle?: string;
}

function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return undefined;
  const inner = m[1]!.trim();
  const cdata = inner.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return (cdata ? cdata[1]! : inner).trim() || undefined;
}

/**
 * The feed's `<item>` blocks.
 *
 * Regex rather than a DOM parser for the same reason `packages/recipes/src/rss.ts`
 * does it: there is no XML parser in this dependency tree, and adding one to read
 * five fields out of a document we do not control is a worse trade than a bounded
 * pattern over `<item>` blocks. Entities are decoded for the fields that are
 * rendered (`&amp;` in a picture URL breaks the image, exactly as it does on
 * Reddit).
 */
export function parseTrendingRss(xml: string, limit: number): FeedItem[] {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const items: FeedItem[] = [];

  for (const block of blocks) {
    const title = tag(block, 'title');
    if (!title) continue;
    const picture = tag(block, 'ht:picture');
    items.push({
      title: decode(title),
      traffic: parseApproxTraffic(tag(block, 'ht:approx_traffic')),
      ...(picture ? { picture: decode(picture) } : {}),
      ...(tag(block, 'ht:news_item_url') ? { newsUrl: decode(tag(block, 'ht:news_item_url')!) } : {}),
      ...(tag(block, 'ht:news_item_title') ? { newsTitle: decode(tag(block, 'ht:news_item_title')!) } : {}),
    });
    if (items.length >= limit) break;
  }

  return items;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function createGoogleTrendsSource(config: GoogleTrendsSourceConfig = {}): TrendSource {
  const fetchImpl = config.fetchImpl ?? fetch;
  const defaultRegion = config.regionCode ?? 'US';

  return {
    name: 'google',
    /**
     * `'filter'`. The feed is "what is trending in this country right now" and
     * takes no query, so a keyword narrows what came back — which for a niche
     * keyword over twenty daily terms is usually nothing, and the recipe wizard
     * has to be able to tell an owner that rather than showing them an empty
     * result that reads as "nothing is happening".
     */
    keywordSupport: 'filter',

    async fetch({ limit, region, keywords, excludeKeywords }) {
      const geo = (region ?? defaultRegion).toUpperCase();
      const res = await timedFetch(
        `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`,
        { headers: { accept: 'application/rss+xml, application/xml, text/xml' } },
        fetchImpl,
      );
      if (!res.ok) {
        throw new Error(
          `Google Trends feed fetch failed: ${res.status} ${res.statusText}. This is a public feed with no key — ` +
            `a 429 means the egress IP is rate-limited, and a 404 usually means the geo code is not one Google publishes.`,
        );
      }

      const items = parseTrendingRss(await res.text(), Math.min(50, limit));
      const trends = items.map((item, i) => toTrend(item, i, items.length, geo));

      return applyKeywordFilters(trends, {
        ...(keywords ? { keywords } : {}),
        ...(excludeKeywords ? { excludeKeywords } : {}),
      });
    },
  };
}

function toTrend(item: FeedItem, index: number, total: number, geo: string): Trend {
  /**
   * Rank → rate. Position 0 reads as 1.0 and the last position as ~0.15, on a
   * curve rather than a straight line because the drop from #1 to #2 in a daily
   * trending feed is much larger than from #18 to #19.
   */
  const rankShare = total > 1 ? 1 - index / (total - 1) : 1;
  const velocity = clamp01(0.15 + 0.85 * rankShare ** 1.6);
  /** Inverted: the top term of the day is the one already posted to death. */
  const saturation = clamp01(0.2 + 0.6 * (1 - rankShare));

  return {
    id: `google::${geo}::${item.title.toLowerCase().replace(/\s+/g, '_')}`,
    source: 'google',
    topic: item.title,
    tags: item.newsTitle ? [item.newsTitle] : [],
    metrics: { volume: item.traffic, velocity, saturation, growth: 0 },
    samples: item.newsUrl
      ? [{ url: item.newsUrl, ...(item.newsTitle ? { caption: item.newsTitle } : {}) }]
      : [{ url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(item.title)}&geo=${geo}` }],
    ...(item.picture ? { media: { url: item.picture, kind: 'image' as const } } : {}),
    language: 'en',
    region: geo,
    regions: [{ code: geo, volume: item.traffic }],
  };
}
