import { ToolError } from '@sparksocial/shared';
import type { VideoClient } from '@sparksocial/generate';
import { envSet, envStr } from './env.js';

/**
 * Production b-roll generation for `content.generate_broll` — fal.ai's QUEUE
 * REST API (`POST https://queue.fal.run/{model}`), not the synchronous
 * `fal.run` endpoint `image-client.ts` uses: video inference runs well past
 * a normal request timeout, so fal queues it and hands back a status/response
 * URL pair to poll — this client is the poll loop.
 *
 * Same "one HTTP call, no vendor SDK" posture `image-client.ts`/`dub.ts`
 * take, extended with polling because this vendor's video path is
 * genuinely async, not a design choice made here.
 */

export interface VideoClientOptions {
  apiKey: string;
  model?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MODEL = 'fal-ai/ltx-video';
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 60; // ~2 minutes — video inference is slow but a call should still fail rather than hang the request indefinitely.

export function createVideoClient(opts: VideoClientOptions): VideoClient {
  const model = opts.model ?? DEFAULT_MODEL;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  return {
    async generate({ prompt, aspectRatio, durationSec }): Promise<{ url: string }> {
      const submitResponse = await doFetch(`https://queue.fal.run/${model}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Key ${opts.apiKey}` },
        body: JSON.stringify({
          prompt,
          aspect_ratio: falAspectRatio(aspectRatio),
          duration: durationSec,
        }),
      });

      if (!submitResponse.ok) {
        const detail = await submitResponse.text().catch(() => '');
        throw new ToolError('UPSTREAM_FAILED', `Video generation request failed (${submitResponse.status}).`, {
          status: submitResponse.status,
          detail: detail.slice(0, 200),
        });
      }

      const submitted = (await submitResponse.json()) as { status_url?: string; response_url?: string };
      if (!submitted.status_url || !submitted.response_url) {
        throw new ToolError('UPSTREAM_FAILED', 'Video generation queue accepted the request but returned no status/response URL.', { model });
      }

      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        const statusResponse = await doFetch(submitted.status_url, { headers: { authorization: `Key ${opts.apiKey}` } });
        if (!statusResponse.ok) {
          throw new ToolError('UPSTREAM_FAILED', `Video generation status check failed (${statusResponse.status}).`, { status: statusResponse.status });
        }
        const status = (await statusResponse.json()) as { status?: string };

        if (status.status === 'COMPLETED') {
          const resultResponse = await doFetch(submitted.response_url, { headers: { authorization: `Key ${opts.apiKey}` } });
          if (!resultResponse.ok) {
            throw new ToolError('UPSTREAM_FAILED', `Video generation result fetch failed (${resultResponse.status}).`, { status: resultResponse.status });
          }
          const body = (await resultResponse.json()) as { video?: { url?: string } };
          const url = body.video?.url;
          if (typeof url !== 'string' || !url) {
            throw new ToolError('UPSTREAM_FAILED', 'Video generation completed but the response had no video.', { model });
          }
          return { url };
        }
        if (status.status === 'ERROR') {
          throw new ToolError('UPSTREAM_FAILED', 'Video generation job failed on the vendor side.', { model });
        }
        await sleep(POLL_INTERVAL_MS);
      }

      throw new ToolError('UPSTREAM_FAILED', `Video generation did not complete within ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s.`, { model });
    },
  };
}

/** Covers the aspect ratios the playbook library actually declares, same lookup shape `image-client.ts`'s `falImageSize` uses. */
function falAspectRatio(aspectRatio: string): string {
  switch (aspectRatio) {
    case '9:16':
      return '9:16';
    case '16:9':
      return '16:9';
    case '1:1':
      return '1:1';
    default:
      return '9:16';
  }
}

/**
 * The real client when `FAL_API_KEY` is configured, `undefined` otherwise —
 * same "unset → not registered" rule `imageClient()` sets, sharing the same
 * key (one fal.ai account) with its own optional model override.
 */
let memo: VideoClient | undefined | null = null;

export function videoClient(): VideoClient | undefined {
  if (memo === null) memo = buildVideoClient();
  return memo;
}

function buildVideoClient(): VideoClient | undefined {
  if (!envSet('FAL_API_KEY')) {
    console.warn('[warn] FAL_API_KEY unset — content.generate_broll is not registered.');
    return undefined;
  }
  return createVideoClient({
    apiKey: envStr('FAL_API_KEY', ''),
    ...(envSet('FAL_VIDEO_MODEL') ? { model: envStr('FAL_VIDEO_MODEL', '') } : {}),
  });
}
