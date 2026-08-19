import { randomUUID } from 'node:crypto';
import { ToolError } from '@sparksocial/shared';
import type { DubbingClient } from '@sparksocial/generate';
import type { BlobStore } from '@sparksocial/storage';
import { envSet, envStr } from './env.js';

/**
 * Production dubbing for `content.generate_dub` — ElevenLabs' Dubbing API.
 *
 * Two things confirmed directly against the real API before writing this
 * (same "confirmed feasible, not assumed" posture `remotion-runner.ts` and
 * `satori-runner.ts` both take): `POST /v1/dubbing` genuinely requires
 * `multipart/form-data` — a JSON body with the identical fields is silently
 * ignored (`target_lang` came back "must be set" even though it was in the
 * JSON payload) — and `GET /v1/dubbing/{id}` is the real status path. Neither
 * probe spent a real dubbing credit: both used inputs designed to fail
 * validation before any audio/video processing starts. A full end-to-end dub
 * was deliberately not run — same reasoning `content.generate_avatar_video`'s
 * own gap note gives for HeyGen: this account is real and funded, but
 * spending it to prove a render is a separate decision from building the
 * client correctly.
 *
 * Submit → poll → fetch, the same three-step shape `remotion-runner.ts` and
 * `satori-runner.ts` take for their own async/CPU-bound jobs, adapted to a
 * polled HTTP status instead of a local process.
 */

export interface DubbingClientOptions {
  apiKey: string;
  blobStore: BlobStore;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const BASE_URL = 'https://api.elevenlabs.io/v1';
const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_ATTEMPTS = 100; // ~5 minutes — dubbing a real clip is slower than TTS/image generation.

export function createDubbingClient(opts: DubbingClientOptions): DubbingClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  return {
    async dub({ sourceUrl, targetLanguage, mediaType }): Promise<{ url: string }> {
      const form = new FormData();
      form.append('source_url', sourceUrl);
      form.append('target_lang', targetLanguage);

      const submitResponse = await doFetch(`${BASE_URL}/dubbing`, {
        method: 'POST',
        headers: { 'xi-api-key': opts.apiKey },
        body: form,
      });
      if (!submitResponse.ok) {
        const detail = await submitResponse.text().catch(() => '');
        throw new ToolError('UPSTREAM_FAILED', `Dubbing request failed (${submitResponse.status}).`, {
          status: submitResponse.status,
          detail: detail.slice(0, 200),
        });
      }
      const submitted = (await submitResponse.json()) as { dubbing_id?: string };
      if (!submitted.dubbing_id) {
        throw new ToolError('UPSTREAM_FAILED', 'Dubbing accepted the request but returned no dubbing_id.', {});
      }
      const dubbingId = submitted.dubbing_id;

      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        const statusResponse = await doFetch(`${BASE_URL}/dubbing/${encodeURIComponent(dubbingId)}`, {
          headers: { 'xi-api-key': opts.apiKey },
        });
        if (!statusResponse.ok) {
          throw new ToolError('UPSTREAM_FAILED', `Dubbing status check failed (${statusResponse.status}).`, { status: statusResponse.status });
        }
        const status = (await statusResponse.json()) as { status?: string; error?: string };

        if (status.status === 'dubbed') {
          const fileResponse = await doFetch(`${BASE_URL}/dubbing/${encodeURIComponent(dubbingId)}/audio/${encodeURIComponent(targetLanguage)}`, {
            headers: { 'xi-api-key': opts.apiKey },
          });
          if (!fileResponse.ok) {
            throw new ToolError('UPSTREAM_FAILED', `Dubbing result fetch failed (${fileResponse.status}).`, { status: fileResponse.status });
          }
          const bytes = new Uint8Array(await fileResponse.arrayBuffer());
          if (bytes.length === 0) {
            throw new ToolError('UPSTREAM_FAILED', 'Dubbing completed but the response had no media.', { dubbingId });
          }
          const ext = mediaType === 'video' ? 'mp4' : 'mp3';
          const { url } = await opts.blobStore.put({
            key: `generated/${randomUUID()}.${ext}`,
            contentType: mediaType === 'video' ? 'video/mp4' : 'audio/mpeg',
            bytes,
          });
          return { url };
        }
        if (status.status === 'failed') {
          throw new ToolError('UPSTREAM_FAILED', `Dubbing job failed: ${status.error ?? 'unknown error'}`, { dubbingId });
        }
        await sleep(POLL_INTERVAL_MS);
      }

      throw new ToolError('UPSTREAM_FAILED', `Dubbing did not complete within ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s.`, { dubbingId });
    },
  };
}

/**
 * The real client when `ELEVENLABS_API_KEY` is configured, `undefined`
 * otherwise — same key `voiceClient()` uses (one ElevenLabs account), same
 * "unset → not registered" rule.
 */
let memo: DubbingClient | undefined | null = null;

export function dubbingClient(blobStore: BlobStore): DubbingClient | undefined {
  if (memo === null) memo = buildDubbingClient(blobStore);
  return memo;
}

function buildDubbingClient(blobStore: BlobStore): DubbingClient | undefined {
  if (!envSet('ELEVENLABS_API_KEY')) {
    console.warn('[warn] ELEVENLABS_API_KEY unset — content.generate_dub is not registered.');
    return undefined;
  }
  return createDubbingClient({ apiKey: envStr('ELEVENLABS_API_KEY', ''), blobStore });
}
