import { PublishError, type PlatformAdapter, type PublishReceipt, type PublishRequest } from '../adapter.js';

/**
 * Native TikTok adapter — the Content Posting API's `PULL_FROM_URL` publish
 * flow. Like Instagram, TikTok fetches the media itself from the URL we
 * give it, so this adapter never downloads bytes.
 *
 * ── Scope: video only ───────────────────────────────────────────────────
 * TikTok's Content Posting API has a separate endpoint and payload shape for
 * photo-carousel posts (`/v2/post/publish/content/init/`, `media_type:
 * 'PHOTO'`). Every SparkSocial beat that can carry `tiktok` media is video
 * (`generated_video`/`generated_broll`/an uploaded asset), so only the video
 * flow is implemented — photo carousels are a documented gap, not a silent
 * one.
 *
 * ── Privacy level and the sandbox restriction ───────────────────────────
 * TikTok apps that haven't cleared audit are typically restricted to
 * `SELF_ONLY` posts regardless of what's requested (`creator_info/query`
 * reports which levels are actually available). This adapter always
 * requests `PUBLIC_TO_EVERYONE` and trusts the platform to downgrade or
 * reject during the sandbox period — querying creator info first is a real
 * gap, not implemented this pass, since it changes the shape of every call
 * for a case (an unaudited app) that already can't post publicly regardless.
 *
 * No live TikTok developer app in this environment to verify field names
 * against — built from TikTok's published Content Posting API docs at the
 * time of writing, same caveat as every other native adapter here.
 *
 * ── Delete ───────────────────────────────────────────────────────────────
 * No publicly documented delete endpoint. Omitted, same as Instagram —
 * `publish.rollback` already handles an adapter with no `delete` cleanly.
 */

export interface TikTokAdapterOptions {
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

const BASE_URL = 'https://open.tiktokapis.com';

interface TikTokInitResponse {
  data?: { publish_id?: string };
  error?: { code?: string; message?: string; log_id?: string };
}

export function createTikTokAdapter(opts: TikTokAdapterOptions = {}): PlatformAdapter {
  const doFetch = opts.fetchImpl ?? fetch;
  const name = 'native:tiktok';

  return {
    name,
    supports: (platform) => platform === 'tiktok',

    async publish(req: PublishRequest): Promise<PublishReceipt> {
      if (!req.accessToken) {
        throw new PublishError('tiktok', 'No connected TikTok account for this brand — connect one in Settings first.', false);
      }
      const videoUrl = req.mediaUrls[0];
      if (!videoUrl) {
        throw new PublishError('tiktok', 'TikTok requires a video — this post has no media.', false);
      }

      let response: Response;
      try {
        response = await doFetch(`${BASE_URL}/v2/post/publish/video/init/`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${req.accessToken}`,
            'content-type': 'application/json; charset=UTF-8',
          },
          body: JSON.stringify({
            post_info: {
              title: req.text,
              privacy_level: 'PUBLIC_TO_EVERYONE',
              disable_duet: false,
              disable_comment: false,
              disable_stitch: false,
            },
            source_info: {
              source: 'PULL_FROM_URL',
              video_url: videoUrl,
            },
          }),
        });
      } catch (e) {
        throw new PublishError('tiktok', e instanceof Error ? e.message : String(e), true);
      }

      const body = (await response.json().catch(() => ({}))) as TikTokInitResponse;
      const ok = response.ok && body.error?.code === 'ok';
      if (!ok || !body.data?.publish_id) {
        const retryable = response.status === 429 || response.status >= 500 || body.error?.code === 'rate_limit_exceeded';
        throw new PublishError('tiktok', body.error?.message ?? `TikTok publish failed (${response.status}).`, retryable);
      }

      return {
        platform: 'tiktok',
        // TikTok's `publish_id` identifies the *publish job*, not the final
        // video — the Content Posting API is async and reports completion
        // via a separate status-check endpoint this adapter does not poll
        // (not implemented this pass, same as the privacy-level query
        // above). Recorded as the externalId anyway since it is the only
        // id TikTok hands back synchronously, and `analytics.sync`-style
        // reconciliation would need it to look the post up later.
        externalId: body.data.publish_id,
        via: name,
        publishedAt: new Date(),
      };
    },
  };
}
