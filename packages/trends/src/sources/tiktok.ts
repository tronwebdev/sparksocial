import { applyKeywordFilters, type Trend, type TrendSource } from '../trend.js';
import { timedFetch, clamp01 } from './http.js';

/**
 * TIKTOK — Creative Center's popular-hashtag list
 * (`ads.tiktok.com/creative_radar_api/v1/popular_trend/hashtag/list`).
 *
 * ── Which TikTok API this is, and why ────────────────────────────────────
 *
 * TikTok has three surfaces and only one of them answers "what is trending":
 *
 *   *Display API* — a user's **own** videos. Useless for discovery.
 *   *Research API* — real query power, gated behind an academic/research
 *     application that takes weeks and is refused to commercial applicants.
 *   *Creative Center* — the hashtag/song/creator leaderboards TikTok publishes
 *     for advertisers, which is what this reads.
 *
 * Creative Center is **the least verified endpoint in this directory**, in the
 * same class as Pinterest's Trends API and flagged the same way: it is a
 * documented product with an undocumented HTTP surface. It wants a session
 * token rather than an OAuth app, the response shape has changed before, and
 * the field names below are what it returned at the time of writing. It is
 * unregistered until `TIKTOK_CREATIVE_TOKEN` is set, and the error message
 * below says what a 401 there actually means, because "unauthorised" from this
 * endpoint usually means an expired session rather than a wrong secret.
 *
 * PRD §8's "TikTok Creative Center needs the audit cleared" is about *this*:
 * the plan's own note that every real source sits behind an approval.
 *
 * ── What is real ─────────────────────────────────────────────────────────
 *
 *   `volume`      `publish_cnt` — how many videos carry the hashtag. Real.
 *   `growth`      Creative Center is the **only** source in this directory
 *                 besides Pinterest that reports a genuine period-over-period
 *                 figure: the `trend` array is a series of `(time, value)`
 *                 points, and the change across it is a measured rate, not a
 *                 proxy. That makes `metrics.growth` real here, and the card's
 *                 accel arrow meaningful rather than "n/a".
 *   `velocity`    Derived from that same series where it exists, and from rank
 *                 where it does not — documented, like every other rank proxy
 *                 in this directory.
 *   `saturation`  `publish_cnt` relative to the largest in the batch: a hashtag
 *                 on four million videos is done; one on nine thousand is not.
 *   `media`       None. The hashtag list carries no thumbnail, and fetching a
 *                 sample video per hashtag would be one extra request each.
 */

export interface TikTokTrendSourceConfig {
  /** Creative Center session token. Without it this source is never constructed. */
  accessToken: string;
  /** Creative Center's own country code (`US`, `GB`, `NG`…). */
  regionCode?: string;
  /** `7` (a week) or `30`. The window the leaderboard is computed over. */
  periodDays?: 7 | 30;
  fetchImpl?: typeof fetch;
}

interface TikTokTrendPoint {
  time?: number;
  value?: number;
}

interface TikTokHashtag {
  hashtag_id?: string;
  hashtag_name?: string;
  publish_cnt?: number;
  video_views?: number;
  rank?: number;
  /** The measured series — see the note above. */
  trend?: TikTokTrendPoint[];
  industry_info?: { value?: string };
}

interface TikTokHashtagResponse {
  code?: number;
  msg?: string;
  data?: { list?: TikTokHashtag[] };
}

/**
 * Change across the reported series, as a fraction of its first point.
 *
 * Exported for the test: this is the one place in the package where `growth` is
 * a measurement rather than a zero, so it is worth asserting directly. Returns
 * `null` — not 0 — when the series cannot support a comparison, because 0 means
 * "flat" and null means "not measured", and the card renders those differently.
 */
export function seriesGrowth(points: TikTokTrendPoint[] | undefined): number | null {
  const values = (points ?? []).map((p) => p.value).filter((v): v is number => typeof v === 'number' && v > 0);
  if (values.length < 2) return null;
  const first = values[0]!;
  const last = values[values.length - 1]!;
  return (last - first) / first;
}

