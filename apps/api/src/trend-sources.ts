import {
  createCompositeTrendSource,
  createRedditTrendSource,
  createYouTubeTrendSource,
  createHackerNewsTrendSource,
  createProductHuntTrendSource,
  createPinterestTrendSource,
  createStubTrendSource,
  type TrendSource,
  type TrendSourceEntry,
} from '@sparksocial/trends';
import { envSet, envStr, envBool, envList, envNum } from './env.js';

/**
 * Assembles the trend source `trend.*` actually runs against — every
 * `TREND_SOURCE_*` vendor that has credentials configured, each with its own
 * independent `_ENABLED` switch (`envBool`, default true once configured),
 * merged through `createCompositeTrendSource` so one failing or disabled
 * source never takes the others down with it (see that file's own comment).
 *
 * Falls back to the deterministic stub — alone, never blended with real data
 * — only when nothing real is configured, the same "unset vendor key → stub,
 * not fabricated" rule every other seam in this app follows.
 */
export function buildTrendSource(): TrendSource {
  const entries: TrendSourceEntry[] = [];

  if (envSet('REDDIT_CLIENT_ID') && envSet('REDDIT_CLIENT_SECRET')) {
    entries.push({
      source: createRedditTrendSource({
        clientId: envStr('REDDIT_CLIENT_ID', ''),
        clientSecret: envStr('REDDIT_CLIENT_SECRET', ''),
        userAgent: envStr('REDDIT_USER_AGENT', 'sparksocial-trend-discovery/1.0'),
        subreddits: envList('REDDIT_TREND_SUBREDDITS', ['popular']),
      }),
      enabled: envBool('TREND_SOURCE_REDDIT_ENABLED', true),
    });
  }

  if (envSet('YOUTUBE_API_KEY')) {
    entries.push({
      source: createYouTubeTrendSource({
        apiKey: envStr('YOUTUBE_API_KEY', ''),
        regionCode: envStr('YOUTUBE_TREND_REGION', 'US'),
      }),
      enabled: envBool('TREND_SOURCE_YOUTUBE_ENABLED', true),
    });
  }

  // Hacker News needs no credential at all — its switch defaults to *off*
  // rather than on, unlike every other source, because there is no
  // "configured" signal to key the entry's existence on. Explicit opt-in via
  // TREND_SOURCE_HACKERNEWS_ENABLED=true is what adds it, not its mere
  // availability.
  if (envBool('TREND_SOURCE_HACKERNEWS_ENABLED', false)) {
    entries.push({
      source: createHackerNewsTrendSource({ sampleSize: envNum('HACKERNEWS_SAMPLE_SIZE', 40) }),
      enabled: true,
    });
  }

  if (envSet('PRODUCTHUNT_CLIENT_ID') && envSet('PRODUCTHUNT_CLIENT_SECRET')) {
    entries.push({
      source: createProductHuntTrendSource({
        clientId: envStr('PRODUCTHUNT_CLIENT_ID', ''),
        clientSecret: envStr('PRODUCTHUNT_CLIENT_SECRET', ''),
      }),
      enabled: envBool('TREND_SOURCE_PRODUCTHUNT_ENABLED', true),
    });
  }

  // The least certain source in the set (see pinterest.ts's own comment) —
  // still opt-in only via a real access token, never assembled from a guess.
  if (envSet('PINTEREST_ACCESS_TOKEN')) {
    entries.push({
      source: createPinterestTrendSource({
        accessToken: envStr('PINTEREST_ACCESS_TOKEN', ''),
        regionCode: envStr('PINTEREST_TREND_REGION', 'US'),
      }),
      enabled: envBool('TREND_SOURCE_PINTEREST_ENABLED', true),
    });
  }

  // No real source configured at all → the stub, alone. Mixing it in
  // alongside real sources would mean a "real" feed silently contains
  // fabricated entries — worse than an honestly empty one.
  if (entries.length === 0) {
    console.warn(
      '[warn] No trend source configured (REDDIT_CLIENT_ID/SECRET, YOUTUBE_API_KEY, TREND_SOURCE_HACKERNEWS_ENABLED, ' +
        'PRODUCTHUNT_CLIENT_ID/SECRET, PINTEREST_ACCESS_TOKEN) — trend.* uses the deterministic stub source, not a live feed.',
    );
    return createStubTrendSource();
  }

  const disabled = entries.filter((e) => e.enabled === false).map((e) => e.source.name);
  if (disabled.length) {
    console.warn(`[warn] Trend source(s) configured but disabled via TREND_SOURCE_*_ENABLED=false: ${disabled.join(', ')}.`);
  }

  return createCompositeTrendSource(entries);
}
