import { describe, expect, it, vi } from 'vitest';
import { PublishError } from '../src/adapter.js';
import { createAyrshareAdapter } from '../src/ayrshareAdapter.js';

/**
 * Same caveat `ayrshareAdapter.ts`'s header states: there is no live account
 * to pin the exact response shape against, so these tests fix the request
 * shape (which is Ayrshare's documented contract with reasonable confidence)
 * and the adapter's own handling of that envelope, rather than asserting a
 * vendor shape nobody here can verify.
 */

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const success = (over: Partial<Record<string, unknown>> = {}) => ({
  status: 'success',
  id: 'post_abc123',
  postIds: [{ platform: 'instagram', status: 'success', id: 'ig_1', postUrl: 'https://instagram.com/p/1', ...over }],
});

const req = {
  platform: 'instagram' as const,
  text: 'the fade finishing',
  mediaUrls: [],
  idempotencyKey: 'item_1:instagram',
};

describe('request shape', () => {
  it('posts the caption, mapped platform key and media urls, authorized with a bearer token', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json(success()));
    const adapter = createAyrshareAdapter({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });

    await adapter.publish({ ...req, mediaUrls: ['https://cdn/img.png'] });

    expect(f.mock.calls[0]![0]).toBe('https://api.ayrshare.com/api/post');
    const init = f.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ post: 'the fade finishing', platforms: ['instagram'], mediaUrls: ['https://cdn/img.png'] });
  });

  it('maps x to Ayrshare\'s "twitter" and youtube_shorts to "youtube"', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      json({ status: 'success', id: 'p1', postIds: [{ platform: 'twitter', status: 'success' }] }),
    );
    const adapter = createAyrshareAdapter({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });
    await adapter.publish({ ...req, platform: 'x' });
    expect(JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string).platforms).toEqual(['twitter']);

    const f2 = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      json({ status: 'success', id: 'p1', postIds: [{ platform: 'youtube', status: 'success' }] }),
    );
    const adapter2 = createAyrshareAdapter({ apiKey: 'k', fetchImpl: f2 as unknown as typeof fetch });
    await adapter2.publish({ ...req, platform: 'youtube_shorts' });
    expect(JSON.parse((f2.mock.calls[0]![1] as RequestInit).body as string).platforms).toEqual(['youtube']);
  });

  it('omits mediaUrls for a text-only post', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json(success()));
    const adapter = createAyrshareAdapter({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });
    await adapter.publish(req);
    expect(JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string)).not.toHaveProperty('mediaUrls');
  });
});

describe('response handling', () => {
  it('returns the top-level Ayrshare post id as externalId — the same id analytics.sync polls with', async () => {
    const f = vi.fn(async () => json(success()));
    const adapter = createAyrshareAdapter({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });
    const receipt = await adapter.publish(req);
    expect(receipt).toMatchObject({
      platform: 'instagram',
      externalId: 'post_abc123',
      url: 'https://instagram.com/p/1',
      via: 'aggregator:ayrshare',
    });
    expect(receipt.publishedAt).toBeInstanceOf(Date);
  });

  it('omits url when Ayrshare does not return one', async () => {
    const f = vi.fn(async () =>
      json({ status: 'success', id: 'p1', postIds: [{ platform: 'instagram', status: 'success', id: 'ig_1' }] }),
    );
    const adapter = createAyrshareAdapter({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });
    const receipt = await adapter.publish(req);
    expect(receipt).not.toHaveProperty('url');
  });

  it('treats a platform-level failure inside a 200 response as PublishError, not a success', async () => {
    const f = vi.fn(async () =>
      json({
        status: 'success',
        id: 'p1',
        postIds: [{ platform: 'instagram', status: 'error', errors: [{ message: 'caption too long' }] }],
      }),
    );
    const adapter = createAyrshareAdapter({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect((err as PublishError).message).toContain('caption too long');
    expect((err as PublishError).retryable).toBe(false);
  });

  it('treats a missing result for the requested platform the same as a failure', async () => {
    const f = vi.fn(async () => json({ status: 'success', id: 'p1', postIds: [{ platform: 'tiktok', status: 'success' }] }));
    const adapter = createAyrshareAdapter({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });
    await expect(adapter.publish(req)).rejects.toThrow(PublishError);
  });
});

describe('transport', () => {
  it('reports a 5xx as retryable', async () => {
    const f = vi.fn(async () => new Response('down', { status: 502 }));
    const adapter = createAyrshareAdapter({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect((err as PublishError).retryable).toBe(true);
  });

  it('reports a 429 as retryable and honours Retry-After', async () => {
    const f = vi.fn(async () => new Response('slow down', { status: 429, headers: { 'retry-after': '5' } }));
    const adapter = createAyrshareAdapter({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect((err as PublishError).retryable).toBe(true);
    expect((err as PublishError).retryAfterMs).toBe(5000);
  });

  it('reports a 400 as not retryable', async () => {
    const f = vi.fn(async () => new Response('bad request', { status: 400 }));
    const adapter = createAyrshareAdapter({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect((err as PublishError).retryable).toBe(false);
  });

  it('treats a network failure as retryable rather than a permanent rejection', async () => {
    const f = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const adapter = createAyrshareAdapter({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect((err as PublishError).retryable).toBe(true);
  });
});

describe('registry contract', () => {
  it('claims support for every platform, since Ayrshare covers all of them today', () => {
    const adapter = createAyrshareAdapter({ apiKey: 'k' });
    for (const platform of ['instagram', 'tiktok', 'linkedin', 'x', 'youtube_shorts'] as const) {
      expect(adapter.supports(platform)).toBe(true);
    }
  });

  it('names itself distinctly from the stub, so publish.status shows the real adapter', () => {
    const adapter = createAyrshareAdapter({ apiKey: 'k' });
    expect(adapter.name).toBe('aggregator:ayrshare');
  });
});
