import { PublishError, type Platform, type PlatformAdapter, type PublishReceipt, type PublishRequest } from '../adapter.js';
import { splitScopedToken } from './scopedToken.js';

/**
 * Native Threads adapter — `graph.threads.net`'s two-step publish.
 *
 * ── Why Threads is not derived from Instagram ─────────────────────────────
 *
 * It is a Meta product, so grouping it under `PARENT_PLATFORM` with Instagram
 * looks right and is wrong: Threads has its own developer app, its own OAuth
 * host (`threads.net`), its own graph host, and its own scopes. A Meta app's
 * token does not authenticate here. It is a separate connection because Meta
 * made it one.
 *
 * ── The two steps ─────────────────────────────────────────────────────────
 *
 *   1. `POST /{user-id}/threads` — creates a media container, returns `{id}`.
 *      Not published.
 *   2. `POST /{user-id}/threads_publish` — publishes it, returns the post id.
 *
 * The same shape as Instagram's, which is not a coincidence — and the same
 * reason this adapter never downloads bytes: Threads fetches the media itself
 * from the URL it is given.
 *
 * Built from Meta's published Threads API documentation. No live Threads app
 * exists in this environment to verify field names or error codes against,
 * flagged as `instagramAdapter.ts` and `ayrshareAdapter.ts` flag their own.
 */

export interface ThreadsAdapterOptions {
  apiVersion?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_API_VERSION = 'v1.0';
const GRAPH_BASE = 'https://graph.threads.net';
const PLATFORM: Platform = 'threads';

interface GraphErrorBody {
  error?: { message?: string; code?: number };
}

export function createThreadsAdapter(opts: ThreadsAdapterOptions = {}): PlatformAdapter {
  const doFetch = opts.fetchImpl ?? fetch;
  const apiVersion = opts.apiVersion ?? DEFAULT_API_VERSION;
  const name = 'native:threads';

  async function post(userId: string, path: string, token: string, body: Record<string, string>): Promise<{ id: string }> {
    let res: Response;
    try {
      res = await doFetch(`${GRAPH_BASE}/${apiVersion}/${userId}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...body, access_token: token }).toString(),
      });
    } catch (e) {
      throw new PublishError(PLATFORM, e instanceof Error ? e.message : String(e), true);
    }
    const json = (await res.json().catch(() => ({}))) as GraphErrorBody & { id?: string };
    if (!res.ok || !json.id) {
      const message = json.error?.message ?? `Threads publish failed (${res.status}).`;
      // Meta's throttle codes, same set the Instagram adapter classifies.
      const retryable = res.status >= 500 || [4, 17, 32].includes(json.error?.code ?? -1);
      throw new PublishError(PLATFORM, message, retryable);
    }
    return { id: json.id };
  }

  return {
    name,
    supports: (platform) => platform === PLATFORM,

    async publish(req: PublishRequest): Promise<PublishReceipt> {
      if (!req.accessToken) {
        throw new PublishError(PLATFORM, 'No connected Threads account for this brand — connect one in Settings first.', false);
      }
      // `{threads-user-id}:{token}` — see `scopedToken.ts`.
      const [userId, token] = splitScopedToken(req.accessToken);
      if (!userId) {
        throw new PublishError(PLATFORM, 'This brand’s Threads connection is missing its account id — reconnect in Settings.', false);
      }

      const media = req.mediaUrls[0];
      const isVideo = media ? /\.(mp4|mov)(\?|$)/i.test(media) : false;

      /*
       * `media_type` is required on every container and has no default. TEXT is
       * the one Threads uses for a post with no attachment — omitting the field
       * entirely is rejected, which is why there is no "media only when present"
       * branch here the way Instagram has one.
       */
      const container = await post(userId, 'threads', token, {
        media_type: media ? (isVideo ? 'VIDEO' : 'IMAGE') : 'TEXT',
        text: req.text,
        ...(media ? (isVideo ? { video_url: media } : { image_url: media }) : {}),
      });

      const published = await post(userId, 'threads_publish', token, { creation_id: container.id });

      return {
        platform: PLATFORM,
        externalId: published.id,
        via: name,
        publishedAt: new Date(),
      };
    },
  };
}
