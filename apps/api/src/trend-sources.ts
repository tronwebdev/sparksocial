import {
  createCompositeTrendSource,
  createRedditTrendSource,
  createYouTubeTrendSource,
  createHackerNewsTrendSource,
  createProductHuntTrendSource,
  createPinterestTrendSource,
  createTikTokTrendSource,
  createXTrendSource,
  createGoogleTrendsSource,
  createMultiRegionTrendSource,
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
/**
 * The configured entries, before they are merged.
 *
 * Split out from `buildTrendSource` because two callers need different things
 * from the same list: the composite wants them merged, and `trend.sources` wants
 * to describe each one — specifically whether it can search its platform for a
 * keyword or only narrow what it already fetches, which the merged composite
 * deliberately flattens to one pessimistic value.
 */
export function buildTrendSourceEntries(): TrendSourceEntry[] {
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

  if (envSet('X_BEARER_TOKEN')) {
    entries.push({
      source: createXTrendSource({
        bearerToken: envStr('X_BEARER_TOKEN', ''),
        /* WOEID, not a country code — X is the one vendor here that numbers
           its regions. 1 is worldwide; `x.ts` maps ISO codes for the rest. */
        woeid: envNum('X_TREND_WOEID', 1),
      }),
      enabled: envBool('TREND_SOURCE_X_ENABLED', true),
    });
  }

  // Creative Center issues browser sessions rather than long-lived API keys, so
  // this token expires and the source starts failing closed (the composite
  // degrades to everyone else). See tiktok.ts's own caveat — with Pinterest, the
  // two least-verified endpoints in the set.
  if (envSet('TIKTOK_CREATIVE_TOKEN')) {
    entries.push({
      source: createTikTokTrendSource({
        accessToken: envStr('TIKTOK_CREATIVE_TOKEN', ''),
        regionCode: envStr('TIKTOK_TREND_REGION', 'US'),
        periodDays: envNum('TIKTOK_TREND_PERIOD_DAYS', 7) === 30 ? 30 : 7,
      }),
      enabled: envBool('TREND_SOURCE_TIKTOK_ENABLED', true),
    });
  }

  // Google Trends' public RSS needs no credential, so — exactly like Hacker
  // News — there is no "configured" signal to key the entry on and the switch
  // defaults to *off*. Availability is not consent to spend a request per rank.
  if (envBool('TREND_SOURCE_GOOGLE_ENABLED', false)) {
    entries.push({
      source: createGoogleTrendsSource({ regionCode: envStr('GOOGLE_TREND_REGION', 'US') }),
      enabled: true,
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

  return entries;
}

/**
 * The regions `DISC-02`'s Geo & Audience panel breaks down by.
 *
 * Empty or single by default, and that default is the point: a breakdown is
 * composed by asking each region separately (see `createMultiRegionTrendSource`),
 * so `TREND_REGIONS=US,GB,NG` triples the request count against YouTube's daily
 * quota and X's per-call bill. An operator opts into that knowingly or the panel
 * shows the one region the fetch used.
 */
export function trendRegions(): string[] {
  return envList('TREND_REGIONS', []).map((r) => r.trim().toUpperCase()).filter(Boolean);
}


/**
 * EVERY source this build knows about, live or not — what `trend.sources`
 * answers with, and what Discovery's rail lists.
 *
 * ── Why the list is not just the configured ones ─────────────────────────
 *
 * `buildTrendSourceEntries` returns the vendors that have credentials, which is
 * the right list for *fetching* and the wrong list for a screen. Discovery's
 * rail was showing four rows because four were configured, so X, TikTok,
 * Reddit and Pinterest were not absent-and-explained, they were simply
 * invisible: the owner could not tell whether the product does not support
 * TikTok, or supports it and nobody has pasted a token. Those are very
 * different facts and only one of them is true.
 *
 * So every vendor appears, each carrying **why** it is not live and the exact
 * environment variables that would make it so. Names, never values — the value
 * of a bearer token has no business leaving the API process, and the name of
 * the variable is the one piece of information the person reading the screen
 * actually needs.
 *
 * `configured` and `enabled` are kept apart on purpose, because they fail
 * differently: no credentials is "nobody has set this up", while
 * `TREND_SOURCE_X_ENABLED=false` is "somebody turned this off deliberately",
 * and a screen that collapsed both into "off" would send the reader hunting for
 * a token they already have.
 */
export interface TrendSourceStatus {
  name: string;
  keywordSupport: 'server' | 'filter';
  /** Credentials present (or, for the keyless ones, nothing needed). */
  configured: boolean;
  /** The operator's `TREND_SOURCE_*_ENABLED` switch. */
  enabled: boolean;
  /** Environment variable names — never their values. */
  requires: string[];
  /** One line for the screen when this source is not live. */
  note?: string;
}

const KNOWN_SOURCES: Array<{
  name: string;
  keywordSupport: 'server' | 'filter';
  requires: string[];
  enabledVar: string;
  /** Keyless sources have nothing to check, so they default their switch off. */
  keyless?: boolean;
  note: string;
}> = [
  {
    name: 'youtube',
    keywordSupport: 'server',
    requires: ['YOUTUBE_API_KEY'],
    enabledVar: 'TREND_SOURCE_YOUTUBE_ENABLED',
    note: 'Data API v3 — free up to Google Cloud’s daily quota.',
  },
  {
    name: 'reddit',
    keywordSupport: 'server',
    requires: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'],
    enabledVar: 'TREND_SOURCE_REDDIT_ENABLED',
    note: 'Free tier of the Data API; a commercial licence is ~$12K/yr at scale.',
  },
  {
    name: 'x',
    keywordSupport: 'filter',
    requires: ['X_BEARER_TOKEN'],
    enabledVar: 'TREND_SOURCE_X_ENABLED',
    note: 'The trends endpoint is not in X’s free tier — Basic is ~$200/mo.',
  },
  {
    name: 'tiktok',
    keywordSupport: 'filter',
    requires: ['TIKTOK_CREATIVE_TOKEN'],
    enabledVar: 'TREND_SOURCE_TIKTOK_ENABLED',
    note: 'Creative Center issues browser sessions, not API keys, so the token expires.',
  },
  {
    name: 'google',
    keywordSupport: 'filter',
    requires: [],
    enabledVar: 'TREND_SOURCE_GOOGLE_ENABLED',
    keyless: true,
    note: 'Public trending RSS — no credential, so it is opt-in rather than automatic.',
  },
  {
    name: 'hackernews',
    keywordSupport: 'filter',
    requires: [],
    enabledVar: 'TREND_SOURCE_HACKERNEWS_ENABLED',
    keyless: true,
    note: 'Public Firebase API — no credential, so it is opt-in rather than automatic.',
  },
  {
    name: 'producthunt',
    keywordSupport: 'filter',
    requires: ['PRODUCTHUNT_CLIENT_ID', 'PRODUCTHUNT_CLIENT_SECRET'],
    enabledVar: 'TREND_SOURCE_PRODUCTHUNT_ENABLED',
    note: 'Free API v2 (GraphQL), OAuth client-credentials.',
  },
  {
    name: 'pinterest',
    keywordSupport: 'filter',
    requires: ['PINTEREST_ACCESS_TOKEN'],
    enabledVar: 'TREND_SOURCE_PINTEREST_ENABLED',
    note: 'Needs Trends API access approved on a Pinterest developer app.',
  },
];

export function describeAllTrendSources(): TrendSourceStatus[] {
  return KNOWN_SOURCES.map((s) => {
    const configured = s.keyless ? envBool(s.enabledVar, false) : s.requires.every((v) => envSet(v));
    /* A keyless source's switch *is* its configuration, so it cannot be
       "configured but disabled" — hence the `keyless` default of true here. */
    const enabled = s.keyless ? true : envBool(s.enabledVar, true);
    return {
      name: s.name,
      keywordSupport: s.keywordSupport,
      configured,
      enabled,
      requires: s.keyless ? [s.enabledVar] : s.requires,
      ...(configured && enabled ? {} : { note: s.note }),
    };
  });
}

export function buildTrendSource(): TrendSource {
  const entries = buildTrendSourceEntries();

  // No real source configured at all → the stub, alone. Mixing it in
  // alongside real sources would mean a "real" feed silently contains
  // fabricated entries — worse than an honestly empty one.
  if (entries.length === 0) {
    console.warn(
      '[warn] No trend source configured (REDDIT_CLIENT_ID/SECRET, YOUTUBE_API_KEY, TREND_SOURCE_HACKERNEWS_ENABLED, ' +
        'PRODUCTHUNT_CLIENT_ID/SECRET, PINTEREST_ACCESS_TOKEN, X_BEARER_TOKEN, TIKTOK_CREATIVE_TOKEN, ' +
        'TREND_SOURCE_GOOGLE_ENABLED) — trend.* uses the deterministic stub source, not a live feed.',
    );
    return createStubTrendSource();
  }

  const disabled = entries.filter((e) => e.enabled === false).map((e) => e.source.name);
  if (disabled.length) {
    console.warn(`[warn] Trend source(s) configured but disabled via TREND_SOURCE_*_ENABLED=false: ${disabled.join(', ')}.`);
  }

  const composite = createCompositeTrendSource(entries);

  /**
   * The region wrapper goes **outside** the composite, not inside each adapter:
   * "ask every source for the UK" is one fan-out, and putting it here means a
   * source that ignores `region` (Reddit, Hacker News, Product Hunt) simply
   * returns the same trends for each pass and merges into one row with one
   * region entry, rather than every adapter having to know about the feature.
   */
  const regions = trendRegions();
  if (regions.length > 1) {
    console.info(`[info] Trend region breakdown enabled for ${regions.join(', ')} — ${regions.length} fetches per rank.`);
  }
  return createMultiRegionTrendSource(composite, { regions });
}
