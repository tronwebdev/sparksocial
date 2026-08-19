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

export function createImageClient(opts: ImageClientOptions): ImageClient {
  const model = opts.model ?? DEFAULT_MODEL;
  const doFetch = opts.fetchImpl ?? fetch;

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
          image_size: falImageSize(aspectRatio),
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new ToolError('UPSTREAM_FAILED', `Image generation failed (${response.status}).`, {
          status: response.status,
          detail: detail.slice(0, 200),
        });
      }

      const body = (await response.json()) as { images?: Array<{ url?: string }> };
      const url = body.images?.[0]?.url;

      if (typeof url !== 'string' || !url) {
        throw new ToolError('UPSTREAM_FAILED', 'Image generation response had no image.', { model });
      }

      return { url };
    },
  };
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
