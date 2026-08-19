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
    async generate({ avatarId, script, aspectRatio }): Promise<{ url: string }> {
      const submitted = (await heygenFetch('/v2/video/generate', {
        method: 'POST',
        body: JSON.stringify({
          video_inputs: [
            {
              character: { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' },
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
  };
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
