import { ToolError } from '@sparksocial/shared';
import type { ImageClient } from '@sparksocial/generate';
import { envSet, envStr } from './env.js';

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
        throw new ToolError('UPSTREAM_FAILED', `Image generation failed (${response.status}).`, {
          status: response.status,
          detail: detail.slice(0, 200),
        });
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

export function imageClient(): ImageClient | undefined {
  if (memo === null) memo = buildImageClient();
  return memo;
}

function buildImageClient(): ImageClient | undefined {
  if (!envSet('FAL_API_KEY')) {
    console.warn('[warn] FAL_API_KEY unset — content.generate_image is not registered. Drafts get copy, not images.');
    return undefined;
  }
  return createImageClient({
    apiKey: envStr('FAL_API_KEY', ''),
    ...(envSet('FAL_MODEL') ? { model: envStr('FAL_MODEL', '') } : {}),
  });
}
