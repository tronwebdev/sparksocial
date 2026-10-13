import { randomUUID } from 'node:crypto';
import { ToolError } from '@sparksocial/shared';
import type { VoiceClient } from '@sparksocial/generate';
import type { BlobStore } from '@sparksocial/storage';
import { envSet, envStr } from './env.js';

/**
 * Production narration for `content.generate_voiceover` — ElevenLabs'
 * text-to-speech endpoint.
 *
 * The one client in this file that returns bytes rather than a hosted URL:
 * fal.ai and HeyGen host their own output and hand back a link,
 * ElevenLabs streams the audio directly in the response. So this is also the
 * one client that takes a `BlobStore` — it uploads what ElevenLabs returns
 * and hands the tool layer a URL, keeping every `*Client` interface in
 * `packages/generate` shaped the same regardless of which vendor happens to
 * host its own output.
 */

export interface VoiceClientOptions {
  apiKey: string;
  blobStore: BlobStore;
  model?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

const BASE_URL = 'https://api.elevenlabs.io/v1';
const DEFAULT_MODEL = 'eleven_multilingual_v2';

export function createVoiceClient(opts: VoiceClientOptions): VoiceClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const model = opts.model ?? DEFAULT_MODEL;

  return {
    async generate({ voiceId, script }): Promise<{ url: string }> {
      const response = await doFetch(`${BASE_URL}/text-to-speech/${encodeURIComponent(voiceId)}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'audio/mpeg',
          'xi-api-key': opts.apiKey,
        },
        body: JSON.stringify({ text: script, model_id: model }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new ToolError('UPSTREAM_FAILED', `Voiceover request failed (${response.status}).`, {
          status: response.status,
          detail: detail.slice(0, 200),
        });
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0) {
        throw new ToolError('UPSTREAM_FAILED', 'Voiceover response had no audio.', { voiceId });
      }

      // Flat key, not the `{orgId}/{genomeId}/...` layout `buildKey` uses for
      // Asset Graph uploads — this file isn't a brand asset with rights/reuse
      // tracking, it's a generated artifact referenced by URL from one
      // content_items row, which is already genome-scoped where it lives.
      const { url } = await opts.blobStore.put({
        key: `generated/${randomUUID()}.mp3`,
        contentType: 'audio/mpeg',
        bytes,
      });
      return { url };
    },

    /**
     * Instant Voice Clone — `POST /v1/voices/add`, multipart.
     *
     * The samples are fetched here rather than streamed from the browser,
     * because the browser never had them: the recorder and the file picker both
     * upload through `asset.upload_url` first, so what arrives is a storage URL.
     * Fetching it server-side also means the vendor never sees a URL into our
     * bucket, only bytes.
     *
     * ── Why `requires_verification` is returned rather than swallowed ───────
     *
     * ElevenLabs accepts the clone and sets this flag when the account has not
     * verified it may clone that voice. The id is real and usable for some
     * operations, but narration can fail later with a permissions error. The
     * tool surfaces it in `why` instead of discovering it during the first
     * render of a customer's post.
     */
    async clone({ name, samples }) {
      if (samples.length === 0) {
        throw new ToolError('INVALID_INPUT', 'A voice clone needs at least one audio sample.', {});
      }

      const form = new FormData();
      form.set('name', name);
      for (const [i, sample] of samples.entries()) {
        const res = await doFetch(sample.url);
        if (!res.ok) {
          throw new ToolError('UPSTREAM_FAILED', 'Could not read the uploaded voice sample.', {
            status: res.status,
            operator: `GET on the sample URL returned ${res.status}. If storage is R2 the presigned read URL may have expired.`,
          });
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length === 0) {
          throw new ToolError('UPSTREAM_FAILED', 'The uploaded voice sample was empty.', { index: i });
        }
        form.append('files', new Blob([bytes], { type: sample.contentType }), `sample-${i}.${extFor(sample.contentType)}`);
      }

      // No `content-type` header: `fetch` sets it from the FormData, including
      // the multipart boundary. Setting it by hand omits the boundary and the
      // request is rejected as malformed.
      const response = await doFetch(`${BASE_URL}/voices/add`, {
        method: 'POST',
        headers: { 'xi-api-key': opts.apiKey },
        body: form,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new ToolError('UPSTREAM_FAILED', `Voice cloning failed (${response.status}).`, {
          status: response.status,
          detail: detail.slice(0, 200),
          operator:
            response.status === 401
              ? 'ELEVENLABS_API_KEY was rejected.'
              : response.status === 403
                ? 'The ElevenLabs plan does not allow voice cloning, or every voice slot is in use.'
                : undefined,
        });
      }

      const body = (await response.json()) as { voice_id?: unknown; requires_verification?: unknown };
      if (typeof body.voice_id !== 'string' || body.voice_id.length === 0) {
        throw new ToolError('UPSTREAM_FAILED', 'ElevenLabs accepted the sample but returned no voice id.', {});
      }

      return { voiceId: body.voice_id, requiresVerification: body.requires_verification === true };
    },
  };
}

/** A filename extension the vendor will accept; the name itself is cosmetic. */
function extFor(contentType: string): string {
  if (contentType.includes('wav')) return 'wav';
  if (contentType.includes('webm')) return 'webm';
  if (contentType.includes('ogg')) return 'ogg';
  if (contentType.includes('mp4')) return 'm4a';
  return 'mp3';
}

/**
 * The real client when `ELEVENLABS_API_KEY` is configured, `undefined`
 * otherwise — same "unset → not registered" rule as `avatarClient()`. Unlike
 * avatar/image, this one *could* degrade to a stock voice with no key at all,
 * but there is still no key-free path to ElevenLabs' API, so the same rule
 * applies: absent, not faked.
 */
let memo: VoiceClient | undefined | null = null;

export function voiceClient(blobStore: BlobStore): VoiceClient | undefined {
  if (memo === null) memo = buildVoiceClient(blobStore);
  return memo;
}

function buildVoiceClient(blobStore: BlobStore): VoiceClient | undefined {
  if (!envSet('ELEVENLABS_API_KEY')) {
    console.warn('[warn] ELEVENLABS_API_KEY unset — content.generate_voiceover is not registered.');
    return undefined;
  }
  return createVoiceClient({
    apiKey: envStr('ELEVENLABS_API_KEY', ''),
    blobStore,
    ...(envSet('ELEVENLABS_MODEL') ? { model: envStr('ELEVENLABS_MODEL', '') } : {}),
  });
}
