import { PublishError, type Platform, type PlatformAdapter, type PublishReceipt, type PublishRequest } from './adapter.js';

/**
 * The real aggregator adapter — Ayrshare's `POST /api/post`. Named in
 * `adapter.ts`'s own header comment as the P4 default; this is what
 * `createStubAdapter` was standing in for.
 *
 * ── Why the response is read defensively ─────────────────────────────────
 * There is no live Ayrshare account here to pin the exact response shape
 * against (same caveat `packages/analytics/src/ayrshare.ts` states for the
 * analytics endpoint). The request shape (Bearer auth, `{post, platforms,
 * mediaUrls}`) and the top-level `{status, id, postIds[]}` envelope are
 * Ayrshare's documented contract with reasonable confidence; the exact field
 * names inside each `postIds[]` entry (`postUrl` vs `url`, error shape) are
 * the part to verify against a real account before this adapter carries
 * production traffic.
 *
 * `externalId` on the returned receipt is Ayrshare's top-level `id` —
 * deliberately, because that is the same id `analytics.sync`'s Ayrshare
 * client polls with (`POST /api/analytics/post`, `{id}`). The two only work
 * together if this adapter and that client agree on what "the post id" means,
 * and they do by construction here.
 */

export interface AyrshareAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://api.ayrshare.com';

/**
 * Ayrshare's platform keys, where they diverge from ours. `Platform`
 * (`adapter.ts`) matches the product's own vocabulary (`youtube_shorts`,
 * `x`); Ayrshare's API predates X's rename and still keys shorts under the
 * main YouTube platform. Best-effort mapping, flagged for the same reason as
 * the response-shape caveat above.
 */
const AYRSHARE_PLATFORM: Record<Platform, string> = {
  instagram: 'instagram',
  // Ayrshare treats a story as the same platform with a different post type;
  // the type is set per-request, so the platform key is unchanged.
  instagram_story: 'instagram',
  tiktok: 'tiktok',
  linkedin: 'linkedin',
  x: 'twitter',
  youtube_shorts: 'youtube',
  youtube_long: 'youtube',
  facebook: 'facebook',
  facebook_group: 'fbg',
  threads: 'threads',
  pinterest: 'pinterest',
  google_business: 'gmb',
  reddit: 'reddit',
  bluesky: 'bluesky',
};

interface AyrsharePostResult {
  platform?: string;
  status?: string;
  id?: string;
  postUrl?: string;
  errors?: Array<{ message?: string }>;
}

interface AyrsharePostResponse {
  status?: string;
  id?: string;
  postIds?: AyrsharePostResult[];
  errors?: Array<{ message?: string }>;
}

export function createAyrshareAdapter(opts: AyrshareAdapterOptions): PlatformAdapter {
  const doFetch = opts.fetchImpl ?? fetch;
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const name = 'aggregator:ayrshare';

  return {
    name,
    // Ayrshare covers the full `Platform` enum today; native adapters take
    // over per-platform as approvals clear (routeAdapters prepends them).
    supports: () => true,

    async publish(req: PublishRequest): Promise<PublishReceipt> {
      const ayrsharePlatform = AYRSHARE_PLATFORM[req.platform];

      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/api/post`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            post: req.text,
            platforms: [ayrsharePlatform],
            ...(req.mediaUrls.length ? { mediaUrls: req.mediaUrls } : {}),
          }),
        });
      } catch (e) {
        // Network failure, not a platform response — treat as transient.
        throw new PublishError(req.platform, e instanceof Error ? e.message : String(e), true);
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const retryable = response.status === 429 || response.status >= 500;
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
        throw new PublishError(
          req.platform,
          `Ayrshare publish failed (${response.status}): ${detail.slice(0, 200)}`,
          retryable,
          Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
        );
      }

      const body = (await response.json()) as AyrsharePostResponse;
      const result = body.postIds?.find((p) => p.platform === ayrsharePlatform);

      if (body.status !== 'success' || !result || result.status !== 'success' || !body.id) {
        const message =
          result?.errors?.[0]?.message ?? body.errors?.[0]?.message ?? 'Ayrshare reported the post did not succeed.';
        // A structured failure response is a platform-level rejection
        // (caption/media rejected, account disconnected) — not retryable by
        // us; retrying an identical request will fail identically.
        throw new PublishError(req.platform, message, false);
      }

      return {
        platform: req.platform,
        externalId: body.id,
        ...(result.postUrl ? { url: result.postUrl } : {}),
        via: name,
        publishedAt: new Date(),
      };
    },

    /**
     * Ayrshare's documented deletion endpoint: `DELETE /api/post/{id}`, the
     * top-level post id — the same `externalId` this adapter's `publish`
     * returns as `body.id`, not a per-platform `postIds[].id`. Same
     * response-shape caveat as `publish` above: unverified against a live
     * account, kept defensive (any non-2xx is surfaced, not swallowed).
     */
    async delete(externalId: string, platform: Platform): Promise<void> {
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/api/post/${encodeURIComponent(externalId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${opts.apiKey}` },
        });
      } catch (e) {
        throw new PublishError(platform, e instanceof Error ? e.message : String(e), true);
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new PublishError(
          platform,
          `Ayrshare delete failed (${response.status}): ${detail.slice(0, 200)}`,
          response.status === 429 || response.status >= 500,
        );
      }
    },
  };
}
