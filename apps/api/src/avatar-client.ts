import { ToolError } from '@sparksocial/shared';
import type { AvatarClient } from '@sparksocial/generate';
import { envSet, envStr } from './env.js';

/**
 * Production avatar rendering for `content.generate_avatar_video` — HeyGen's
 * **v3** API.
 *
 * ── Why v3, and why now ──────────────────────────────────────────────────
 *
 * HeyGen retires every v1 and v2 endpoint on **2026-10-31** (developer
 * changelog, April 2026 entry). This client used three of them:
 * `POST /v2/video/generate`, `GET /v1/video_status.get` and
 * `upload.heygen.com/v1/talking_photo` — so on 1 November both avatar video
 * and avatar-from-photo would have stopped outright. The v3 equivalents:
 *
 *   photo → asset      `POST /v3/assets` (multipart `file`) → `data.asset_id`
 *   asset → avatar     `POST /v3/avatars` `{type:'photo', name, file:{type:'asset_id', asset_id}}`
 *                      → `data.avatar_item.id`
 *   render             `POST /v3/videos` `{type:'avatar', avatar_id, script, aspect_ratio}`
 *                      → `data.video_id`
 *   poll               `GET /v3/videos/{id}` → `data.status` pending | processing |
 *                      completed | failed, `data.video_url`, `data.failure_message`
 *
 * Talking photos are no longer a separate character type in v3: a photo
 * avatar is an avatar, addressed by `avatar_id` like a trained one. So the
 * `avatarKind` a caller passes no longer changes the request. No `voice_id`
 * is sent, matching what v2 did: with an `avatar_id` set, v3 uses the
 * avatar's default voice.
 *
 * Unlike `image-client.ts`'s fal.ai call, the render is asynchronous: a
 * submit returns a `video_id` and the video finishes minutes later. This
 * client hides that behind the same synchronous-looking `generate()` every
 * other client has, by polling until the job completes or a timeout is hit.
 */

