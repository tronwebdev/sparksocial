import { ToolError } from '@sparksocial/shared';
import type { VideoClient } from '@sparksocial/generate';
import { envNum, envSet, envStr } from './env.js';
import { parseExtra } from './image-client.js';

/**
 * Anything else this model wants, as JSON — the same escape hatch
 * `image-client.ts` documents, and needed here first.
 *
 * Two real cases, both from one model:
 *
 * `generate_audio` defaults to **true** on Seedance: clips arrive carrying their
 * own ambient sound and lip-synced speech. Backdrops are muted by the composer,
 * but a `generated_broll` beat is played unmuted, so a narrated post would have
 * the model's invented speech talking over the ElevenLabs track.
 *
 * `codec` defaults to `auto`, which on Seedance means **HEVC Main 10, 10-bit**
 * (`hvc1`, `yuv420p10le`). Headless Chrome cannot decode it, so every clip
 * reached the renderer and died as `Code 4 -` with an empty message — a
 * perfectly good, paid-for file that no part of the pipeline could read. Asking
 * for `H264` costs nothing and is what the composer can actually play.
 *
 * Configuration rather than a code branch, because the next model will spell
 * these differently or not have them at all — the same reasoning
 * `FAL_VIDEO_DURATIONS` is written against.
 */
const EXTRA = parseExtra('FAL_VIDEO_EXTRA_PARAMS');

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
/**
 * How long a clip may take to come back.
 *
 * Two minutes was sized against `ltx-video`, which is the fastest and least
 * faithful thing fal hosts. Every model worth switching to — Kling, Veo,
 * Seedance — routinely takes three to six minutes for a few seconds of footage,
 * so this ceiling silently made them unusable: the job would still be running
 * and this would give up and report `did not complete within 120s`, which reads
 * as a vendor failure rather than as our own stopwatch.
 *
 * It already bit at the old value on a model it was sized for — one scene of a
 * three-scene post came back empty that way, after the other two had been paid
 * for.
 *
 * Ten minutes, and tunable, because the right number is a property of the model
 * somebody chose rather than of this code.
 */
const MAX_POLL_ATTEMPTS = envNum('FAL_VIDEO_POLL_ATTEMPTS', 300); // 300 × 2s = 10 minutes

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
          duration: snapDuration(durationSec),
          ...EXTRA,
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
            /*
             * The body is the whole message here.
             *
             * fal accepts a submission, validates it lazily, and then reports
             * the rejection through *this* endpoint — as a 422 on a job whose
             * status says COMPLETED. Reporting only the code turned
             * `Input should be '5' or '10'` into "result fetch failed (422)",
             * which reads as a transport problem and cost an afternoon of
             * looking at the wrong thing.
             */
            const detail = await resultResponse.text().catch(() => '');
            throw new ToolError(
              'UPSTREAM_FAILED',
              `Video generation was rejected by the model (${resultResponse.status}): ${detail.slice(0, 300)}`,
              { status: resultResponse.status, model },
            );
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

/**
 * The clip lengths this model will accept, if it only accepts some.
 *
 * Empty — the default — sends whatever the beat asked for, which is what
 * `ltx-video` wants and what this client was written against. Kling takes a
 * literal `'5'` or `'10'` and nothing else, so a three-second hook was rejected
 * with `Input should be '5' or '10'` on every single clip: the model was
 * configured, the key worked, the job was accepted, and not one frame came back.
 *
 * Declared rather than inferred from the model name. A table of model names in
 * here would be a second, private copy of fal's catalogue that goes stale the
 * moment they ship a version — and this module's whole posture is that changing
 * models is configuration, not a code change. The rejection names the allowed
 * set, so an operator who hits it is told exactly what to put here.
 */
const ALLOWED_DURATIONS = envStr('FAL_VIDEO_DURATIONS', '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

/**
 * The nearest length the model will take, rounding down where it can.
 *
 * Down rather than nearest: a clip shorter than its scene is covered by the
 * next one in the split, where a clip longer than the whole post's remaining
 * time is footage nobody sees and money already spent. The shortest allowed
 * value is the floor, since asking for less than the model's minimum is the
 * rejection this exists to avoid.
 */
function snapDuration(seconds: number): number {
  if (ALLOWED_DURATIONS.length === 0) return seconds;
  const notLonger = ALLOWED_DURATIONS.filter((d) => d <= seconds);
  return notLonger.length > 0 ? Math.max(...notLonger) : Math.min(...ALLOWED_DURATIONS);
}
