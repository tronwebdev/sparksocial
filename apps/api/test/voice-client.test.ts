import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import { createMemoryBlobStore } from '@sparksocial/storage';
import { createVoiceClient } from '../src/voice-client.js';

/**
 * The ElevenLabs client — the one vendor client in this codebase that
 * receives bytes rather than a hosted url and has to store them itself. What
 * matters here: the right voice id lands in the URL, the bytes actually reach
 * the blob store, and a bad response fails loudly rather than uploading
 * nothing and returning a url to it.
 */

const audioBytes = new Uint8Array([1, 2, 3, 4]);

describe('request shape', () => {
  it('posts to the voice-specific endpoint with the key header', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(audioBytes, { status: 200 }));
    const client = createVoiceClient({ apiKey: 'k', blobStore: createMemoryBlobStore(), fetchImpl: f as unknown as typeof fetch });

    await client.generate({ voiceId: 'voice_1', script: 'hello there' });

    expect(f.mock.calls[0]![0]).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice_1');
    const init = f.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('k');
    expect(JSON.parse(init.body as string)).toMatchObject({ text: 'hello there', model_id: 'eleven_multilingual_v2' });
  });

  it('honours a configured model', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(audioBytes, { status: 200 }));
    const client = createVoiceClient({ apiKey: 'k', model: 'eleven_turbo_v2', blobStore: createMemoryBlobStore(), fetchImpl: f as unknown as typeof fetch });

    await client.generate({ voiceId: 'voice_1', script: 'x' });

    expect(JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string).model_id).toBe('eleven_turbo_v2');
  });
});

describe('the upload step', () => {
  it('stores the returned bytes and returns a url pointing at them', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(audioBytes, { status: 200 }));
    const blobStore = createMemoryBlobStore();
    const client = createVoiceClient({ apiKey: 'k', blobStore, fetchImpl: f as unknown as typeof fetch });

    const out = await client.generate({ voiceId: 'voice_1', script: 'x' });

    expect(out.url).toMatch(/^https:\/\/memory\.blob\.local\/generated\//);
    expect(blobStore.keys).toHaveLength(1);
    expect(blobStore.keys[0]).toMatch(/^generated\/.+\.mp3$/);
  });

  it('refuses an empty response rather than uploading zero bytes', async () => {
    const f = vi.fn(async () => new Response(new Uint8Array(), { status: 200 }));
    const client = createVoiceClient({ apiKey: 'k', blobStore: createMemoryBlobStore(), fetchImpl: f as unknown as typeof fetch });

    await expect(client.generate({ voiceId: 'voice_1', script: 'x' })).rejects.toThrow(/no audio/i);
  });
});

describe('transport', () => {
  it('reports an upstream failure rather than a broken url', async () => {
    const f = vi.fn(async () => new Response('rate limited', { status: 429 }));
    const client = createVoiceClient({ apiKey: 'k', blobStore: createMemoryBlobStore(), fetchImpl: f as unknown as typeof fetch });

    await expect(client.generate({ voiceId: 'voice_1', script: 'x' })).rejects.toThrow(ToolError);
  });

  it('does not echo the whole provider error back', async () => {
    const f = vi.fn(async () => new Response('x'.repeat(5_000), { status: 400 }));
    const client = createVoiceClient({ apiKey: 'k', blobStore: createMemoryBlobStore(), fetchImpl: f as unknown as typeof fetch });

    await client
      .generate({ voiceId: 'voice_1', script: 'secret' })
      .catch((e: ToolError & { meta?: { detail?: string } }) => {
        expect((e.meta?.detail ?? '').length).toBeLessThanOrEqual(200);
      });
  });
});