export interface AvatarClientOptions {
  apiKey: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const BASE_URL = 'https://api.heygen.com';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

/** v3 takes the ratio itself. The playbooks use these four; anything else renders vertical. */
const ASPECT_RATIOS = new Set(['16:9', '9:16', '4:5', '5:4', '1:1']);
function aspectFor(aspectRatio: string): string {
  return ASPECT_RATIOS.has(aspectRatio) ? aspectRatio : '9:16';
}

export function createAvatarClient(opts: AvatarClientOptions): AvatarClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function heygenFetch(path: string, init: RequestInit): Promise<unknown> {
    const response = await doFetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { ...init.headers, 'x-api-key': opts.apiKey, 'content-type': 'application/json' },
    });
    if (!response.ok) {
      // Read by cause, as the photo path is — a 402 is our credit, not a
      // broken post, and "HeyGen request failed (402)" said neither.
      throw heygenUploadError(response.status, await response.text().catch(() => ''), 'video');
    }
    return response.json();
  }

  return {
    async generate({ avatarId, script, aspectRatio }): Promise<{ url: string }> {
      const submitted = (await heygenFetch('/v3/videos', {
        method: 'POST',
        body: JSON.stringify({
          type: 'avatar',
          avatar_id: avatarId,
          script,
          aspect_ratio: aspectFor(aspectRatio),
        }),
      })) as { data?: { video_id?: string; id?: string } };

      // `data.video_id` per the API reference; the CLI docs read `data.id`.
      const videoId = submitted.data?.video_id ?? submitted.data?.id;
      if (!videoId) {
        throw new ToolError('UPSTREAM_FAILED', 'HeyGen accepted the request but returned no video id.', {});
      }

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const status = (await heygenFetch(`/v3/videos/${encodeURIComponent(videoId)}`, {
          method: 'GET',
        })) as { data?: { status?: string; video_url?: string | null; failure_code?: string; failure_message?: string } };

        if (status.data?.status === 'completed' && status.data.video_url) {
          return { url: status.data.video_url };
        }
        if (status.data?.status === 'failed') {
          throw new ToolError('UPSTREAM_FAILED', 'HeyGen reported the render failed.', {
            videoId,
            ...(status.data.failure_code ? { failureCode: status.data.failure_code } : {}),
            operator: `HeyGen render failed: ${status.data.failure_message ?? 'no reason given'}`,
          });
        }
        await sleep(pollIntervalMs);
      }

      throw new ToolError('UPSTREAM_FAILED', `HeyGen render did not complete within ${timeoutMs}ms.`, { videoId });
    },

    /**
     * Photo → a reusable avatar id: upload the image as an asset, then create a
     * photo avatar from it. The id is what `generate()` takes as `avatarId`.
     *
     * Two calls where v1 had one, and the upload is multipart rather than a raw
     * body — so neither uses `heygenFetch`, which sends JSON. Both go through
     * `heygenUploadError`, so a billing refusal is still never reported to the
     * customer as a problem with their face.
     *
     * HeyGen requires one clearly visible face; it rejects anything else, and
     * that rejection is the only place it gets checked.
     */
    async fromImage({ imageUrl, contentType }): Promise<{ talkingPhotoId: string }> {
      const source = await doFetch(imageUrl);
      if (!source.ok) {
        throw new ToolError('UPSTREAM_FAILED', 'Could not read the uploaded photo.', {
          status: source.status,
          operator: `GET on the image URL returned ${source.status}; a presigned read URL may have expired.`,
        });
      }
      const bytes = new Uint8Array(await source.arrayBuffer());
      if (bytes.length === 0) {
        throw new ToolError('UPSTREAM_FAILED', 'The uploaded photo was empty.', {});
      }

      const form = new FormData();
      const ext = contentType.includes('png') ? 'png' : 'jpg';
      form.append('file', new Blob([bytes], { type: contentType }), `avatar.${ext}`);
      const uploaded = await doFetch(`${BASE_URL}/v3/assets`, {
        method: 'POST',
        headers: { 'x-api-key': opts.apiKey },
        body: form,
      });
      if (!uploaded.ok) {
        throw heygenUploadError(uploaded.status, await uploaded.text().catch(() => ''));
      }
      const assetId = ((await uploaded.json()) as { data?: { asset_id?: unknown } }).data?.asset_id;
      if (typeof assetId !== 'string' || assetId.length === 0) {
        throw new ToolError('UPSTREAM_FAILED', 'HeyGen accepted the photo but returned no asset id.', {});
      }

      const created = await doFetch(`${BASE_URL}/v3/avatars`, {
        method: 'POST',
        headers: { 'x-api-key': opts.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'photo', name: 'SparkSocial agent', file: { type: 'asset_id', asset_id: assetId } }),
      });
      if (!created.ok) {
        throw heygenUploadError(created.status, await created.text().catch(() => ''));
      }
      const body = (await created.json()) as { data?: { avatar_item?: { id?: unknown }; id?: unknown } };
      const id = body.data?.avatar_item?.id ?? body.data?.id;
      if (typeof id !== 'string' || id.length === 0) {
        throw new ToolError(
          'UPSTREAM_FAILED',
          'HeyGen accepted the photo but returned no avatar id. This usually means no single clear face was found.',
          {},
        );
      }
      return { talkingPhotoId: id };
    },
  };
}

/**
 * What a failed photo-avatar upload actually means.
 *
 * ── Why this is not one message ──────────────────────────────────────────
 *
 * It used to be: `HeyGen rejected the photo (400)`, for every 400. Measured
 * against the live account, the 400 that onboarding was hitting was
 *
 *     {"code": 400133, "message": "Insufficient credit.
 *      This operation requires 'api' credits."}
 *
 * — a billing state on our side, reported to the customer as a verdict on the
 * photo they had just chosen. They can crop, relight and re-upload that photo
 * all afternoon without moving. Telling somebody their face is the problem
 * when the problem is our invoice is the worst version of a vague error: it is
 * specific, confident and wrong.
 *
 * The body carries the distinction, and we were reading it only to truncate it
 * into `meta.detail`, which `app.ts` never serialises. So nothing reached
 * either the customer or the operator.
 *
 * `meta.operator` carries the vendor's own words for the log; the message does
 * not, because a customer should not be shown an account error they cannot
 * act on. Same split as `STORAGE_UNAVAILABLE` in `packages/storage/src/r2.ts`.
 */
