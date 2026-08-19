import type { Trend, TrendSource } from '../trend.js';
import { timedFetch, clamp01 } from './http.js';

/**
 * PINTEREST TRENDS — the least certain source in this directory, and that
 * uncertainty is written down rather than papered over.
 *
 * Pinterest's trending-keyword data (the same data trends.pinterest.com
 * shows) is exposed through their Ads/Business API v5's `/v5/trends/*`
 * endpoints, which — unlike Reddit's or Product Hunt's fully self-serve
 * developer signup — sit behind Pinterest's Business API access, and growing
 * a keyword's trend history has historically required Marketing Developer
 * Partner approval, not just an app registration. This file is written to
 * the documented `/v5/trends/keywords/{region}/top/growing` shape as best
 * understood, but has never been exercised against a live account, and the
 * exact response shape is the one thing in this whole trend-source layer
 * that has not been independently confirmed.
 *
 * Deliberately takes a pre-obtained access token rather than implementing a
 * token-exchange flow: Pinterest's OAuth handshake is a full user-consent
 * authorization-code flow (not a simple client-credentials grant like Reddit
 * or Product Hunt), and guessing at that exchange's exact shape carries more
 * risk than asking the operator to mint a token through Pinterest's own
 * developer console and hand it over directly — real data flowing through a
 * real, simple call, rather than a fabricated middle step.
 */

export interface PinterestTrendSourceConfig {
  /** A token minted through Pinterest's own developer console / OAuth flow — see the setup steps that accompany this source. */
  accessToken: string;
  /** ISO 3166-1 alpha-2, e.g. 'US'. Pinterest's trends endpoint is region-scoped. */
  regionCode?: string;
  fetchImpl?: typeof fetch;
}

interface PinterestTrendItem {
  keyword: string;
  pct_growth_wow?: number;
  time_series?: Array<{ date: string; value: number }>;
}

interface PinterestTrendsResponse {
  trends: PinterestTrendItem[];
}

export function createPinterestTrendSource(config: PinterestTrendSourceConfig): TrendSource {
  const fetchImpl = config.fetchImpl ?? fetch;
  const region = config.regionCode ?? 'US';

  return {
    name: 'pinterest',

    async fetch({ limit, region: requestedRegion }) {
      const res = await timedFetch(
        `https://api.pinterest.com/v5/trends/keywords/${requestedRegion ?? region}/top/growing?limit=${Math.min(50, limit)}`,
        { headers: { Authorization: `Bearer ${config.accessToken}` } },
        fetchImpl,
      );
      if (!res.ok) {
        throw new Error(
          `Pinterest trends fetch failed: ${res.status} ${res.statusText}. This endpoint is the least verified in the codebase — if this is a 403/404, it likely means the access token's app does not have Trends API access approved.`,
        );
      }
      const body = (await res.json()) as PinterestTrendsResponse;
      return (body.trends ?? []).map(toTrend);
    },
  };
}

function toTrend(item: PinterestTrendItem): Trend {
  // Pinterest's own growth percentage is a real, reported number — unlike
  // every other source here, this is the one place `growth` is NOT forced to
  // 0, because the vendor itself supplies a genuine period-over-period
  // figure rather than this codebase having to derive one from a single
  // snapshot.
  const growthPct = item.pct_growth_wow ?? 0;
  const velocity = clamp01(0.5 + growthPct / 200); // a real reported growth rate maps directly to velocity, centred at "flat"
  const saturation = clamp01(0.5 - growthPct / 200);

  return {
    id: item.keyword,
    source: 'pinterest',
    topic: item.keyword,
    tags: [],
    metrics: {
      volume: 0, // Pinterest's growing-keywords endpoint reports relative growth, not absolute search volume — 0 is honest, not a guess.
      velocity,
      saturation,
      growth: growthPct / 100,
    },
    samples: [],
    language: 'en',
  };
}
