import { ToolError } from '@sparksocial/shared';
import type { AvatarClient } from '@sparksocial/generate';
import { envSet, envStr } from './env.js';

/**
 * Production avatar rendering for `content.generate_avatar_video` — HeyGen's
 * v2 video-generation API.
 *
 * Unlike `image-client.ts`'s fal.ai call, HeyGen's API is asynchronous: a
 * submit returns a `video_id` immediately and the render finishes minutes
 * later. This client hides that behind the same synchronous-looking
 * `generate()` shape every other client in this codebase has, by polling
 * until the job completes or a timeout is hit — the tool layer above it
 * should not need to know rendering is a job queue rather than a request.
 */

export interface AvatarClientOptions {
  apiKey: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const BASE_URL = 'https://api.heygen.com';
/** Uploads go to a different host from the rest of the API. */
const UPLOAD_BASE_URL = 'https://upload.heygen.com';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

/** The playbook library's video aspect ratios, mapped to a render resolution. */
function dimensionFor(aspectRatio: string): { width: number; height: number } {
  switch (aspectRatio) {
    case '9:16':
      return { width: 720, height: 1280 };
    case '1:1':
      return { width: 1080, height: 1080 };
    case '16:9':
      return { width: 1280, height: 720 };
    default:
      return { width: 720, height: 1280 };
  }
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
      const detail = await response.text().catch(() => '');
      throw new ToolError('UPSTREAM_FAILED', `HeyGen request failed (${response.status}).`, {
        status: response.status,
        detail: detail.slice(0, 200),
      });
    }
    return response.json();
  }

  return {
    async generate({ avatarId, script, aspectRatio, avatarKind = 'avatar' }): Promise<{ url: string }> {
      const submitted = (await heygenFetch('/v2/video/generate', {
        method: 'POST',
        body: JSON.stringify({
          video_inputs: [
            {
              /*
               * Two shapes, not one with a different id.
               *
               * A trained avatar and a photo-derived one are different
               * character types in HeyGen's API, with different id fields.
               * This used to be hardcoded to `avatar`, which was correct while
               * ids only ever came from `genome.avatar_config.set` — a human
               * pasting one from the vendor dashboard. `genome.avatar.from_image`
               * mints `talking_photo_id`s, and putting one in `avatar_id`
               * fails at render, minutes in, not at submit.
               */
              character:
                avatarKind === 'talking_photo'
                  ? { type: 'talking_photo', talking_photo_id: avatarId }
                  : { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' },
              voice: { type: 'text', input_text: script },
            },
          ],
          dimension: dimensionFor(aspectRatio),
        }),
      })) as { data?: { video_id?: string } };

      const videoId = submitted.data?.video_id;
      if (!videoId) {
        throw new ToolError('UPSTREAM_FAILED', 'HeyGen accepted the request but returned no video_id.', {});
      }

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const status = (await heygenFetch(`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
          method: 'GET',
        })) as { data?: { status?: string; video_url?: string; error?: unknown } };

        if (status.data?.status === 'completed' && status.data.video_url) {
          return { url: status.data.video_url };
        }
        if (status.data?.status === 'failed') {
          throw new ToolError('UPSTREAM_FAILED', 'HeyGen reported the render failed.', {
            videoId,
            error: status.data.error,
          });
        }
        await sleep(pollIntervalMs);
      }

      throw new ToolError('UPSTREAM_FAILED', `HeyGen render did not complete within ${timeoutMs}ms.`, { videoId });
    },

    /**
     * Photo → `talking_photo_id`, via `upload.heygen.com/v1/talking_photo`.
     *
     * A different host from every other call in this file, and a raw binary
     * body rather than JSON — `heygenFetch` sets `content-type: application/json`
     * on everything, so this deliberately does not use it.
     *
     * HeyGen requires exactly one clearly visible face occupying more than
     * 200x200 pixels. It rejects anything else, and the rejection is the only
     * place that gets checked: there is no point pre-validating here with a
     * face detector we do not have.
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

      const response = await doFetch(`${UPLOAD_BASE_URL}/v1/talking_photo`, {
        method: 'POST',
        headers: { 'x-api-key': opts.apiKey, 'content-type': contentType },
        body: bytes,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw heygenUploadError(response.status, detail);
      }

      const body = (await response.json()) as { data?: { talking_photo_id?: unknown } };
      const id = body.data?.talking_photo_id;
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
 * What a failed `talking_photo` upload actually means.
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
export function heygenUploadError(status: number, body: string): ToolError {
  let vendorMessage = '';
  let vendorCode: unknown;
  try {
    const parsed = JSON.parse(body) as { code?: unknown; message?: unknown };
    vendorCode = parsed.code;
    vendorMessage = typeof parsed.message === 'string' ? parsed.message : '';
  } catch {
    // Not JSON. The text still goes to the operator field below.
  }

  const meta = {
    status,
    ...(vendorCode !== undefined ? { vendorCode } : {}),
    operator: `HeyGen talking_photo returned ${status}: ${(vendorMessage || body).slice(0, 200)}`,
  };

  /*
   * Billing, not the photo. Matched on the vendor's text as well as its code
   * because the code is undocumented and a numeric match alone would silently
   * stop working if they renumber it — whereas the two together degrade to
   * "one of them still caught it".
   */
  if (vendorCode === 400133 || /insufficient credit|quota|not enough credit/i.test(vendorMessage)) {
    return new ToolError(
      'UPSTREAM_FAILED',
      'Avatar generation is temporarily unavailable on this workspace. Nothing is wrong with your photo — ' +
        'try again later, or continue and set an avatar afterwards.',
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
