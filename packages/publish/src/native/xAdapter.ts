import { PublishError, type PlatformAdapter, type PublishReceipt, type PublishRequest } from '../adapter.js';

/**
 * Native X adapter — v2 `/2/tweets` for the post itself, v1.1
 * `/1.1/media/upload.json`'s chunked INIT/APPEND/FINALIZE flow for media
 * (X's v2 API still has no direct media-attachment path; a v1.1 media id is
 * required either way, per the plan's own §8 note that X's real cost is the
 * per-post fee, not the approval).
 *
 * ── Auth assumption, flagged ─────────────────────────────────────────────
 * X's v1.1 endpoints were historically OAuth 1.0a-only; more recent docs
 * accept an OAuth 2.0 user-context Bearer token on the same endpoints. This
 * adapter uses Bearer auth throughout, matching the OAuth 2.0 + PKCE
 * connect flow this codebase's `integration.connect` uses for every native
 * platform — the one assumption most likely to need revisiting against a
 * live account, called out explicitly rather than silently picked.
 *
 * ── Chunked upload, single segment ──────────────────────────────────────
 * INIT/APPEND/FINALIZE is X's documented flow for both images and video;
 * used unconditionally here rather than branching on a separate "simple
 * upload" path for small images. APPEND sends the whole file as one
 * segment rather than looping in chunks — correct for the short-form
 * content this product generates, a real simplification for anything
 * large enough to need true multi-chunk upload. FINALIZE's response can
 * carry `processing_info` for video needing an async STATUS poll before
 * the media is attachable; not implemented here (documented gap, same
 * class as TikTok's un-polled `publish_id`) — attaching immediately after
 * FINALIZE is correct for images and works in practice for short video in
 * most cases, but is not the fully-robust path.
 *
 * No live X developer app in this environment to verify any of this
 * against — built from X's published API docs at the time of writing.
 */

export interface XAdapterOptions {
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

const UPLOAD_BASE = 'https://upload.twitter.com/1.1/media/upload.json';
const POST_URL = 'https://api.x.com/2/tweets';

function classify(status: number, message: string): PublishError {
  return new PublishError('x', message, status === 429 || status >= 500);
}

export function createXAdapter(opts: XAdapterOptions = {}): PlatformAdapter {
  const doFetch = opts.fetchImpl ?? fetch;
  const name = 'native:x';

  async function uploadMedia(sourceUrl: string, accessToken: string): Promise<string> {
    let sourceRes: Response;
    try {
      sourceRes = await doFetch(sourceUrl);
    } catch (e) {
      throw new PublishError('x', `Could not fetch media to upload: ${e instanceof Error ? e.message : String(e)}`, true);
    }
    if (!sourceRes.ok) throw new PublishError('x', `Could not fetch media to upload (${sourceRes.status}).`, false);
    const bytes = await sourceRes.arrayBuffer();
    const isVideo = /\.(mp4|mov)(\?|$)/i.test(sourceUrl);
    const mediaType = isVideo ? 'video/mp4' : 'image/png';
    const mediaCategory = isVideo ? 'tweet_video' : 'tweet_image';
    const bearer = { Authorization: `Bearer ${accessToken}` };

    const initRes = await doFetch(UPLOAD_BASE, {
      method: 'POST',
      headers: { ...bearer, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        command: 'INIT',
        total_bytes: String(bytes.byteLength),
        media_type: mediaType,
        media_category: mediaCategory,
      }).toString(),
    }).catch((e: unknown) => {
      throw new PublishError('x', e instanceof Error ? e.message : String(e), true);
    });
    if (!initRes.ok) {
      const detail = await initRes.text().catch(() => '');
      throw classify(initRes.status, `X media INIT failed (${initRes.status}): ${detail.slice(0, 200)}`);
    }
    const { media_id_string: mediaId } = (await initRes.json()) as { media_id_string?: string };
    if (!mediaId) throw new PublishError('x', 'X media INIT returned no media_id_string.', false);

    const form = new FormData();
    form.set('command', 'APPEND');
    form.set('media_id', mediaId);
    form.set('segment_index', '0');
    form.set('media', new Blob([bytes]));
    const appendRes = await doFetch(UPLOAD_BASE, { method: 'POST', headers: bearer, body: form }).catch((e: unknown) => {
      throw new PublishError('x', e instanceof Error ? e.message : String(e), true);
    });
    if (!appendRes.ok) {
      const detail = await appendRes.text().catch(() => '');
      throw classify(appendRes.status, `X media APPEND failed (${appendRes.status}): ${detail.slice(0, 200)}`);
    }

    const finalizeRes = await doFetch(UPLOAD_BASE, {
      method: 'POST',
      headers: { ...bearer, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ command: 'FINALIZE', media_id: mediaId }).toString(),
    }).catch((e: unknown) => {
      throw new PublishError('x', e instanceof Error ? e.message : String(e), true);
    });
    if (!finalizeRes.ok) {
      const detail = await finalizeRes.text().catch(() => '');
      throw classify(finalizeRes.status, `X media FINALIZE failed (${finalizeRes.status}): ${detail.slice(0, 200)}`);
    }

    return mediaId;
  }

  return {
    name,
    supports: (platform) => platform === 'x',

    async publish(req: PublishRequest): Promise<PublishReceipt> {
      if (!req.accessToken) {
        throw new PublishError('x', 'No connected X account for this brand — connect one in Settings first.', false);
      }

      const mediaId = req.mediaUrls[0] ? await uploadMedia(req.mediaUrls[0], req.accessToken) : undefined;

      let response: Response;
      try {
        response = await doFetch(POST_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${req.accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            text: req.text,
            ...(mediaId ? { media: { media_ids: [mediaId] } } : {}),
          }),
        });
      } catch (e) {
        throw new PublishError('x', e instanceof Error ? e.message : String(e), true);
      }

      const body = (await response.json().catch(() => ({}))) as { data?: { id?: string }; detail?: string; title?: string };
      if (!response.ok || !body.data?.id) {
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
        const retryable = response.status === 429 || response.status >= 500;
        throw new PublishError(
          'x',
          body.detail ?? body.title ?? `X post failed (${response.status}).`,
          retryable,
          Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
        );
      }

      return { platform: 'x', externalId: body.data.id, url: `https://x.com/i/web/status/${body.data.id}`, via: name, publishedAt: new Date() };
    },

    async delete(externalId: string, _platform, accessToken?: string): Promise<void> {
      if (!accessToken) throw new PublishError('x', 'No X access token available to authorize the delete.', false);
      let response: Response;
      try {
        response = await doFetch(`${POST_URL}/${encodeURIComponent(externalId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch (e) {
        throw new PublishError('x', e instanceof Error ? e.message : String(e), true);
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw classify(response.status, `X delete failed (${response.status}): ${detail.slice(0, 200)}`);
      }
    },
  };
}
