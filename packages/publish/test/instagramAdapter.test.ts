import { describe, expect, it, vi } from 'vitest';
import { PublishError } from '../src/adapter.js';
import { createInstagramAdapter } from '../src/native/instagramAdapter.js';
import { joinScopedToken } from '../src/native/scopedToken.js';

/**
 * Same caveat the adapter's own header states: no live Meta developer app to
 * pin the exact response shape against — these tests fix the two-step
 * request shape (Graph API's documented contract) and the adapter's own
 * error classification, not a vendor shape nobody here can verify.
 */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const req = {
  platform: 'instagram' as const,
  text: 'the fade finishing',
  mediaUrls: ['https://cdn/img.png'],
  idempotencyKey: 'item_1:instagram',
  accessToken: joinScopedToken('ig_user_1', 'tok_abc'),
};

describe('publish', () => {
  it('creates a media container then publishes it, in two calls', async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/media_publish')) return json({ id: 'media_final' });
      return json({ id: 'creation_1' });
    });
    const adapter = createInstagramAdapter({ fetchImpl: f as unknown as typeof fetch });

    const receipt = await adapter.publish(req);

    expect(f.mock.calls).toHaveLength(2);
    expect(String(f.mock.calls[0]![0])).toContain('/ig_user_1/media');
    expect(String(f.mock.calls[0]![0])).not.toContain('media_publish');
    expect(String(f.mock.calls[1]![0])).toContain('/ig_user_1/media_publish');
    expect(receipt).toMatchObject({ platform: 'instagram', externalId: 'media_final', via: 'native:instagram' });
  });

  it('sends image_url for a non-video media url and image caption', async () => {
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('media_publish')) return json({ id: 'media_final' });
      const body = new URLSearchParams(init!.body as string);
      expect(body.get('image_url')).toBe('https://cdn/img.png');
      expect(body.get('caption')).toBe('the fade finishing');
      expect(body.get('access_token')).toBe('tok_abc');
      return json({ id: 'creation_1' });
    });
    const adapter = createInstagramAdapter({ fetchImpl: f as unknown as typeof fetch });
    await adapter.publish(req);
    expect.assertions(3);
  });

  it('sends video_url + media_type REELS for a video url', async () => {
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('media_publish')) return json({ id: 'media_final' });
      const body = new URLSearchParams(init!.body as string);
      expect(body.get('video_url')).toBe('https://cdn/clip.mp4');
      expect(body.get('media_type')).toBe('REELS');
      return json({ id: 'creation_1' });
    });
    const adapter = createInstagramAdapter({ fetchImpl: f as unknown as typeof fetch });
    await adapter.publish({ ...req, mediaUrls: ['https://cdn/clip.mp4'] });
    expect.assertions(2);
  });

  it('refuses without an accessToken, naming the missing connection', async () => {
    const adapter = createInstagramAdapter();
    const err = await adapter.publish({ ...req, accessToken: undefined }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect((err as PublishError).message).toContain('connect one in Settings first');
    expect((err as PublishError).retryable).toBe(false);
  });

  it('classifies a Graph throttle code as retryable', async () => {
    const f = vi.fn(async () => json({ error: { message: 'rate limited', code: 4 } }, 400));
    const adapter = createInstagramAdapter({ fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect((err as PublishError).retryable).toBe(true);
  });

  it('classifies an ordinary Graph error (bad media url) as not retryable', async () => {
    const f = vi.fn(async () => json({ error: { message: 'Invalid image URL', code: 100 } }, 400));
    const adapter = createInstagramAdapter({ fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect((err as PublishError).message).toBe('Invalid image URL');
    expect((err as PublishError).retryable).toBe(false);
  });

  it('treats a 5xx as retryable', async () => {
    const f = vi.fn(async () => json({}, 503));
    const adapter = createInstagramAdapter({ fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect((err as PublishError).retryable).toBe(true);
  });

  it('treats a network failure as retryable', async () => {
    const f = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const adapter = createInstagramAdapter({ fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect((err as PublishError).retryable).toBe(true);
  });
});

describe('registry contract', () => {
  it('supports only instagram', () => {
    const adapter = createInstagramAdapter();
    expect(adapter.supports('instagram')).toBe(true);
    expect(adapter.supports('tiktok')).toBe(false);
  });

  it('has no delete method — Graph API has no documented endpoint for it', () => {
    const adapter = createInstagramAdapter();
    expect(adapter.delete).toBeUndefined();
  });

  it('names itself distinctly from the aggregator', () => {
    expect(createInstagramAdapter().name).toBe('native:instagram');
  });
});
