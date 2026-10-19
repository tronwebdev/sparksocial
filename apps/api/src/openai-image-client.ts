import { randomUUID } from 'node:crypto';
import { ToolError } from '@sparksocial/shared';
import type { ImageClient } from '@sparksocial/generate';
import type { BlobStore } from '@sparksocial/storage';
import { envSet, envStr } from './env.js';

/**
 * OpenAI's image endpoint, as a second source when fal cannot serve.
 *
 * ── On "use Claude or OpenAI" ─────────────────────────────────────────────
 *
 * Only half of that is possible. **Anthropic's models do not generate images** —
 * Claude reads them and writes about them, and there is no endpoint to call for
 * a picture. So the fallback is OpenAI, and if OpenAI is also unset there is no
 * third option; `fallbackImageClient` then returns `undefined` and the caller
 * keeps fal's own error, which is the honest outcome rather than a silent
 * placeholder.
 *
 * ── Why a second client rather than retrying fal ─────────────────────────
 *
 * The failure that prompted this was fal answering 403 — out of credit. Retrying
 * that produces 403 again, forever, and the customer pressing "Generate logo"
 * gets nothing either way. A different vendor is the only retry that can
 * succeed.
 *
 * ── Returns a hosted URL, like every other client here ───────────────────
 *
 * OpenAI returns base64, not a link, so this is the second client in this
 * codebase that takes a `BlobStore` — the same reasoning `voice-client.ts`
 * documents for ElevenLabs. The tool layer gets a URL and never learns which
 * vendor produced it.
 */

export interface OpenAiImageClientOptions {
  apiKey: string;
  blobStore: BlobStore;
  model?: string;
  baseUrl?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

/**
 * `flare`, not `sunburst`.
 *
 * OpenAI's current image models are `gpt-image-2.5-sunburst` and
 * `gpt-image-2.5-flare` (September 2026). Sunburst is the one tuned for
 * editing precision; Flare is for fast, high-quality everyday generation,
 * which is what this client does — one prompt, one picture, nothing to edit.
 *
 * This said `gpt-image-1` when it was written, which is simply out of date and
 * would have been a 400 at the first fallback: a backup provider that fails on
 * its own model id is worse than no backup, because it only shows up on the day
 * the primary is already down. Overridable with `OPENAI_IMAGE_MODEL` so a model
 * change needs no deploy.
 */
const DEFAULT_MODEL = 'gpt-image-2.5-flare';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * Aspect ratio to a size the endpoint accepts.
 *
 * These three are OpenAI's own recommended values. Custom `WIDTHxHEIGHT` is
 * allowed — multiples of 16, between 1:3 and 3:1 — but there is nothing to gain
 * here: the three cover portrait, landscape and square, and a bespoke size
 * would only add a way to be rejected.
 *
 * Anything unrecognised lands on square: the shape `brand.logo.generate` asks
 * for, and the one a renderer can letterbox without cropping a face out of
 * frame.
 */
function sizeFor(aspectRatio: string): string {
  switch (aspectRatio) {
    case '9:16':
      return '1024x1536';
    case '16:9':
      return '1536x1024';
    default:
      return '1024x1024';
  }
}

export function createOpenAiImageClient(opts: OpenAiImageClientOptions): ImageClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const model = opts.model ?? DEFAULT_MODEL;
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;

  return {
    async generate({ prompt, aspectRatio }): Promise<{ url: string }> {
      const response = await doFetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({ model, prompt, size: sizeFor(aspectRatio), n: 1 }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new ToolError('UPSTREAM_FAILED', 'The backup image service could not make an image either.', {
          status: response.status,
          operator: `OpenAI images returned ${response.status}. Check OPENAI_API_KEY and that the account has image access.`,
          detail: detail.slice(0, 200),
        });
      }

      const body = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
      const first = body.data?.[0];

      // A direct URL, if this model ever returns one — cheaper than round-tripping bytes.
      if (first?.url) return { url: first.url };

      if (!first?.b64_json) {
        throw new ToolError('UPSTREAM_FAILED', 'The backup image service returned no image.', {
          operator: 'OpenAI images responded 200 with neither `url` nor `b64_json`.',
        });
      }

      const bytes = new Uint8Array(Buffer.from(first.b64_json, 'base64'));
      // Flat `generated/` key, not the Asset Graph layout: this is a generated
      // artifact referenced by URL, not a brand asset with rights tracking.
      // Same reasoning as `voice-client.ts`.
      const { url } = await opts.blobStore.put({
        key: `generated/${randomUUID()}.png`,
        contentType: 'image/png',
        bytes,
      });
      return { url };
    },
  };
}

/**
 * The backup, or `undefined` when there is none.
 *
 * Deliberately *not* gated on fal being absent: this is what runs when fal is
 * configured and fails, which is the case that prompted it.
 */
export function fallbackImageClient(blobStore: BlobStore): ImageClient | undefined {
  if (!envSet('OPENAI_API_KEY')) return undefined;
  return createOpenAiImageClient({
    apiKey: envStr('OPENAI_API_KEY', ''),
    blobStore,
    ...(envSet('OPENAI_IMAGE_MODEL') ? { model: envStr('OPENAI_IMAGE_MODEL', '') } : {}),
  });
}
