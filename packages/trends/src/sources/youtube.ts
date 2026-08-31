import { applyKeywordFilters, type Trend, type TrendSource } from '../trend.js';
import { timedFetch, clamp01 } from './http.js';

/**
 * YOUTUBE — Data API v3's `videos?chart=mostPopular`. Genuinely free up to
 * Google Cloud's daily quota (10,000 units/day by default; this call costs 1
 * unit per request), billed only past it — the "starts free, paid at scale"
 * shape, distinct from Reddit's flat free tier.
 *
 * Same honesty rule as the Reddit source for `velocity`/`saturation`
 * (real proxies from one snapshot's real numbers) and `growth` (0, "no
 * signal" — needs a stored prior observation this pass doesn't build).
 */

export interface YouTubeTrendSourceConfig {
  apiKey: string;
  /** ISO 3166-1 alpha-2 — the trending chart is region-scoped. Defaults to 'US'. */
  regionCode?: string;
  /** A YouTube video category id (e.g. '28' = Science & Technology). Omitted = the region's general trending chart. */
  categoryId?: string;
  fetchImpl?: typeof fetch;
}

interface YouTubeVideoItem {
  id: string;
  snippet: {
    title: string;
    tags?: string[];
    categoryId?: string;
    publishedAt: string;
    defaultLanguage?: string;
  };
  statistics: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
}

interface YouTubeVideosResponse {
  items: YouTubeVideoItem[];
}

export function createYouTubeTrendSource(config: YouTubeTrendSourceConfig): TrendSource {
  const fetchImpl = config.fetchImpl ?? fetch;

  async function fetchTrending(limit: number, region?: string): Promise<Trend[]> {
    const params = new URLSearchParams({
      part: 'snippet,statistics',
      chart: 'mostPopular',
      // The API caps this endpoint at 50 regardless of what's requested —
      // clamping here is honest about the real ceiling, not a bug.
      maxResults: String(Math.min(50, Math.max(1, limit))),
      regionCode: region ?? config.regionCode ?? 'US',
      key: config.apiKey,
      ...(config.categoryId ? { videoCategoryId: config.categoryId } : {}),
    });
    const res = await timedFetch(`https://www.googleapis.com/youtube/v3/videos?${params.toString()}`, {}, fetchImpl);
    if (!res.ok) throw new Error(`YouTube trending fetch failed: ${res.status} ${res.statusText}`);
    const body = (await res.json()) as YouTubeVideosResponse;
    return body.items.map(toTrend);
  }

  /**
   * `search.list` — YouTube's own keyword search, over its whole corpus rather
   * than over the trending list.
   *
   * A second request, because `search.list` returns no statistics: it answers
   * with ids and snippets only, and every metric this adapter derives
   * (`velocity`, `saturation`, `volume`) comes from `viewCount`. So the ids come
   * from search and the bodies come from `videos.list` — the same endpoint
   * `fetchTrending` already uses, which is why the mapping is shared rather than
   * duplicated with a `views: 0` variant that would rank every searched trend at
   * the floor.
   *
   * Quota note: `search.list` costs 100 units against a default 10,000/day, so a
   * keyword recipe running hourly is ~2,400/day. Worth knowing before a second
   * keyword recipe is added, not worth a cache that would serve stale trends.
   */
  async function searchByKeyword(keywords: readonly string[], limit: number, region?: string): Promise<Trend[]> {
    const params = new URLSearchParams({
      part: 'id',
      type: 'video',
      order: 'viewCount',
      // OR, matching `matchesKeywords`. YouTube reads a bare space as AND-ish
      // relevance, and `|` as an explicit OR — a recipe watching three topics
      // wants any of them, not all three in one video's title.
      q: keywords.map((k) => k.trim()).filter(Boolean).join(' | '),
      maxResults: String(Math.min(50, Math.max(1, limit))),
      key: config.apiKey,
      ...(region ? { regionCode: region } : {}),
    });
    const res = await timedFetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`, {}, fetchImpl);
    if (!res.ok) throw new Error(`YouTube search failed: ${res.status} ${res.statusText}`);
    const body = (await res.json()) as { items?: Array<{ id?: { videoId?: string } }> };
    const ids = (body.items ?? []).map((i) => i.id?.videoId).filter((v): v is string => Boolean(v));
    if (ids.length === 0) return [];

    const detail = new URLSearchParams({ part: 'snippet,statistics', id: ids.join(','), key: config.apiKey });
    const detailRes = await timedFetch(`https://www.googleapis.com/youtube/v3/videos?${detail.toString()}`, {}, fetchImpl);
    if (!detailRes.ok) throw new Error(`YouTube video detail fetch failed: ${detailRes.status} ${detailRes.statusText}`);
    const detailBody = (await detailRes.json()) as YouTubeVideosResponse;
    return detailBody.items.map(toTrend);
  }

  return {
    name: 'youtube',
    keywordSupport: 'server',
    async fetch({ limit, region, keywords, excludeKeywords }) {
      const searched = Boolean(keywords?.length);
      const trends = searched
        ? await searchByKeyword(keywords!, limit, region)
        : await fetchTrending(limit, region);
      // The exclude list runs either way: `search.list` takes a query and takes
      // no negation, so this is the half the vendor did not do.
      return applyKeywordFilters(trends, {
        ...(keywords ? { keywords } : {}),
        ...(excludeKeywords ? { excludeKeywords } : {}),
        alreadySearched: searched,
      });
    },
  };
}


function toTrend(item: YouTubeVideoItem): Trend {
  const publishedAt = new Date(item.snippet.publishedAt).getTime();
  const ageHours = Math.max(0.1, (Date.now() - publishedAt) / 3_600_000);
  const views = Number(item.statistics.viewCount ?? 0);

  const velocity = clamp01(Math.log10(1 + views / ageHours) / 6);
  // A week old reads as fully saturated — a judgement call about how long a
  // video stays "current" on this platform specifically, same caveat as
  // Reddit's 48h: real proxy, not a measurement.
  const saturation = clamp01(ageHours / (24 * 7));

  return {
    id: item.id,
    source: 'youtube',
    topic: item.snippet.title,
    tags: item.snippet.tags?.slice(0, 5) ?? (item.snippet.categoryId ? [`category_${item.snippet.categoryId}`] : []),
    metrics: { volume: views, velocity, saturation, growth: 0 },
    samples: [{ url: `https://youtube.com/watch?v=${item.id}`, caption: item.snippet.title }],
    language: item.snippet.defaultLanguage ?? 'en',
  };
}
