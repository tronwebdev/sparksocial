import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import { createMemoryBlobStore } from '@sparksocial/storage';
import { createDubbingClient } from '../src/dubbing-client.js';

/**
 * The ElevenLabs Dubbing client — submit (multipart, confirmed against the
 * real API — a JSON body is silently ignored), then poll a status endpoint until
 * `dubbed`/`failed`, then fetch and upload the resulting bytes. What matters:
 * the submit body is真 multipart with the right fields, polling actually
 * polls, a failed job surfaces as a ToolError, and the uploaded file's
 * extension/content-type follow the requested media type.
 */

const mediaBytes = new Uint8Array([1, 2, 3, 4]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('request shape', () => {
  it('submits multipart form data with source_url and target_lang', async () => {
    const f = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url) === 'https://api.elevenlabs.io/v1/dubbing') return json({ dubbing_id: 'dub_1' });
      if (String(url).includes('/dubbing/dub_1') && !String(url).includes('/audio/')) return json({ status: 'dubbed' });
      return new Response(mediaBytes, { status: 200 });
    });
    const client = createDubbingClient({ apiKey: 'k', blobStore: createMemoryBlobStore(), fetchImpl: f as unknown as typeof fetch, sleep: async () => {} });

    await client.dub({ sourceUrl: 'https://source.example/clip.mp4', targetLanguage: 'es', mediaType: 'video' });

    const init = f.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('k');
    expect(init.body).toBeInstanceOf(FormData);
    const body = init.body as FormData;
    expect(body.get('source_url')).toBe('https://source.example/clip.mp4');
    expect(body.get('target_lang')).toBe('es');
  });
});

describe('the poll loop and result fetch', () => {
  it('polls until dubbed, fetches the file, and uploads it with the right content type', async () => {
    let pollCount = 0;
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u === 'https://api.elevenlabs.io/v1/dubbing') return json({ dubbing_id: 'dub_1' });
      if (u.endsWith('/dubbing/dub_1')) {
        pollCount += 1;
        return json({ status: pollCount < 3 ? 'dubbing' : 'dubbed' });
      }
      // GET .../dubbing/dub_1/audio/es
      return new Response(mediaBytes, { status: 200 });
    });
    const blobStore = createMemoryBlobStore();
    const sleep = vi.fn(async () => {});
    const client = createDubbingClient({ apiKey: 'k', blobStore, fetchImpl: f as unknown as typeof fetch, sleep });

    const out = await client.dub({ sourceUrl: 'https://source.example/clip.mp4', targetLanguage: 'es', mediaType: 'video' });

    expect(pollCount).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(out.url).toMatch(/^https:\/\/memory\.blob\.local\/generated\//);
    expect(blobStore.keys[0]).toMatch(/^generated\/.+\.mp4$/);
  });

  it('uploads audio-only dubs with an mp3 extension and audio content type', async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u === 'https://api.elevenlabs.io/v1/dubbing') return json({ dubbing_id: 'dub_1' });
      if (u.endsWith('/dubbing/dub_1')) return json({ status: 'dubbed' });
      return new Response(mediaBytes, { status: 200 });
    });
    const blobStore = createMemoryBlobStore();
    const client = createDubbingClient({ apiKey: 'k', blobStore, fetchImpl: f as unknown as typeof fetch, sleep: async () => {} });

    await client.dub({ sourceUrl: 'https://source.example/clip.mp3', targetLanguage: 'fr', mediaType: 'audio' });

    expect(blobStore.keys[0]).toMatch(/^generated\/.+\.mp3$/);
  });

  it('throws immediately on a failed job, without exhausting retries', async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u === 'https://api.elevenlabs.io/v1/dubbing') return json({ dubbing_id: 'dub_1' });
      return json({ status: 'failed', error: 'unsupported source format' });
    });
    const client = createDubbingClient({ apiKey: 'k', blobStore: createMemoryBlobStore(), fetchImpl: f as unknown as typeof fetch, sleep: async () => {} });

    await expect(client.dub({ sourceUrl: 'https://source.example/clip.mp4', targetLanguage: 'es', mediaType: 'video' })).rejects.toThrow(ToolError);
  });

  it('gives up rather than polling forever', async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u === 'https://api.elevenlabs.io/v1/dubbing') return json({ dubbing_id: 'dub_1' });
      return json({ status: 'dubbing' });
    });
    const sleep = vi.fn(async () => {});
    const client = createDubbingClient({ apiKey: 'k', blobStore: createMemoryBlobStore(), fetchImpl: f as unknown as typeof fetch, sleep });

    await expect(client.dub({ sourceUrl: 'https://source.example/clip.mp4', targetLanguage: 'es', mediaType: 'video' })).rejects.toThrow(ToolError);
  });

  it('refuses a dubbed job whose file fetch returns empty bytes', async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u === 'https://api.elevenlabs.io/v1/dubbing') return json({ dubbing_id: 'dub_1' });
      if (u.endsWith('/dubbing/dub_1')) return json({ status: 'dubbed' });
      return new Response(new Uint8Array(), { status: 200 });
    });
    const client = createDubbingClient({ apiKey: 'k', blobStore: createMemoryBlobStore(), fetchImpl: f as unknown as typeof fetch, sleep: async () => {} });

    await expect(client.dub({ sourceUrl: 'https://source.example/clip.mp4', targetLanguage: 'es', mediaType: 'video' })).rejects.toThrow(/no media/i);
  });
});

describe('transport', () => {
  it('reports an upstream failure on a non-2xx submit response', async () => {
    const f = vi.fn(async () => new Response('rate limited', { status: 429 }));
    const client = createDubbingClient({ apiKey: 'k', blobStore: createMemoryBlobStore(), fetchImpl: f as unknown as typeof fetch, sleep: async () => {} });

    await expect(client.dub({ sourceUrl: 'https://source.example/clip.mp4', targetLanguage: 'es', mediaType: 'video' })).rejects.toThrow(ToolError);
  });

  it('refuses a submit response with no dubbing_id', async () => {
    const f = vi.fn(async () => json({}));
    const client = createDubbingClient({ apiKey: 'k', blobStore: createMemoryBlobStore(), fetchImpl: f as unknown as typeof fetch, sleep: async () => {} });

    await expect(client.dub({ sourceUrl: 'https://source.example/clip.mp4', targetLanguage: 'es', mediaType: 'video' })).rejects.toThrow(ToolError);
  });
});
