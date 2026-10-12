import { PublishError, type Platform, type PlatformAdapter, type PublishReceipt, type PublishRequest } from '../adapter.js';
import { splitScopedToken } from './scopedToken.js';

/**
 * Native Facebook adapter — Graph API Page publishing, plus Groups.
 *
 * ── Why it shares Instagram's connection ──────────────────────────────────
 *
 * There is no separate "Facebook login" to make. An Instagram Business account
 * exists only because a Facebook Page owns it, Meta issues both from one OAuth
 * handshake, and `exchangeInstagram` already calls `/me/accounts` to find that
 * Page. `PARENT_PLATFORM` records the relationship; this adapter is what spends
 * it. A brand connects Instagram once and gets Instagram, Stories, Facebook and
 * Groups.
 *
 * The scope it needs — `pages_manage_posts` — is requested by the Instagram
 * connect flow for exactly this reason. A brand that connected before that scope
 * was added holds a token without it, and Meta will refuse with a permissions
 * error rather than anything subtler; reconnecting is the repair, and the error
 * text below says so rather than leaving someone to decode code 200.
 *
 * ── The token this actually posts with ────────────────────────────────────
 *
 * `integration.connect` stores `{ig-user-id}:{user-token}`. Page publishing
 * needs the *Page* access token, not the user token, so this adapter exchanges
 * one for the other through `/me/accounts` on each publish rather than storing a
 * second credential. That is one extra request per post, against a token that
 * can be revoked independently of the user's — the alternative is a stale Page
 * token in the database that fails at publish time with no way to notice earlier.
 *
 * ── Groups ────────────────────────────────────────────────────────────────
 *
 * `facebook_group` posts to a Group the Page administers, addressed by the group
 * id in `PublishRequest.target`. Meta restricted Groups publishing heavily in
 * 2020 — an app needs the Groups API permission and the Group must have
 * installed the app — so this will refuse for most brands until that is granted.
 * It refuses by naming that, which is the useful failure; the aggregator remains
 * the route that does not need the permission.
 *
 * Built from Meta's published Graph API documentation. There is no live Meta
 * developer app in this environment to verify field names or error codes
 * against, flagged the same way `instagramAdapter.ts` and `ayrshareAdapter.ts`
 * flag their own.
 */

export interface FacebookAdapterOptions {
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
  const message = body.error?.message ?? `Facebook publish failed (${status}).`;
  // Same throttle codes the Instagram adapter classifies — 4 app-level, 17
  // user-level, 32 page-level — plus any 5xx. A missing permission (code 200)
  // is deliberately not retryable: it fails identically every time until
  // somebody grants it.
  const retryable = status >= 500 || [4, 17, 32].includes(body.error?.code ?? -1);
  return new PublishError(platform, message, retryable);
}

