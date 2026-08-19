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
  };
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
