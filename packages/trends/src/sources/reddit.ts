import type { Trend, TrendSource } from '../trend.js';
import { timedFetch, clamp01 } from './http.js';

/**
 * REDDIT — free tier of Reddit's Data API (OAuth client-credentials grant;
 * becomes a paid licence only past Reddit's free-tier volume, per §8's own
 * note in `trend.ts`). Subreddits are caller-supplied config, never a
 * hardcoded niche list — CLAUDE.md invariant 5 applies to trend sources the
 * same way it applies to playbooks.
 *
 * ── Why velocity/saturation are proxies, and growth is 0 ───────────────────
 * A single API call is one snapshot in time. `score / hours-since-posted` is
 * a real, defensible velocity signal (the same shape Reddit's own "hot"
 * ranking uses) computed from real numbers on the post — not fabricated.
 * `growth` (period-over-period change) genuinely needs a *second* snapshot to
 * diff against, which nothing here stores yet; it is set to `0` ("no signal")
 * rather than guessed. A real implementation of `growth` is the natural next
 * step once trend snapshots are persisted somewhere — out of scope for this
 * pass, which is about combining sources, not building a trend-history
 * warehouse.
 */

export interface RedditTrendSourceConfig {
  clientId: string;
  clientSecret: string;
  /** Reddit requires a descriptive User-Agent identifying the app — a generic one gets rate-limited harder. */
  userAgent: string;
  /** Which communities to sample "hot" posts from. Caller-chosen, not inferred from genome or niche. */
  subreddits: string[];
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

interface RedditTokenResponse {
  access_token: string;
  expires_in: number;
}

interface RedditPostData {
  id: string;
  title: string;
  score: number;
  num_comments: number;
  created_utc: number;
  permalink: string;
  stickied: boolean;
  link_flair_text: string | null;
  over_18: boolean;
}

interface RedditListing {
  data: { children: Array<{ data: RedditPostData }> };
}

export function createRedditTrendSource(config: RedditTrendSourceConfig): TrendSource {
  const fetchImpl = config.fetchImpl ?? fetch;
  let cachedToken: { accessToken: string; expiresAt: number } | null = null;

  async function getAccessToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.accessToken;
    const res = await timedFetch(
      'https://www.reddit.com/api/v1/access_token',
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': config.userAgent,
        },
        body: 'grant_type=client_credentials',
      },
      fetchImpl,
    );
    if (!res.ok) throw new Error(`Reddit OAuth token request failed: ${res.status} ${res.statusText}`);
    const body = (await res.json()) as RedditTokenResponse;
    cachedToken = { accessToken: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return cachedToken.accessToken;
  }

  async function fetchSubreddit(subreddit: string, limit: number): Promise<Trend[]> {
    const token = await getAccessToken();
    const res = await timedFetch(
      `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/hot?limit=${limit}`,
      { headers: { Authorization: `Bearer ${token}`, 'User-Agent': config.userAgent } },
      fetchImpl,
    );
    if (!res.ok) throw new Error(`Reddit fetch failed for r/${subreddit}: ${res.status} ${res.statusText}`);
    const body = (await res.json()) as RedditListing;
    return body.data.children
      // Pinned posts are permanent fixtures, not trends — including them
      // would make every fetch from an active subreddit report the same
      // "trend" forever.
      .filter((c) => !c.data.stickied && !c.data.over_18)
      .map((c) => toTrend(c.data, subreddit));
  }

  return {
    name: 'reddit',

    async fetch({ limit }) {
      const perSubreddit = Math.max(3, Math.ceil(limit / Math.max(1, config.subreddits.length)));
      const results = await Promise.all(
        config.subreddits.map((sr) =>
          fetchSubreddit(sr, perSubreddit).catch((error) => {
            // One misspelled or private subreddit must not take down every
            // other subreddit in the same config — the same fault-isolation
            // property the composite source enforces one level up.
            console.warn(`[warn] reddit trend source: r/${sr} failed`, { error: error instanceof Error ? error.message : String(error) });
            return [] as Trend[];
          }),
        ),
      );
      return results.flat().slice(0, limit);
    },
  };
}

function toTrend(post: RedditPostData, subreddit: string): Trend {
  const ageHours = Math.max(0.1, (Date.now() / 1000 - post.created_utc) / 3600);
  const velocity = clamp01(Math.log10(1 + post.score / ageHours) / 4);
  // No second observation to diff against — a post's own age is the closest
  // real proxy for "how done is this" available from one snapshot. Fully
  // saturated at 48h old is a judgement call, not a measurement; documented
  // as one.
  const saturation = clamp01(ageHours / 48);

  return {
    id: post.id,
    source: 'reddit',
    topic: post.title,
    tags: [subreddit, ...(post.link_flair_text ? [post.link_flair_text] : [])],
    metrics: {
      volume: post.score + post.num_comments,
      velocity,
      saturation,
      growth: 0,
    },
    samples: [{ url: `https://reddit.com${post.permalink}`, caption: post.title }],
    language: 'en',
  };
}
