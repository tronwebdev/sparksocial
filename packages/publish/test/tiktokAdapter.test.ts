import { describe, expect, it, vi } from 'vitest';
import { PublishError } from '../src/adapter.js';
import { createTikTokAdapter } from '../src/native/tiktokAdapter.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const success = () => ({ data: { publish_id: 'v_pub_url~abc' }, error: { code: 'ok', message: '', log_id: 'l1' } });

const req = {
  platform: 'tiktok' as const,
  text: 'the fade finishing',
  mediaUrls: ['https://cdn/clip.mp4'],
  idempotencyKey: 'item_1:tiktok',
  accessToken: 'tok_abc',
};

describe('publish', () => {
  it('posts PULL_FROM_URL with the caption as post_info.title, bearer-authorized', async () => {
    const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => json(success()));
    const adapter = createTikTokAdapter({ fetchImpl: f as unknown as typeof fetch });

    const receipt = await adapter.publish(req);

    expect(f.mock.calls[0]![0]).toBe('https://open.tiktokapis.com/v2/post/publish/video/init/');
    const init = f.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok_abc');
    const body = JSON.parse(init.body as string);
    expect(body.post_info.title).toBe('the fade finishing');
    expect(body.source_info).toEqual({ source: 'PULL_FROM_URL', video_url: 'https://cdn/clip.mp4' });
    expect(receipt).toMatchObject({ platform: 'tiktok', externalId: 'v_pub_url~abc', via: 'native:tiktok' });
  });

  it('refuses without an accessToken', async () => {
    const adapter = createTikTokAdapter();
    const err = await adapter.publish({ ...req, accessToken: undefined }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect((err as PublishError).retryable).toBe(false);
  });

  it('refuses a text-only post — TikTok requires video', async () => {
    const adapter = createTikTokAdapter();
    const err = await adapter.publish({ ...req, mediaUrls: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect((err as PublishError).message).toContain('requires a video');
  });

  it('treats a 200 response with a non-ok error code as a failure', async () => {
    const f = vi.fn(async () => json({ error: { code: 'spam_risk_too_many_posts', message: 'too many posts', log_id: 'l1' } }));
    const adapter = createTikTokAdapter({ fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect((err as PublishError).message).toBe('too many posts');
    expect((err as PublishError).retryable).toBe(false);
  });

  it('treats rate_limit_exceeded as retryable', async () => {
    const f = vi.fn(async () => json({ error: { code: 'rate_limit_exceeded', message: 'slow down', log_id: 'l1' } }));
    const adapter = createTikTokAdapter({ fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect((err as PublishError).retryable).toBe(true);
  });

  it('treats a 5xx transport failure as retryable', async () => {
    const f = vi.fn(async () => json({}, 503));
    const adapter = createTikTokAdapter({ fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect((err as PublishError).retryable).toBe(true);
  });

  it('treats a network failure as retryable', async () => {
    const f = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const adapter = createTikTokAdapter({ fetchImpl: f as unknown as typeof fetch });
    const err = await adapter.publish(req).catch((e: unknown) => e);
    expect((err as PublishError).retryable).toBe(true);
  });
});

describe('registry contract', () => {
  it('supports only tiktok', () => {
    const adapter = createTikTokAdapter();
    expect(adapter.supports('tiktok')).toBe(true);
    expect(adapter.supports('instagram')).toBe(false);
  });

  it('has no delete method — no publicly documented endpoint', () => {
    expect(createTikTokAdapter().delete).toBeUndefined();
  });

  it('names itself distinctly', () => {
    expect(createTikTokAdapter().name).toBe('native:tiktok');
  });
});
