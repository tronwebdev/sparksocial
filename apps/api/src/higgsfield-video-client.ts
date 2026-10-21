import { ToolError } from '@sparksocial/shared';
import type { VideoClient } from '@sparksocial/generate';
import { envNum, envSet, envStr } from './env.js';
import { parseExtra } from './image-client.js';
import { videoUnavailable } from './video-errors.js';

/**
 * Higgsfield as the backup for `content.generate_broll` — fal is the primary.
 *
 * ── Why a second video vendor at all ─────────────────────────────────────
 *
 * The same reason `image-client.ts` grew an OpenAI backup: an exhausted fal
 * balance should not be the end of the story. It matters more here than it did
 * for images, because a clip is the expensive, slow part of a post — a video
 * post that loses its footage loses the post, where a missing image leaves copy
 * somebody can still publish with an upload.
 *
 * ── What is the same as fal, and what is not ─────────────────────────────
 *
 * The lifecycle is almost the same shape, which is why this reads like
 * `video-client.ts`: submit, get a handle, poll, download. Four differences
 * that are not cosmetic:
 *
 *   * **Two-part credentials.** `Authorization: Key <id>:<secret>`, not a
 *     single bearer-ish key. Both halves are required and neither is useful
 *     alone, which is why `higgsfieldVideoClient()` treats one-without-the-
 *     other as unconfigured rather than guessing.
 *   * **The status response carries the output.** fal hands back a `status_url`
 *     *and* a `response_url`, and you fetch the second once the first says
 *     COMPLETED; Higgsfield's status body *is* the completed body — `video.url`
 *     is right there. One fewer round trip, and one fewer place for the
 *     "COMPLETED job, 422 result" trap `video-client.ts` documents.
 *   * **Four terminal states, not two.** `completed`, `failed`, `nsfw`,
 *     `canceled`. `nsfw` is worth distinguishing: it is a moderation refusal of
 *     *this prompt*, so it is the one terminal state where trying again
 *     elsewhere is pointless — and the only one here that is not billed.
 *   * **Backoff, not a fixed interval.** The vendor asks for 2s growing to 10s
 *     with jitter. fal is polled at a flat 2s; this follows the published
 *     guidance rather than copying ours, because being a polite client of a
 *     backup provider is how it stays available for the day it is needed.
 *
 * ── Audio, which has already cost this project once ──────────────────────
 *
 * `video-client.ts` records a paid-for, unusable render: Seedance defaults to
 * generating its own ambient sound and speech, which then talks over the
 * ElevenLabs narration. It is the *same model* here, with the same
 * `generate_audio: true` default, so the trap is identical and already sprung.
 *
 * One thing fal's config has that this cannot copy: `codec: H264`. fal's
 * Seedance returns HEVC Main 10 under `codec: auto`, which headless Chrome
 * cannot decode — every clip reached the renderer and died as `Code 4 -` with
 * an empty message. Higgsfield's schema has no `codec` field at all, so what it
 * returns is unknown and cannot be asked for. That is the first thing to check
 * on the first real clip: play it in the composer, not just download it.
 *
 * It is not fixed in code, for the reason the fal client gives: the next model
 * spells it differently or does not have it, and a table of model quirks in
 * here is a private copy of a vendor catalogue that goes stale. It is fixed in
 * configuration, and `infra/azure/secrets.manifest` carries the recommended
 * value beside the key, so an operator setting this up reads it before the
 * first clip rather than after.
 */

export interface HiggsfieldVideoClientOptions {
  keyId: string;
  keySecret: string;
  model?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Injected in tests, so the poll jitter does not make assertions flaky. */
  random?: () => number;
}

/**
 * The same model the primary runs: `bytedance/seedance-2.5/text-to-video`.
 *
 * This started as Kling 3.0 Standard, on the reasoning that it takes an aspect
 * ratio and a flexible duration. Checking the catalogue against our own
 * deployment made that look like the wrong question. `FAL_VIDEO_MODEL` is set
 * to `bytedance/seedance-2.5/text-to-video`, and Higgsfield hosts the same
 * model under the same id, with the same parameter names — `duration` 4-30,
 * `resolution`, `aspect_ratio`, `generate_audio`.
 *
 * Matching matters more than any feature comparison, because of *when* a
 * fallback fires. A post is several beats, each its own clip; fal can fail on
 * beat three and succeed on beats one, two and four. Footage from a different
 * model in the middle of one video is not a degraded result, it is a visible
 * seam — a different grade, a different motion character, in a nine-second
 * post. Same model, no seam.
 *
 * ── What it costs ────────────────────────────────────────────────────────
 *
 * It is also the dearest thing on the price list: **$0.207/s** at list,
 * $0.145/s at maximum discount, against $0.084/s for Kling 3.0 and $0.05/s for
 * Wan 3.0 (vendor's own pricing page, read 21 Oct 2026). A five-second clip is
 * about **$1.04**, where `content.generate_broll` declares `estimateCents: 40`.
 *
 * That gap is recorded in `docs/GAPS.md` rather than papered over here: the
 * estimate is the tool's, it is already approximate for fal, and the honest fix
 * is Higgsfield's own `POST /estimate/{endpointId}`, which returns
 * `{ credits, usd }` for the exact parameters before anything is charged.
 *
 * `HIGGSFIELD_VIDEO_MODEL=kling-video/v3.0/std/text-to-video` is the lever for
 * anyone who would rather have the cheaper seam. The override is an endpoint id
 * exactly as Higgsfield's model pages print it, because this module's posture is
 * the fal client's: changing models is configuration, not a code change.
 */
