import { describe, expect, it, vi } from 'vitest';
import { PublishError } from '../src/adapter.js';
import { createXAdapter } from '../src/native/xAdapter.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const req = {
  platform: 'x' as const,
  text: 'the fade finishing',
  mediaUrls: [] as string[],
  idempotencyKey: 'item_1:x',
  accessToken: 'tok_abc',
};

function mockUploadAndPostSuccess() {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u === 'https://cdn/img.png') return new Response(new Uint8Array([1, 2, 3]).buffer);
    if (u === 'https://upload.twitter.com/1.1/media/upload.json') {
      const body = init!.body;
      if (typeof body === 'string' && body.includes('command=INIT')) return json({ media_id_string: 'media_1' });
      if (body instanceof FormData) return new Response(null, { status: 204 });
      if (typeof body === 'string' && body.includes('command=FINALIZE')) return json({ media_id_string: 'media_1' });
      throw new Error('unexpected upload call');
    }
    if (u === 'https://api.x.com/2/tweets') return json({ data: { id: 'tw_1' } }, 201);
    throw new Error(`unexpected url ${u}`);
  });
}

describe('publish — text only', () => {
  it('posts without a media upload step, bearer-authorized', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ data: { id: 'tw_1' } }, 201));
    const adapter = createXAdapter({ fetchImpl: f as unknown as typeof fetch });
    const receipt = await adapter.publish(req);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![0]).toBe('https://api.x.com/2/tweets');
    const init = f.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok_abc');
    expect(JSON.parse(init.body as string)).toEqual({ text: 'the fade finishing' });
    expect(receipt).toMatchObject({ platform: 'x', externalId: 'tw_1', url: 'https://x.com/i/web/status/tw_1', via: 'native:x' });
  });
});

describe('publish — with media, chunked upload', () => {
  it('runs INIT, APPEND, FINALIZE, then posts referencing the media id', async () => {
    const f = mockUploadAndPostSuccess();
    const adapter = createXAdapter({ fetchImpl: f as unknown as typeof fetch });
    const receipt = await adapter.publish({ ...req, mediaUrls: ['https://cdn/img.png'] });

    const tweetCall = f.mock.calls.find((c) => String(c[0]) === 'https://api.x.com/2/tweets')!;
    expect(JSON.parse((tweetCall[1] as RequestInit).body as string)).toEqual({
      text: 'the fade finishing',
      media: { media_ids: ['media_1'] },
    });
    expect(receipt.externalId).toBe('tw_1');
  });

  it('refuses without an accessToken before attempting any upload', async () => {
    const f = vi.fn();
    const adapter = createXAdapter({ fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish({ ...req, mediaUrls: ['https://cdn/img.png'], accessToken: undefined }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect(f).not.toHaveBeenCalled();
  });

  it('surfaces an INIT failure classified by status', async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === 'https://cdn/img.png') return new Response(new Uint8Array([1]).buffer);
      return new Response('bad', { status: 401 });
    });
    const adapter = createXAdapter({ fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish({ ...req, mediaUrls: ['https://cdn/img.png'] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect((err as PublishError).retryable).toBe(false);
  });
});

describe('publish — tweet failure handling', () => {
  it('treats a 429 as retryable and honours Retry-After', async () => {
    const f = vi.fn(async () => new Response('slow down', { status: 429, headers: { 'retry-after': '3' } }));
    const adapter = createXAdapter({ fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect((err as PublishError).retryable).toBe(true);
    expect((err as PublishError).retryAfterMs).toBe(3000);
  });

  it('treats a structured 4xx error as not retryable', async () => {
    const f = vi.fn(async () => json({ title: 'Forbidden', detail: 'duplicate content' }, 403));
    const adapter = createXAdapter({ fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect((err as PublishError).message).toBe('duplicate content');
    expect((err as PublishError).retryable).toBe(false);
  });

  it('treats a network failure as retryable', async () => {
    const f = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const adapter = createXAdapter({ fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect((err as PublishError).retryable).toBe(true);
  });
});

describe('delete', () => {
  it('DELETEs the tweet id, bearer-authorized with the token passed to delete', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 204 }));
    const adapter = createXAdapter({ fetchImpl: f as unknown as typeof fetch });
    await adapter.delete!('tw_1', 'x', 'tok_abc');
    expect(f.mock.calls[0]![0]).toBe('https://api.x.com/2/tweets/tw_1');
    expect(((f.mock.calls[0]![1] as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer tok_abc');
  });

  it('refuses without a token', async () => {
    const adapter = createXAdapter();
    const err = await adapter.delete!('tw_1', 'x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
  });
});

describe('registry contract', () => {
  it('supports only x', () => {
    const adapter = createXAdapter();
    expect(adapter.supports('x')).toBe(true);
    expect(adapter.supports('youtube_shorts')).toBe(false);
  });

  it('names itself distinctly', () => {
    expect(createXAdapter().name).toBe('native:x');
  });
});
