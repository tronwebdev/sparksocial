import { PublishError, type Platform, type PlatformAdapter, type PublishReceipt, type PublishRequest } from '../adapter.js';

/**
 * Native Reddit adapter — `POST /api/submit` on `oauth.reddit.com`.
 *
 * ── A subreddit is the destination, and getting it wrong is expensive ─────
 *
 * Reddit is the platform where publishing to the wrong place has the worst
 * consequences: a marketing post in the wrong community is removed, and the
 * account is the one that carries the reputation. So `target` is required and
 * there is no fallback. `PublishRequest.target` holds the subreddit name.
 *
 * ── Link post or text post ────────────────────────────────────────────────
 *
 * Reddit distinguishes them at submit time with `kind`, and they are genuinely
 * different posts. A post with media becomes a `link` to that media; a post
 * without becomes a `self` (text) post. Sending `kind=self` with a URL in the
 * body posts the URL as text, which renders as a naked link and is treated as
 * spam by most subreddits.
 *
 * ── Why the User-Agent matters ────────────────────────────────────────────
 *
 * Reddit rejects a request with no User-Agent outright and rate-limits a shared
 * or generic one hard. Their API rules ask for an identifying string, so one is
 * sent on every call rather than left to whatever the runtime defaults to.
 *
 * Built from Reddit's published API documentation; no live Reddit app exists in
 * this environment to verify against, flagged as the other native adapters flag
 * theirs.
 */

export interface RedditAdapterOptions {
  fetchImpl?: typeof fetch;
  /** Overridable so a deployment can identify itself per Reddit's API rules. */
  userAgent?: string;
}

const API_BASE = 'https://oauth.reddit.com';
const DEFAULT_USER_AGENT = 'web:sparksocial:v1 (by /u/sparksocial)';
const PLATFORM: Platform = 'reddit';

interface SubmitResponse {
  json?: {
    errors?: [string, string, string?][];
    data?: { id?: string; name?: string; url?: string };
  };
}

export function createRedditAdapter(opts: RedditAdapterOptions = {}): PlatformAdapter {
  const doFetch = opts.fetchImpl ?? fetch;
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const name = 'native:reddit';

  return {
    name,
    supports: (platform) => platform === PLATFORM,

    async publish(req: PublishRequest): Promise<PublishReceipt> {
      if (!req.accessToken) {
        throw new PublishError(PLATFORM, 'No connected Reddit account for this brand — connect one in Settings first.', false);
      }
      if (!req.target) {
        throw new PublishError(
          PLATFORM,
          'A Reddit post needs a subreddit — choose one on the campaign’s accounts. There is no safe default.',
          false,
        );
      }

      // `r/name`, `/r/name` and `name` all reach here from a human; Reddit wants
      // the bare name.
      const subreddit = req.target.replace(/^\/?r\//i, '');
      const media = req.mediaUrls[0];

      /*
       * Reddit's title is a separate field from the body and is capped at 300
       * characters. The first line is the title — the same rule as Pinterest,
       * and for the same reason: the copy is written as a post, not as a
       * headline plus a body, and truncating the whole thing would publish a
       * sentence cut mid-word.
       */
      const title = (req.text.split('\n')[0] ?? req.text).slice(0, 300);

      let res: Response;
      try {
        res = await doFetch(`${API_BASE}/api/submit`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${req.accessToken}`,
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': userAgent,
          },
          body: new URLSearchParams({
            sr: subreddit,
            title,
            api_type: 'json',
            ...(media ? { kind: 'link', url: media } : { kind: 'self', text: req.text }),
          }).toString(),
        });
      } catch (e) {
        throw new PublishError(PLATFORM, e instanceof Error ? e.message : String(e), true);
      }

      if (!res.ok) {
        throw new PublishError(PLATFORM, `Reddit publish failed (${res.status}).`, res.status === 429 || res.status >= 500);
      }

      /*
       * Reddit answers 200 with the errors inside the body. A submit that was
       * rejected for rate limiting, a banned domain or a subreddit rule reads as
       * success at the HTTP layer, so the body is where the real result is — and
       * not reading it is how a post that never existed gets a receipt.
       */
      const body = (await res.json().catch(() => ({}))) as SubmitResponse;
      const firstError = body.json?.errors?.[0];
      if (firstError) {
        const [code, explanation] = firstError;
        // RATELIMIT is Reddit asking to wait, which a retry can satisfy.
        // Everything else — SUBREDDIT_NOTALLOWED, NO_TEXT, DOMAIN_BANNED — is
        // the same answer however many times it is asked.
        throw new PublishError(PLATFORM, `${explanation ?? 'Reddit rejected the post.'} (${code})`, code === 'RATELIMIT');
      }

      const id = body.json?.data?.id;
      if (!id) {
        throw new PublishError(PLATFORM, 'Reddit accepted the post but returned no id.', false);
      }

      return {
        platform: PLATFORM,
        externalId: body.json?.data?.name ?? id,
        ...(body.json?.data?.url ? { url: body.json.data.url } : {}),
        via: name,
        publishedAt: new Date(),
      };
    },

    /**
     * Reddit's delete takes the fullname (`t3_abc`), which is why the receipt
     * stores `data.name` rather than the bare id.
     */
    async delete(externalId: string, platform: Platform, accessToken?: string): Promise<void> {
      if (!accessToken) {
        throw new PublishError(platform, 'Cannot delete a Reddit post without the brand’s connection.', false);
      }
      const res = await doFetch(`${API_BASE}/api/del`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': userAgent,
        },
        body: new URLSearchParams({ id: externalId }).toString(),
      });
      if (!res.ok) {
        throw new PublishError(platform, `Could not delete the Reddit post (${res.status}).`, res.status >= 500);
      }
    },
  };
}