const DEFAULT_MODEL = 'bytedance/seedance-2.5/text-to-video';

/**
 * What the default model accepts, so the default configuration works.
 *
 * Seedance's floor is 4 seconds and `ContentGenerateBrollInput` allows 1, so an
 * unsnapped 3-second hook is a 422 — the exact rejection `FAL_VIDEO_DURATIONS`
 * was added to prevent, which is why the deployed fal config carries `4,5,…,30`
 * by hand.
 *
 * Only applied when no model override is set. A table of per-model ranges in
 * here is the stale vendor catalogue the fal client argues against; the range of
 * the one model this file chooses is not that table, it is part of choosing it.
 */
const DEFAULT_DURATIONS = Array.from({ length: 27 }, (_, i) => i + 4); // 4…30

const BASE_URL = 'https://api.higgsfield.ai';

/** The vendor's own recommendation: start at two seconds, grow towards ten. */
const POLL_START_MS = 2_000;
const POLL_MAX_MS = 10_000;
const POLL_GROWTH = 1.5;
const POLL_JITTER_MS = 500;

/**
 * How long a clip may take before this gives up.
 *
 * Expressed in attempts for symmetry with `FAL_VIDEO_POLL_ATTEMPTS`, but they
 * are not comparable numbers: fal's 300 attempts at a flat 2s is ten minutes,
 * where these attempts stretch towards 10s each. 90 lands a little over twelve
 * minutes, the same ceiling in spirit — long enough for the slow, faithful
 * models and short enough that a stuck job is eventually reported as one.
 * `video-client.ts` records what a too-tight ceiling cost: a job still running,
 * reported as a vendor failure, after its siblings had been paid for.
 */
const MAX_POLL_ATTEMPTS = envNum('HIGGSFIELD_VIDEO_POLL_ATTEMPTS', 90);

/** The same escape hatch `FAL_VIDEO_EXTRA_PARAMS` is — see the header on audio. */
const EXTRA = parseExtra('HIGGSFIELD_VIDEO_EXTRA_PARAMS');

/**
 * The clip lengths this model will accept, if it only accepts some.
 *
 * Defaults to the default model's own range. Setting `HIGGSFIELD_VIDEO_MODEL`
 * without setting this drops back to sending whatever was asked for, because at
 * that point the range belongs to a model this file knows nothing about —
 * Hailuo takes 6 or 10 and nothing else, and guessing on its behalf would be the
 * stale catalogue again.
 */
