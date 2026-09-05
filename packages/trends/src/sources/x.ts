import { applyKeywordFilters, type Trend, type TrendSource } from '../trend.js';
import { timedFetch, clamp01 } from './http.js';

/**
 * X (TWITTER) — `GET /2/trends/by/woeid/:woeid`, X API v2.
 *
 * ── The endpoint, and what it costs ──────────────────────────────────────
 *
 * v2's trends endpoint takes a WOEID (Yahoo "Where On Earth" id — 1 is
 * worldwide, 23424977 the United States, 23424975 the United Kingdom,
 * 23424908 Nigeria) and answers with `[{ trend_name, tweet_count }]`. It needs
 * an **App-Only Bearer token** and is not in the free tier: Basic is $200/mo at
 * time of writing, which is the reason this source ships unregistered until
 * `X_BEARER_TOKEN` is set, and the reason the plan (§8) lists X among the
 * "per-call cost" sources rather than the free ones.
 *
 * The endpoint returns two fields, so the honesty question is sharper here than
 * anywhere else in this directory: with a name and a count and no timestamp,
 * three of the four `TrendMetrics` cannot be measured. What this adapter does
 * with that:
 *
 *   `volume`      `tweet_count`. Real.
 *   `velocity`    From the trend's **position in the response**, which X orders
 *                 by how hard each term is trending. That ordering is real
 *                 information the API gives us; mapping it onto 0–1 is a
 *                 documented proxy, the same class as Reddit's "48 hours is
 *                 fully cycled". It is *not* derived from `tweet_count`, because
 *                 a count is a level and velocity is a rate, and quietly
 *                 converting one into the other is how a dashboard starts lying.
 *   `saturation`  From `tweet_count` relative to the largest count in the same
 *                 response: a term with 2M posts in a 50-term list has been
 *                 done, one with 5k has not. Also a proxy, also documented.
 *   `growth`      `0` — "no signal". A single read has nothing to diff against;
 *                 `trend.observe` and `trend_observations` build the real
 *                 series that `DISC-02` charts.
 *   `media`       None. The trends endpoint returns no media, and fetching a
 *                 sample post per trend to get one would be 50 extra billed
 *                 requests per rank.
 */

export interface XTrendSourceConfig {
  /** App-Only Bearer token. Without it this source is never constructed. */
  bearerToken: string;
  /** Default WOEID. 1 is worldwide. */
  woeid?: number;
  fetchImpl?: typeof fetch;
}

interface XTrendItem {
  trend_name?: string;
  tweet_count?: number;
}

interface XTrendsResponse {
  data?: XTrendItem[];
  errors?: Array<{ message?: string; detail?: string }>;
}

/**
 * Region code → WOEID.
 *
 * X takes a WOEID and every other source in this directory takes an ISO
 * country code, so the translation lives here rather than leaking Yahoo's
 * numbering into `TrendFetchArgs`. Unknown codes fall back to worldwide, which
 * is a real answer rather than an error — the caller asked for a region we
 * cannot name, and worldwide is the honest superset.
 */
export const WOEID_BY_REGION: Record<string, number> = {
  WORLD: 1,
  US: 23424977,
  GB: 23424975,
  NG: 23424908,
  ZA: 23424942,
  KE: 23424863,
  GH: 23424824,
  CA: 23424775,
  AU: 23424748,
  IN: 23424848,
  DE: 23424829,
  FR: 23424819,
  ES: 23424950,
  BR: 23424768,
  MX: 23424900,
  JP: 23424856,
  AE: 23424738,
};

export function woeidFor(region: string | undefined, fallback: number): number {
  if (!region) return fallback;
  return WOEID_BY_REGION[region.toUpperCase()] ?? fallback;
}

export function createXTrendSource(config: XTrendSourceConfig): TrendSource {
  const fetchImpl = config.fetchImpl ?? fetch;
  const defaultWoeid = config.woeid ?? 1;

  return {
    name: 'x',
    /**
     * `'filter'`. `/2/trends/by/woeid` takes no query. X *does* have a search
     * endpoint that would support `'server'`, but searching posts and reading
     * trends are different products — a keyword recipe pointed at search would
     * return individual posts scored as if they were trends, and the count it
     * needs (`/2/tweets/counts/recent`) is a separate billed call per keyword.
     */
    keywordSupport: 'filter',

    async fetch({ limit, region, keywords, excludeKeywords }) {
      const woeid = woeidFor(region, defaultWoeid);
      const res = await timedFetch(
        `https://api.x.com/2/trends/by/woeid/${woeid}?max_trends=${Math.min(50, Math.max(1, limit))}`,
        { headers: { authorization: `Bearer ${config.bearerToken}`, accept: 'application/json' } },
        fetchImpl,
      );

      if (!res.ok) {
        throw new Error(
          `X trends fetch failed: ${res.status} ${res.statusText}. A 401 means the bearer token is wrong; ` +
            `a 403 usually means the project's access tier does not include the trends endpoint (it is not in Free); ` +
            `a 429 is the tier's rate limit.`,
        );
      }

      const body = (await res.json()) as XTrendsResponse;
      if (body.errors?.length) {
        throw new Error(`X trends error: ${body.errors.map((e) => e.detail ?? e.message ?? 'unknown').join('; ')}`);
      }

      const items = (body.data ?? []).filter((t): t is XTrendItem & { trend_name: string } => Boolean(t.trend_name));
      const maxCount = items.reduce((m, t) => Math.max(m, t.tweet_count ?? 0), 0);
      const region_ = Object.entries(WOEID_BY_REGION).find(([, id]) => id === woeid)?.[0];

      const trends = items.map((item, i) => toTrend(item, i, items.length, maxCount, region_));

      return applyKeywordFilters(trends, {
        ...(keywords ? { keywords } : {}),
        ...(excludeKeywords ? { excludeKeywords } : {}),
      });
    },
  };
}

function toTrend(
  item: XTrendItem & { trend_name: string },
  index: number,
  total: number,
  maxCount: number,
  region: string | undefined,
): Trend {
  const count = item.tweet_count ?? 0;
  const rankShare = total > 1 ? 1 - index / (total - 1) : 1;
  const velocity = clamp01(0.15 + 0.85 * rankShare ** 1.6);
  const saturation = maxCount > 0 ? clamp01(0.15 + 0.7 * (count / maxCount)) : 0.5;

  return {
    id: `x::${item.trend_name}`,
    source: 'x',
    topic: item.trend_name,
    /** A `#hashtag` is its own descriptor, and `relevanceFor` matches on tags. */
    tags: item.trend_name.startsWith('#') ? [item.trend_name.slice(1)] : [],
    metrics: { volume: count, velocity, saturation, growth: 0 },
    samples: [
      {
        url: `https://x.com/search?q=${encodeURIComponent(item.trend_name)}&src=trend_click`,
        caption: `${count.toLocaleString('en')} posts`,
      },
    ],
    language: 'en',
    /* WOEID 1 is "worldwide", which is not a region — recording it as one would
       put a fake country at the top of the Geo panel. */
    ...(region && region !== 'WORLD' ? { region } : {}),
    regions: region && region !== 'WORLD' ? [{ code: region, volume: count }] : [],
  };
}