export function createTikTokTrendSource(config: TikTokTrendSourceConfig): TrendSource {
  const fetchImpl = config.fetchImpl ?? fetch;
  const region = config.regionCode ?? 'US';
  const period = config.periodDays ?? 7;

  return {
    name: 'tiktok',
    /**
     * `'filter'`. The leaderboard takes a country and a period, not a query.
     */
    keywordSupport: 'filter',

    async fetch({ limit, region: requestedRegion, keywords, excludeKeywords }) {
      const country = (requestedRegion ?? region).toUpperCase();
      const params = new URLSearchParams({
        page: '1',
        limit: String(Math.min(50, Math.max(1, limit))),
        period: String(period),
        country_code: country,
        sort_by: 'popular',
      });

      const res = await timedFetch(
        `https://ads.tiktok.com/creative_radar_api/v1/popular_trend/hashtag/list?${params.toString()}`,
        {
          headers: {
            accept: 'application/json',
            /* Creative Center authenticates on this header, not `Authorization`. */
            'anonymous-user-id': config.accessToken,
            'user-sign': config.accessToken,
          },
        },
        fetchImpl,
      );

      if (!res.ok) {
        throw new Error(
          `TikTok Creative Center fetch failed: ${res.status} ${res.statusText}. A 401/403 from this endpoint almost ` +
            `always means the session token has expired rather than that it is wrong — Creative Center issues browser ` +
            `sessions, not long-lived API keys, which is the standing caveat on this source.`,
        );
      }

      const body = (await res.json()) as TikTokHashtagResponse;
      if (body.code !== undefined && body.code !== 0) {
        throw new Error(`TikTok Creative Center error ${body.code}: ${body.msg ?? 'no message'}`);
      }

      const list = (body.data?.list ?? []).filter((h): h is TikTokHashtag & { hashtag_name: string } =>
        Boolean(h.hashtag_name),
      );
      const maxPublish = list.reduce((m, h) => Math.max(m, h.publish_cnt ?? 0), 0);

      const trends = list.map((h, i) => toTrend(h, i, list.length, maxPublish, country));

      return applyKeywordFilters(trends, {
        ...(keywords ? { keywords } : {}),
        ...(excludeKeywords ? { excludeKeywords } : {}),
      });
    },
  };
}

function toTrend(
  h: TikTokHashtag & { hashtag_name: string },
  index: number,
  total: number,
  maxPublish: number,
  country: string,
): Trend {
  const publish = h.publish_cnt ?? 0;
  const growth = seriesGrowth(h.trend);
  const rankShare = total > 1 ? 1 - index / (total - 1) : 1;

  /**
   * A measured series beats a rank proxy: where `trend` exists, velocity is the
   * measured change mapped onto 0–1 (a doubling reads as 1.0); where it does
   * not, it falls back to the same rank curve the other rank-only sources use.
   */
  const velocity = growth === null ? clamp01(0.15 + 0.85 * rankShare ** 1.6) : clamp01(0.5 + growth / 2);
  const saturation = maxPublish > 0 ? clamp01(0.15 + 0.7 * (publish / maxPublish)) : 0.5;

  const name = h.hashtag_name.startsWith('#') ? h.hashtag_name : `#${h.hashtag_name}`;

  return {
    id: `tiktok::${h.hashtag_id ?? h.hashtag_name}`,
    source: 'tiktok',
    topic: name,
    tags: [h.hashtag_name.replace(/^#/, ''), ...(h.industry_info?.value ? [h.industry_info.value] : [])],
    metrics: {
      volume: publish,
      velocity,
      saturation,
      /* 0 only when the series was absent — "no signal", the same convention
         every other source uses. */
      growth: growth ?? 0,
    },
    samples: [
      {
        url: `https://www.tiktok.com/tag/${encodeURIComponent(h.hashtag_name.replace(/^#/, ''))}`,
        caption: h.video_views ? `${h.video_views.toLocaleString('en')} views` : name,
      },
    ],
    language: 'en',
    region: country,
    regions: [{ code: country, volume: publish }],
  };
}
