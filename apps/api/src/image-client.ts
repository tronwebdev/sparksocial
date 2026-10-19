import { ToolError } from '@sparksocial/shared';
import type { ImageClient } from '@sparksocial/generate';
import { envSet, envStr } from './env.js';
import type { BlobStore } from '@sparksocial/storage';
import { fallbackImageClient } from './openai-image-client.js';

/**
 * Production image generation for `content.generate_image` — fal.ai's
 * synchronous REST inference API (`POST https://fal.run/{model}`), the
 * vendor CLAUDE.md's Azure substitution table names as unchanged SaaS.
 *
 * Written against fal's plain HTTP shape rather than a client SDK for the
 * same reason `embed-client.ts` is: one HTTP call with a handful of fields
 * does not earn a fifth vendor SDK in `apps/api`, and fal's REST surface is
 * stable across their model catalogue — swapping `FAL_MODEL` is how a
 * caller changes models, not a code change.
 */

export interface ImageClientOptions {
  apiKey: string;
  model?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_MODEL = 'fal-ai/flux/schnell';
/** A queued image is minutes at worst, not the ten a video can take. */
const QUEUE_POLL_INTERVAL_MS = 2_000;
const QUEUE_POLL_ATTEMPTS = 90;

/**
 * What a person reads when image generation does not work, and what an operator
 * needs, kept apart.
 *
 * This used to throw `Image generation failed (403).` — a status code, to
 * somebody who pressed "Generate logo". It names no cause they can act on, and
 * the one cause it usually has is not theirs: 403 from fal means the account is
 * out of credit or locked, which is a billing fact about *us*. Telling a
 * customer "403" invites them to retry, and the retry fails identically.
 *
 * Same split `storageUnavailable` makes in `packages/storage/src/r2.ts`: the
 * message is for the person holding the mouse, `meta.operator` is for whoever
 * reads the audit row, and `app.ts` serialises only `code` and `message` to the
 * client.
 */
export function imageUnavailable(status: number, detail: string): ToolError {
  const body = detail.toLowerCase();
  const outOfCredit = status === 403 || /exhausted|balance|locked|quota/.test(body);
  const badKey = status === 401;
  const rateLimited = status === 429;

  const message = outOfCredit
    ? 'Image generation is paused because the image service has run out of credit. Nothing is wrong with ' +
      'what you entered — upload an image instead, or try again once it is topped up.'
    : badKey
      ? 'Image generation is not configured correctly, so nothing could be made. This is our side, not yours.'
      : rateLimited
        ? 'Image generation is busy right now. Wait a minute and try again, or upload an image instead.'
        : 'Image generation did not work just now. Try again shortly, or upload an image instead.';

  const operator = outOfCredit
    ? `fal returned ${status}: the account is out of credit or locked. Top up at fal.ai; FAL_API_KEY is otherwise fine.`
    : badKey
      ? 'fal rejected FAL_API_KEY. Check the key, and that it is not revoked.'
      : rateLimited
        ? 'fal rate-limited this account. Back off, or raise the plan limit.'
        : `fal returned ${status}.`;

  return new ToolError('UPSTREAM_FAILED', message, { status, operator, detail: detail.slice(0, 200) });
}

export function createImageClient(opts: ImageClientOptions): ImageClient {
  const model = opts.model ?? DEFAULT_MODEL;
  const doFetch = opts.fetchImpl ?? fetch;

  /**
   * Poll a queued job to its image.
   *
   * Same shape as `video-client.ts`'s loop, and deliberately not shared with
   * it: that one is written against a video response body and a video's
   * patience. Two small loops that each say what they wait for beat one
   * parameterised loop that says neither.
   */
  async function awaitQueued(statusUrl: string, responseUrl: string): Promise<string> {
    const auth = { authorization: `Key ${opts.apiKey}` };
    for (let attempt = 0; attempt < QUEUE_POLL_ATTEMPTS; attempt += 1) {
      const status = await doFetch(statusUrl, { headers: auth });
      if (!status.ok) {
        throw new ToolError('UPSTREAM_FAILED', `Image generation status check failed (${status.status}).`, {
          status: status.status,
        });
      }
      const state = (await status.json()) as { status?: string };
      if (state.status === 'ERROR') {
        throw new ToolError('UPSTREAM_FAILED', 'Image generation job failed on the vendor side.', { model });
      }
      if (state.status === 'COMPLETED') {
        const result = await doFetch(responseUrl, { headers: auth });
        const done = (await result.json()) as { images?: Array<{ url?: string }> };
        const url = done.images?.[0]?.url;
        if (typeof url !== 'string' || !url) {
          throw new ToolError('UPSTREAM_FAILED', 'Image generation completed but the response had no image.', { model });
        }
        return url;
      }
      await new Promise((r) => setTimeout(r, QUEUE_POLL_INTERVAL_MS));
    }
    throw new ToolError('UPSTREAM_FAILED', 'Image generation did not complete in time.', { model });
  }

  return {
    async generate({ prompt, aspectRatio }): Promise<{ url: string }> {
      const response = await doFetch(`https://fal.run/${model}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Key ${opts.apiKey}`,
        },
        body: JSON.stringify({
          prompt,
          ...aspectParam(aspectRatio),
          ...EXTRA,
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw imageUnavailable(response.status, detail);
      }

      const body = (await response.json()) as {
        images?: Array<{ url?: string }>;
        status_url?: string;
        response_url?: string;
      };

      /*
       * A queued answer instead of an image.
       *
       * `fal.run` is the synchronous endpoint and the fast distilled models
       * return the image inline. The heavier ones — the whole reason anybody
       * changes `FAL_MODEL` — take long enough that fal answers 200 with a
       * queue handle instead, and this read `images[0].url` off that, found
       * nothing, and reported "response had no image": a successful submission
       * presented as a vendor fault. Following the handle is what makes every
       * model in the catalogue reachable rather than only the fastest ones.
       */
      if (!body.images?.[0]?.url && body.status_url && body.response_url) {
        return { url: await awaitQueued(body.status_url, body.response_url) };
      }

      const url = body.images?.[0]?.url;

      if (typeof url !== 'string' || !url) {
        throw new ToolError('UPSTREAM_FAILED', 'Image generation response had no image.', { model });
      }

      return { url };
    },
  };
}

/**
 * How this model is told what shape to draw.
 *
 * `image_size` with named presets is FLUX's parameter, and it was hardcoded —
 * which is fine until the model changes. Google's models on fal (nano-banana,
 * gemini-*-image) take `aspect_ratio` with a literal ratio string instead, and
 * they do not reject `image_size`: they ignore it and fall back to their own
 * default of 1:1. So pointing `FAL_MODEL` at one of those silently produced a
 * square image for every playbook, including the 9:16 video thumbnails and the
 * 4:5 feed stills, with a 200 and no warning anywhere.
 *
 * Declared rather than inferred from the model name, for the reason
 * `video-client.ts` gives about `FAL_VIDEO_DURATIONS`: a table of model names
 * in here is a second, private copy of fal's catalogue that goes stale the
 * moment they ship a version.
 */
const ASPECT_PARAM = envStr('FAL_IMAGE_ASPECT_PARAM', 'image_size');

/**
 * Anything else this model wants, as JSON.
 *
 * An escape hatch rather than a growing list of optional fields: the models
 * differ in ways that are not worth a schema here (`output_format`,
 * `safety_tolerance`, `num_images`), and each one added as a named option is a
 * field every other model has to ignore. Malformed JSON is treated as empty and
 * said so, because a silently dropped parameter is the failure this whole file
 * keeps running into.
 */
const EXTRA = parseExtra('FAL_IMAGE_EXTRA_PARAMS');

function aspectParam(aspectRatio: string): Record<string, string> {
  return ASPECT_PARAM === 'aspect_ratio'
    ? { aspect_ratio: aspectRatio }
    : { image_size: falImageSize(aspectRatio) };
}

export function parseExtra(envName: string): Record<string, unknown> {
  const raw = envStr(envName, '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    console.warn(`[warn] ${envName} is not a JSON object — ignoring it.`, { raw: raw.slice(0, 120) });
  } catch (e) {
    console.warn(`[warn] ${envName} is not valid JSON — ignoring it.`, {
      raw: raw.slice(0, 120),
      detail: e instanceof Error ? e.message.slice(0, 120) : '',
    });
  }
  return {};
}

/**
 * fal's `image_size` accepts named presets or `{width,height}`; named presets
 * cover every aspect ratio the playbook library actually declares
 * (`1:1`, `4:5`(~portrait), `9:16`, `16:9`), so a lookup beats computing pixel
 * dimensions for a handful of known ratios.
 */
function falImageSize(aspectRatio: string): string {
  switch (aspectRatio) {
    case '1:1':
      return 'square_hd';
    case '9:16':
      return 'portrait_16_9';
    case '16:9':
      return 'landscape_16_9';
    case '4:5':
      return 'portrait_4_3';
    default:
      return 'square_hd';
  }
}

/**
 * The real client when `FAL_API_KEY` is configured, `undefined` otherwise —
 * unlike `embedClient()`/`textWriter()`, there is no honest fallback for
 * pixels (see `packages/generate/src/image.ts`'s comment on why). Callers
 * check for `undefined` and skip registering `content.generate_image`
 * entirely, the same "unset → not registered" rule
 * `WHATSAPP_APP_SECRET` already sets for the inbound webhook.
 */
let memo: ImageClient | undefined | null = null;

export function imageClient(blobs: BlobStore): ImageClient | undefined {
  if (memo === null) memo = buildImageClient(blobs);
  return memo;
}

/**
 * fal, then OpenAI, then give up — see `withFallback`.
 *
 * Either vendor alone is enough to register the image tools. fal stays first
 * because it is cheaper and faster for this workload; OpenAI exists so that an
 * exhausted fal balance stops being the end of the story.
 */
function buildImageClient(blobs: BlobStore): ImageClient | undefined {
  const primary = envSet('FAL_API_KEY')
    ? createImageClient({
        apiKey: envStr('FAL_API_KEY', ''),
        ...(envSet('FAL_MODEL') ? { model: envStr('FAL_MODEL', '') } : {}),
      })
    : undefined;
  const backup = fallbackImageClient(blobs);

  if (!primary && !backup) {
    console.warn(
      '[warn] neither FAL_API_KEY nor OPENAI_API_KEY is set — content.generate_image is not registered. ' +
        'Drafts get copy, not images.',
    );
    return undefined;
  }
  if (!primary) {
    console.warn('[warn] FAL_API_KEY unset — images come from OpenAI, which is slower and dearer for this.');
    return backup;
  }
  if (!backup) {
    console.warn(
      '[warn] OPENAI_API_KEY unset — image generation has no backup. An exhausted fal balance stops it entirely.',
    );
    return primary;
  }
  return withFallback(primary, backup);
}

/**
 * Try `primary`; on a vendor failure, try `backup` once.
 *
 * ── What counts as worth retrying elsewhere ──────────────────────────────
 *
 * Only `UPSTREAM_FAILED`. A `GUARDRAIL_BLOCKED` or an `INVALID_INPUT` means the
 * *request* is the problem, and asking a second vendor the same bad question
 * wastes money to get the same answer — twice as slowly. An exhausted balance,
 * a rate limit, a vendor outage: those are about the vendor, and a different
 * vendor is the only retry that can succeed.
 *
 * ── Why the first error is what surfaces if both fail ────────────────────
 *
 * The backup's failure is almost always less interesting — it is the second
 * thing tried, often unconfigured or rejecting for its own unrelated reason —
 * while the primary's carries the cause anyone would act on ("fal is out of
 * credit"). Both are logged; one is thrown.
 */
export function withFallback(primary: ImageClient, backup: ImageClient): ImageClient {
  return {
    async generate(args) {
      try {
        return await primary.generate(args);
      } catch (e) {
        if (!(e instanceof ToolError) || e.code !== 'UPSTREAM_FAILED') throw e;
        console.warn('[warn] image: the primary provider failed, trying the backup', {
          reason: e.message,
          operator: (e.meta as { operator?: string } | undefined)?.operator,
        });
        try {
          return await backup.generate(args);
        } catch (second) {
          console.error('[error] image: the backup provider failed too', {
            reason: second instanceof Error ? second.message : String(second),
          });
          throw e;
        }
      }
    },
  };
}