const CONFIGURED_DURATIONS = envStr('HIGGSFIELD_VIDEO_DURATIONS', '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

const ALLOWED_DURATIONS =
  CONFIGURED_DURATIONS.length > 0
    ? CONFIGURED_DURATIONS
    : envSet('HIGGSFIELD_VIDEO_MODEL')
      ? [] // somebody else's model, somebody else's range
      : DEFAULT_DURATIONS;

export function createHiggsfieldVideoClient(opts: HiggsfieldVideoClientOptions): VideoClient {
  const model = opts.model ?? DEFAULT_MODEL;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  const auth = `Key ${opts.keyId}:${opts.keySecret}`;

  return {
    async generate({ prompt, aspectRatio, durationSec }): Promise<{ url: string }> {
      const submitResponse = await doFetch(`${BASE_URL}/${model}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: auth,
          /*
           * Sent because the vendor asks for it on every generation, and
           * because it is the difference between a retried submission and a
           * second paid-for clip. It buys nothing *inside* one call — nothing
           * here retries the submit — so its value is for the day something
           * does, or for a proxy that retries beneath us.
           */
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          prompt,
          aspect_ratio: higgsfieldAspectRatio(aspectRatio),
          duration: snapDuration(durationSec),
          ...EXTRA,
        }),
      });

      if (!submitResponse.ok) {
        /*
         * FastAPI's envelope, which is `{ "detail": ... }` and sometimes a list
         * of validation objects rather than a string. Passed on as text rather
         * than parsed: the vendor's own docs say not to make decisions by
         * reading these messages, and the status code is what
         * `videoUnavailable` actually branches on.
         */
        const detail = await submitResponse.text().catch(() => '');
        throw videoUnavailable('Higgsfield', submitResponse.status, detail);
      }

      const submitted = (await submitResponse.json()) as { status_url?: string; request_id?: string };
      if (!submitted.status_url) {
        throw new ToolError('UPSTREAM_FAILED', 'Higgsfield accepted the request but returned no status URL.', {
          model,
          vendor: 'Higgsfield',
        });
      }

      let delay = POLL_START_MS;
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        const statusResponse = await doFetch(submitted.status_url, { headers: { authorization: auth } });
        if (!statusResponse.ok) {
          const detail = await statusResponse.text().catch(() => '');
          throw videoUnavailable('Higgsfield', statusResponse.status, detail);
        }

        const status = (await statusResponse.json()) as {
          status?: string;
          error?: string;
          video?: { url?: string };
        };

        if (status.status === 'completed') {
          const url = status.video?.url;
          if (typeof url !== 'string' || !url) {
            throw new ToolError('UPSTREAM_FAILED', 'Higgsfield reported the clip complete but returned no video.', {
              model,
              vendor: 'Higgsfield',
              requestId: submitted.request_id,
            });
          }
          return { url };
        }

        if (status.status === 'nsfw') {
          /*
           * `GUARDRAIL_BLOCKED`, not `UPSTREAM_FAILED`, and the distinction is
           * load-bearing in both directions. `withFallback` retries only
           * upstream failures, and a moderation refusal of *this prompt* would
           * be refused again by anyone else — slowly, and for money. It is also
           * the one terminal state the vendor does not bill, so turning it into
           * a second attempt converts a free refusal into a paid one.
           */
          throw new ToolError('GUARDRAIL_BLOCKED', 'The video model refused this prompt on content grounds.', {
            model,
            vendor: 'Higgsfield',
            requestId: submitted.request_id,
          });
        }

        if (status.status === 'failed' || status.status === 'canceled') {
          throw new ToolError(
            'UPSTREAM_FAILED',
            `Higgsfield reported the clip ${status.status}${status.error ? `: ${status.error}` : ''}.`,
            { model, vendor: 'Higgsfield', requestId: submitted.request_id },
          );
        }

        await sleep(delay + Math.round(random() * POLL_JITTER_MS));
        delay = Math.min(delay * POLL_GROWTH, POLL_MAX_MS);
      }

      throw new ToolError('UPSTREAM_FAILED', `Higgsfield did not finish the clip within ${MAX_POLL_ATTEMPTS} polls.`, {
        model,
        vendor: 'Higgsfield',
        requestId: submitted.request_id,
      });
    },
  };
}

/** `16:9`, `9:16`, `1:1` — the three the default model takes, and the three the playbooks declare. */
function higgsfieldAspectRatio(aspectRatio: string): string {
  switch (aspectRatio) {
    case '16:9':
      return '16:9';
    case '1:1':
      return '1:1';
    case '9:16':
    default:
      return '9:16';
  }
}

/** Rounds down to something the model takes — the reasoning is `snapDuration`'s in `video-client.ts`. */
function snapDuration(seconds: number): number {
  if (ALLOWED_DURATIONS.length === 0) return seconds;
  const notLonger = ALLOWED_DURATIONS.filter((d) => d <= seconds);
  return notLonger.length > 0 ? Math.max(...notLonger) : Math.min(...ALLOWED_DURATIONS);
}

/**
 * The backup client when both halves of the credential are set, `undefined`
 * otherwise.
 *
 * Both halves, because one without the other is not a degraded configuration —
 * it is a typo, and the only thing it can produce is a 401 on the day fal runs
 * out of credit. Saying so at boot is the whole point of `envSet` gating.
 */
export function higgsfieldVideoClient(): VideoClient | undefined {
  const hasId = envSet('HIGGSFIELD_KEY_ID');
  const hasSecret = envSet('HIGGSFIELD_KEY_SECRET');

  if (hasId !== hasSecret) {
    console.warn(
      '[warn] Higgsfield needs both HIGGSFIELD_KEY_ID and HIGGSFIELD_KEY_SECRET — ' +
        `only ${hasId ? 'the id' : 'the secret'} is set, so the video backup is off.`,
    );
    return undefined;
  }
  if (!hasId) return undefined;

  return createHiggsfieldVideoClient({
    keyId: envStr('HIGGSFIELD_KEY_ID', ''),
    keySecret: envStr('HIGGSFIELD_KEY_SECRET', ''),
    ...(envSet('HIGGSFIELD_VIDEO_MODEL') ? { model: envStr('HIGGSFIELD_VIDEO_MODEL', '') } : {}),
  });
}