export function heygenUploadError(status: number, body: string, kind: 'photo' | 'video' = 'photo'): ToolError {
  let vendorMessage = '';
  let vendorCode: unknown;
  try {
    /*
     * v3 nests its error — `{"error": {"code": "insufficient_credit",
     * "message": …}}` (seen live, 29 Oct) — where v1 put `code` and `message`
     * at the top. Both are read, so the billing case below keeps matching.
     */
    const parsed = JSON.parse(body) as { code?: unknown; message?: unknown; error?: { code?: unknown; message?: unknown } };
    const err = parsed.error && typeof parsed.error === 'object' ? parsed.error : parsed;
    vendorCode = err.code;
    vendorMessage = typeof err.message === 'string' ? err.message : '';
  } catch {
    // Not JSON. The text still goes to the operator field below.
  }

  const meta = {
    status,
    ...(vendorCode !== undefined ? { vendorCode } : {}),
    operator: `HeyGen ${kind === 'photo' ? 'photo avatar' : 'video'} returned ${status}: ${(vendorMessage || body).slice(0, 200)}`,
  };

  /*
   * Billing, not the photo. Matched on the vendor's text as well as its code
   * because the code is undocumented and a numeric match alone would silently
   * stop working if they renumber it — whereas the two together degrade to
   * "one of them still caught it".
   */
  if (
    status === 402 ||
    vendorCode === 400133 ||
    vendorCode === 'insufficient_credit' ||
    /insufficient credit|quota|not enough credit/i.test(vendorMessage)
  ) {
    return new ToolError(
      'UPSTREAM_FAILED',
      kind === 'photo'
        ? 'Avatar generation is temporarily unavailable on this workspace. Nothing is wrong with your photo — ' +
            'try again later, or continue and set an avatar afterwards.'
        : 'Avatar video is temporarily unavailable on this workspace. Nothing is wrong with your post — try again later.',
      meta,
    );
  }

  if (status === 401 || status === 403) {
    return new ToolError(
      'UPSTREAM_FAILED',
      'Avatar generation is not configured for this workspace.',
      meta,
    );
  }

  if (status === 429) {
    return new ToolError('RATE_LIMITED', 'The avatar service is busy. Try again in a moment.', meta);
  }

  if (status >= 500) {
    return new ToolError('UPSTREAM_FAILED', 'The avatar service is having trouble. Try again shortly.', meta);
  }

  /*
   * Only here is the photo actually implicated — and this is the one case
   * where naming HeyGen's requirement is useful, because it is the thing the
   * person can do something about.
   */
  if (kind === 'video') {
    return new ToolError('UPSTREAM_FAILED', 'HeyGen could not render this avatar video.', meta);
  }
  return new ToolError(
    'UPSTREAM_FAILED',
    'That photo could not be used. It needs one clearly visible face, larger than 200x200 pixels, ' +
      'facing the camera.',
    meta,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The real client when `HEYGEN_API_KEY` is configured, `undefined` otherwise
 * — same "unset → not registered" rule `image-client.ts` follows, for the
 * same reason: there is no honest stand-in for a specific person's face.
 */
let memo: AvatarClient | undefined | null = null;

export function avatarClient(): AvatarClient | undefined {
  if (memo === null) memo = buildAvatarClient();
  return memo;
}

function buildAvatarClient(): AvatarClient | undefined {
  if (!envSet('HEYGEN_API_KEY')) {
    console.warn('[warn] HEYGEN_API_KEY unset — content.generate_avatar_video is not registered.');
    return undefined;
  }
  return createAvatarClient({ apiKey: envStr('HEYGEN_API_KEY', '') });
}
