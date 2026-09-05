import { applyKeywordFilters, type Trend, type TrendSource } from '../trend.js';
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
  /**
   * Both already present in the listing this adapter is reading — no second
   * request. `thumbnail` is sometimes a sentinel word rather than a URL
   * ('self', 'default', 'nsfw', 'spoiler', ''), which is why `preview` is
   * preferred and the sentinel case is checked for below.
   */
  thumbnail?: string;
  preview?: { images?: Array<{ source?: { url?: string } }> };
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

  /**
   * `/r/{sub}/search` — Reddit's own search, scoped to the configured subreddits.
   *
   * `restrict_sr=1` is the load-bearing parameter: without it this searches all
   * of Reddit, and the whole reason a brand configures subreddits is to say which
   * corners of it are worth listening to. A keyword recipe should find posts
   * about `sourdough` in the baking subreddits the brand chose, not in r/all.
   *
   * `sort=top&t=week` rather than relevance: this adapter's job is trends, and
   * the most *relevant* post about a keyword is frequently three years old. A
   * week bounds it to something still worth reacting to, and matches the 48-hour
   * decay `toTrend` already assumes.
   */
  async function searchSubreddit(subreddit: string, keywords: readonly string[], limit: number): Promise<Trend[]> {
    const token = await getAccessToken();
    const params = new URLSearchParams({
      // OR, matching `matchesKeywords`. Reddit's search understands `OR` as a
      // boolean operator between terms.
      q: keywords.map((k) => k.trim()).filter(Boolean).join(' OR '),
      restrict_sr: '1',
      sort: 'top',
      t: 'week',
      limit: String(limit),
    });
    const res = await timedFetch(
      `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/search?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}`, 'User-Agent': config.userAgent } },
      fetchImpl,
    );
    if (!res.ok) throw new Error(`Reddit search failed for r/${subreddit}: ${res.status} ${res.statusText}`);
    const body = (await res.json()) as RedditListing;
    return body.data.children
      .filter((c) => !c.data.stickied && !c.data.over_18)
      .map((c) => toTrend(c.data, subreddit));
  }

  return {
    name: 'reddit',
    keywordSupport: 'server',

    async fetch({ limit, keywords, excludeKeywords }) {
      const searched = Boolean(keywords?.length);
      const perSubreddit = Math.max(3, Math.ceil(limit / Math.max(1, config.subreddits.length)));
      const results = await Promise.all(
        config.subreddits.map((sr) =>
          (searched ? searchSubreddit(sr, keywords!, perSubreddit) : fetchSubreddit(sr, perSubreddit)).catch(
            (error) => {
              // One misspelled or private subreddit must not take down every
              // other subreddit in the same config — the same fault-isolation
              // property the composite source enforces one level up.
              console.warn(`[warn] reddit trend source: r/${sr} failed`, { error: error instanceof Error ? error.message : String(error) });
              return [] as Trend[];
            },
          ),
        ),
      );
      // The exclude list runs over server results too: Reddit's search takes a
      // query and takes no negation.
      return applyKeywordFilters(results.flat(), {
        ...(keywords ? { keywords } : {}),
        ...(excludeKeywords ? { excludeKeywords } : {}),
        alreadySearched: searched,
      }).slice(0, limit);
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
  const image = previewImage(post);

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
    ...(image ? { media: { url: image, kind: 'image' as const } } : {}),
    language: 'en',
    /* Subreddits are global; Reddit's listing takes no region. */
    regions: [],
  };
}

/**
 * A renderable image for the post, or nothing.
 *
 * Reddit HTML-escapes the query string on `preview` URLs — an unescaped
 * `&amp;` in an `<img src>` breaks the signature Reddit checks and the image
 * 403s, so the entities are decoded here rather than in the component.
 *
 * A text post has no image, and saying so lets the card fall back to the
 * prototype's text variant instead of rendering a broken frame.
 */
function previewImage(post: RedditPostData): string | undefined {
  const preview = post.preview?.images?.[0]?.source?.url;
  if (preview) return preview.replace(/&amp;/g, '&');
  const thumb = post.thumbnail;
  return thumb && /^https?:\/\//.test(thumb) ? thumb : undefined;
}
