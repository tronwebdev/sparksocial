import type { Trend, TrendSource } from '../trend.js';
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

  return {
    name: 'youtube',
    async fetch({ limit, region }) {
      return fetchTrending(limit, region);
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