export function createFacebookAdapter(opts: FacebookAdapterOptions = {}): PlatformAdapter {
  const doFetch = opts.fetchImpl ?? fetch;
  const apiVersion = opts.apiVersion ?? DEFAULT_API_VERSION;
  const name = 'native:facebook';

  /**
   * The Page this user administers, and the Page-scoped token to post with.
   *
   * Takes the first Page. A user who administers several has no way to say which
   * one here, and the same limitation already exists in `exchangeInstagram`'s
   * account discovery — worth fixing in one place, when it is fixed, rather than
   * inventing a second selection rule that disagrees with it.
   */
  async function resolvePage(userToken: string, platform: Platform): Promise<{ id: string; token: string }> {
    let res: Response;
    try {
      res = await doFetch(`${GRAPH_BASE}/${apiVersion}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(userToken)}`);
    } catch (e) {
      throw new PublishError(platform, e instanceof Error ? e.message : String(e), true);
    }
    const json = (await res.json().catch(() => ({}))) as GraphErrorBody & {
      data?: { id?: string; access_token?: string }[];
    };
    if (!res.ok) throw classifyGraphError(res.status, json, platform);

    const page = json.data?.find((p) => p.id && p.access_token);
    if (!page?.id || !page.access_token) {
      throw new PublishError(
        platform,
        'This brand’s Meta connection administers no Facebook Page, or was connected before Page publishing was requested — reconnect Instagram in Settings.',
        false,
      );
    }
    return { id: page.id, token: page.access_token };
  }

  async function graphPost(path: string, token: string, body: Record<string, string>, platform: Platform): Promise<{ id: string }> {
    let response: Response;
    try {
      response = await doFetch(`${GRAPH_BASE}/${apiVersion}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...body, access_token: token }).toString(),
      });
    } catch (e) {
      throw new PublishError(platform, e instanceof Error ? e.message : String(e), true);
    }
    const json = (await response.json().catch(() => ({}))) as GraphErrorBody & { id?: string; post_id?: string };
    const id = json.post_id ?? json.id;
    if (!response.ok || !id) throw classifyGraphError(response.status, json, platform);
    return { id };
  }

  return {
    name,
    supports: (platform) => platform === 'facebook' || platform === 'facebook_group',

    async publish(req: PublishRequest): Promise<PublishReceipt> {
      const platform = req.platform === 'facebook_group' ? 'facebook_group' : 'facebook';
      if (!req.accessToken) {
        throw new PublishError(platform, 'No connected Meta account for this brand — connect Instagram in Settings first.', false);
      }
      // `{ig-user-id}:{user-token}` — the id belongs to Instagram, the token is
      // what this needs. See `scopedToken.ts`.
      const [, userToken] = splitScopedToken(req.accessToken);
      const page = await resolvePage(userToken, platform);

      /*
       * A Group post is addressed to the group, not the Page, but still
       * authenticates as the Page. Without a target there is nothing to address,
       * and posting to the Page instead would publish to the wrong audience —
       * the one failure mode worse than not publishing.
       */
      const owner = platform === 'facebook_group' ? req.target : page.id;
      if (platform === 'facebook_group' && !owner) {
        throw new PublishError(
          platform,
          'A Facebook Group post needs the group id — set the account on the campaign, or publish to the Page instead.',
          false,
        );
      }

      const media = req.mediaUrls[0];
      const isVideo = media ? /\.(mp4|mov)(\?|$)/i.test(media) : false;

      /*
       * Three endpoints, because Facebook has three: a link/status post on
       * `/feed`, an image on `/photos`, a video on `/videos`. Posting a photo
       * through `/feed` with a `link` renders it as a link preview rather than
       * an image, which is a different post than the one the calendar promised.
       */
      const [path, body] = media
        ? isVideo
          ? [`${owner}/videos`, { file_url: media, description: req.text }]
          : [`${owner}/photos`, { url: media, caption: req.text }]
        : [`${owner}/feed`, { message: req.text }];

      const published = await graphPost(path, page.token, body, platform);

      return {
        platform,
        externalId: published.id,
        url: `https://facebook.com/${published.id}`,
        via: name,
        publishedAt: new Date(),
      };
    },

    /**
     * Unlike Instagram, a Page post genuinely can be deleted — `DELETE /{post-id}`
     * — so `publish.rollback` is real here rather than refused.
     */
    async delete(externalId: string, platform: Platform, accessToken?: string): Promise<void> {
      if (!accessToken) {
        throw new PublishError(platform, 'Cannot delete a Facebook post without the brand’s connection.', false);
      }
      const [, userToken] = splitScopedToken(accessToken);
      const page = await resolvePage(userToken, platform);

      let res: Response;
      try {
        res = await doFetch(`${GRAPH_BASE}/${apiVersion}/${externalId}?access_token=${encodeURIComponent(page.token)}`, {
          method: 'DELETE',
        });
      } catch (e) {
        throw new PublishError(platform, e instanceof Error ? e.message : String(e), true);
      }
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as GraphErrorBody;
        throw classifyGraphError(res.status, json, platform);
      }
    },
  };
}
