import { describe, expect, it, vi } from 'vitest';
import { PublishError } from '../src/adapter.js';
import { createYouTubeAdapter } from '../src/native/youtubeAdapter.js';

const req = {
  platform: 'youtube_shorts' as const,
  text: 'the fade finishing\nmore detail here',
  mediaUrls: ['https://cdn/clip.mp4'],
  idempotencyKey: 'item_1:youtube_shorts',
  accessToken: 'tok_abc',
};

function mockSuccess() {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u === 'https://cdn/clip.mp4') return new Response(new Uint8Array([1, 2, 3]).buffer);
    if (u.includes('/upload/youtube/v3/videos')) {
      expect(init!.method).toBe('POST');
      return new Response(null, { status: 200, headers: { location: 'https://upload.youtube.example/session/abc' } });
    }
    if (u === 'https://upload.youtube.example/session/abc') {
      expect(init!.method).toBe('PUT');
      return new Response(JSON.stringify({ id: 'yt_1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected url ${u}`);
  });
}

describe('publish', () => {
  it('creates an upload session then PUTs the video bytes to the returned Location', async () => {
    const f = mockSuccess();
    const adapter = createYouTubeAdapter({ fetchImpl: f as unknown as typeof fetch });
    const receipt = await adapter.publish(req);
    expect(receipt).toMatchObject({ platform: 'youtube_shorts', externalId: 'yt_1', url: 'https://youtube.com/shorts/yt_1', via: 'native:youtube' });
  });

  it('sends the first line as title (truncated to 100 chars) and the full text as description', async () => {
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u === 'https://cdn/clip.mp4') return new Response(new Uint8Array([1]).buffer);
      if (u.includes('/upload/youtube/v3/videos')) {
        const body = JSON.parse(init!.body as string);
        expect(body.snippet.title).toBe('the fade finishing');
        expect(body.snippet.description).toBe(req.text);
        return new Response(null, { status: 200, headers: { location: 'https://upload.youtube.example/session/abc' } });
      }
      return new Response(JSON.stringify({ id: 'yt_1' }), { status: 200 });
    });
    const adapter = createYouTubeAdapter({ fetchImpl: f as unknown as typeof fetch });
    await adapter.publish(req);
    expect.assertions(2);
  });

  it('refuses without an accessToken', async () => {
    const adapter = createYouTubeAdapter();
    const err = await adapter.publish({ ...req, accessToken: undefined }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect((err as PublishError).retryable).toBe(false);
  });

  it('refuses a text-only post — YouTube requires video', async () => {
    const adapter = createYouTubeAdapter();
    const err = await adapter.publish({ ...req, mediaUrls: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect((err as PublishError).message).toContain('requires a video');
  });

  it('surfaces an upload-session-init failure classified by status', async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === 'https://cdn/clip.mp4') return new Response(new Uint8Array([1]).buffer);
      return new Response('bad', { status: 401 });
    });
    const adapter = createYouTubeAdapter({ fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect((err as PublishError).retryable).toBe(false);
  });

  it('refuses when the init response has no Location header', async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === 'https://cdn/clip.mp4') return new Response(new Uint8Array([1]).buffer);
      return new Response(null, { status: 200 });
    });
    const adapter = createYouTubeAdapter({ fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
  });

  it('treats a 5xx on the byte upload as retryable', async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u === 'https://cdn/clip.mp4') return new Response(new Uint8Array([1]).buffer);
      if (u.includes('/upload/youtube/v3/videos')) return new Response(null, { status: 200, headers: { location: 'https://upload.youtube.example/session/abc' } });
      return new Response('down', { status: 503 });
    });
    const adapter = createYouTubeAdapter({ fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect((err as PublishError).retryable).toBe(true);
  });

  it('treats a network failure as retryable', async () => {
    const f = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const adapter = createYouTubeAdapter({ fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect((err as PublishError).retryable).toBe(true);
  });
});

describe('delete', () => {
  it('DELETEs the video id, bearer-authorized with the token passed to delete', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 204 }));
    const adapter = createYouTubeAdapter({ fetchImpl: f as unknown as typeof fetch });
    await adapter.delete!('yt_1', 'youtube_shorts', 'tok_abc');
    expect(f.mock.calls[0]![0]).toBe('https://www.googleapis.com/youtube/v3/videos?id=yt_1');
    expect(((f.mock.calls[0]![1] as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer tok_abc');
  });

  it('refuses without a token', async () => {
    const adapter = createYouTubeAdapter();
    const err = await adapter.delete!('yt_1', 'youtube_shorts').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
  });
});

describe('registry contract', () => {
  it('supports only youtube_shorts', () => {
    const adapter = createYouTubeAdapter();
    expect(adapter.supports('youtube_shorts')).toBe(true);
    expect(adapter.supports('linkedin')).toBe(false);
  });

  it('names itself distinctly', () => {
    expect(createYouTubeAdapter().name).toBe('native:youtube');
  });
});
