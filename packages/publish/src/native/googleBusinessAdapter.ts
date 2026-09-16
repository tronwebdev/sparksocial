import { PublishError, type Platform, type PlatformAdapter, type PublishReceipt, type PublishRequest } from '../adapter.js';
import { splitScopedToken } from './scopedToken.js';

/**
 * Native Google Business Profile adapter — `localPosts` on the My Business API.
 *
 * ── A location, not an account ────────────────────────────────────────────
 *
 * A Google Business account can hold many locations, and a post belongs to one.
 * A chain with six branches has six places this could go and no correct default,
 * so `PublishRequest.target` carries the location resource name
 * (`locations/12345`) and a post without one is refused.
 *
 * The *account* resource name (`accounts/123`) rides with the token from the
 * connect flow — see `scopedToken.ts` — because the post path needs both:
 * `POST /v4/{account}/{location}/localPosts`.
 *
 * ── Why posts here look different ─────────────────────────────────────────
 *
 * A local post is not a social post. It has a summary, an optional call to
 * action with a URL, and it expires — Google removes STANDARD posts after seven
 * days. That is the platform's own behaviour and not something to work around;
 * it is the reason a Business Profile post is worth scheduling repeatedly where
 * an Instagram post is not.
 *
 * Built from Google's published My Business API documentation. That API is
 * access-gated — a project must be approved before the endpoints respond at all
 * — so this is written to the documented shapes and, like every other native
 * adapter here, has not been run against a live approved project.
 */

export interface GoogleBusinessAdapterOptions {
  fetchImpl?: typeof fetch;
}

const API_BASE = 'https://mybusiness.googleapis.com/v4';
const PLATFORM: Platform = 'google_business';

interface GoogleErrorBody {
  error?: { message?: string; status?: string };
}

export function createGoogleBusinessAdapter(opts: GoogleBusinessAdapterOptions = {}): PlatformAdapter {
  const doFetch = opts.fetchImpl ?? fetch;
  const name = 'native:google_business';

  return {
    name,
    supports: (platform) => platform === PLATFORM,

    async publish(req: PublishRequest): Promise<PublishReceipt> {
      if (!req.accessToken) {
        throw new PublishError(PLATFORM, 'No connected Google Business account for this brand — connect one in Settings first.', false);
      }
      // `{accounts/123}:{token}` — the account resource name travels with the
      // token because every post path needs it. See `scopedToken.ts`.
      const [account, token] = splitScopedToken(req.accessToken);
      if (!account) {
        throw new PublishError(
          PLATFORM,
          'This brand’s Google Business connection is missing its account id — reconnect in Settings.',
          false,
        );
      }
      if (!req.target) {
        throw new PublishError(
          PLATFORM,
          'A Google Business post needs a location — a profile with several branches has no default one.',
          false,
        );
      }

      // Accepts `locations/123` or a bare `123`; the API wants the resource form.
      const location = req.target.startsWith('locations/') ? req.target : `locations/${req.target}`;
      const media = req.mediaUrls[0];
      const isVideo = media ? /\.(mp4|mov)(\?|$)/i.test(media) : false;

      let res: Response;
      try {
        res = await doFetch(`${API_BASE}/${account}/${location}/localPosts`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            languageCode: 'en',
            /*
             * Google caps the summary at 1500 characters and rejects anything
             * longer outright rather than truncating, so the cut happens here
             * where it can at least be deliberate.
             */
            summary: req.text.slice(0, 1500),
            topicType: 'STANDARD',
            ...(media
              ? {
                  media: [{ mediaFormat: isVideo ? 'VIDEO' : 'PHOTO', sourceUrl: media }],
                }
              : {}),
          }),
        });
      } catch (e) {
        throw new PublishError(PLATFORM, e instanceof Error ? e.message : String(e), true);
      }

      const body = (await res.json().catch(() => ({}))) as GoogleErrorBody & { name?: string; searchUrl?: string };
      if (!res.ok || !body.name) {
        const message = body.error?.message ?? `Google Business publish failed (${res.status}).`;
        // 429 and 5xx are worth retrying. PERMISSION_DENIED — which is what an
        // unapproved project gets — is not: it is the same answer every time
        // until somebody is granted access.
        throw new PublishError(PLATFORM, message, res.status === 429 || res.status >= 500);
      }

      return {
        platform: PLATFORM,
        // `accounts/1/locations/2/localPosts/3` — the resource name is the id.
        externalId: body.name,
        ...(body.searchUrl ? { url: body.searchUrl } : {}),
        via: name,
        publishedAt: new Date(),
      };
    },

    async delete(externalId: string, platform: Platform, accessToken?: string): Promise<void> {
      if (!accessToken) {
        throw new PublishError(platform, 'Cannot delete a Google Business post without the brand’s connection.', false);
      }
      const [, token] = splitScopedToken(accessToken);
      // `externalId` is already the full resource name, so it is the whole path.
      const res = await doFetch(`${API_BASE}/${externalId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 404) {
        throw new PublishError(platform, `Could not delete the Google Business post (${res.status}).`, res.status >= 500);
      }
    },
  };
}
