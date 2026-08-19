import { PublishError, type Platform, type PlatformAdapter, type PublishReceipt, type PublishRequest } from '../adapter.js';
import { splitScopedToken } from './scopedToken.js';

/**
 * Native Instagram adapter — Meta Graph API's Content Publishing endpoints.
 * Prepends ahead of the aggregator in `routeAdapters` once
 * `META_APP_ID`/`META_APP_SECRET` are configured and a brand has connected
 * via `integration.connect`.
 *
 * ── Why this one is URL-based, unlike LinkedIn/X/YouTube ──────────────────
 * Instagram's publish API takes `image_url`/`video_url` directly — the
 * platform fetches the media itself, so this adapter never downloads bytes,
 * unlike the three that require an upload step.
 *
 * ── The two-step publish ────────────────────────────────────────────────
 * 1. `POST /{ig-user-id}/media` — creates a media *container* from the URL,
 *    returns `{id: <creation_id>}`. Not live yet.
 * 2. `POST /{ig-user-id}/media_publish` — publishes the container, returns
 *    `{id: <media-id>}`, the real post id.
 *
 * `igUserId` (the connected Instagram Business Account, distinct from the
 * Facebook Page it's linked to) is not something this adapter discovers —
 * it comes from whatever `integration.connect`'s token-exchange records as
 * the account, passed in at construction. There is no live Meta developer
 * app in this environment to verify field names or the container-ready
 * polling behaviour some accounts need against — built from Meta's
 * published Graph API docs at the time of writing, flagged the same way
 * `ayrshareAdapter.ts` flags its own response-shape uncertainty.
 *
 * ── Delete ───────────────────────────────────────────────────────────────
 * Deliberately not implemented. The Graph API has no documented endpoint to
 * delete already-published Instagram media (unlike a Facebook Page post) —
 * inventing one would be worse than omitting it. `publish.rollback` already
 * handles an adapter with no `delete` cleanly.
 */

export interface InstagramAdapterOptions {
  apiVersion?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_API_VERSION = 'v21.0';
const GRAPH_BASE = 'https://graph.facebook.com';

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number };
}

function classifyGraphError(status: number, body: GraphErrorBody, platform: Platform): PublishError {
  const message = body.error?.message ?? `Instagram publish failed (${status}).`;
  // Meta's rate-limit/transient codes: 4 (app-level throttle), 17 (user
  // throttle), 32 (page throttle), or any 5xx. Everything else — bad media
  // URL, missing permission, disabled account — fails identically on retry.
  const retryable = status >= 500 || [4, 17, 32].includes(body.error?.code ?? -1);
  return new PublishError(platform, message, retryable);
}

export function createInstagramAdapter(opts: InstagramAdapterOptions = {}): PlatformAdapter {
  const doFetch = opts.fetchImpl ?? fetch;
  const apiVersion = opts.apiVersion ?? DEFAULT_API_VERSION;
  const name = 'native:instagram';

  async function graphPost(igUserId: string, path: string, accessToken: string, body: Record<string, string>): Promise<{ id: string }> {
    let response: Response;
    try {
      response = await doFetch(`${GRAPH_BASE}/${apiVersion}/${igUserId}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...body, access_token: accessToken }).toString(),
      });
    } catch (e) {
      throw new PublishError('instagram', e instanceof Error ? e.message : String(e), true);
    }

    const json = (await response.json().catch(() => ({}))) as GraphErrorBody & { id?: string };
    if (!response.ok || !json.id) {
      throw classifyGraphError(response.status, json, 'instagram');
    }
    return { id: json.id };
  }

  return {
    name,
    supports: (platform) => platform === 'instagram',

    async publish(req: PublishRequest): Promise<PublishReceipt> {
      if (!req.accessToken) {
        throw new PublishError('instagram', 'No connected Instagram account for this brand — connect one in Settings first.', false);
      }
      // The connected account id travels on the token record as its own
      // `accountLabel`/id is not modeled per-request here — the access
      // token itself is scoped to one Instagram Business Account by Meta's
      // own OAuth, and Graph API resolves `/me` style calls from it, but
      // the publish endpoints require the numeric ig-user-id explicitly.
      // Threaded through the token string as `igUserId:token` (see
      // `integration.ts`'s connect flow) rather than adding a second field
      // to `PublishRequest` only Instagram needs.
      const [igUserId, accessToken] = splitScopedToken(req.accessToken);
      if (!igUserId) {
        throw new PublishError('instagram', 'This brand’s Instagram connection is missing its account id — reconnect in Settings.', false);
      }

      const isVideo = req.mediaUrls[0] ? /\.(mp4|mov)(\?|$)/i.test(req.mediaUrls[0]) : false;
      const container = await graphPost(igUserId, 'media', accessToken, {
        caption: req.text,
        ...(req.mediaUrls[0] ? (isVideo ? { video_url: req.mediaUrls[0], media_type: 'REELS' } : { image_url: req.mediaUrls[0] }) : {}),
      });
      const published = await graphPost(igUserId, 'media_publish', accessToken, { creation_id: container.id });

      return {
        platform: 'instagram',
        externalId: published.id,
        via: name,
        publishedAt: new Date(),
      };
    },
  };
}
