import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import { createAvatarClient } from '../src/avatar-client.js';

/**
 * The HeyGen client — the one vendor call in this codebase that is a job
 * queue, not a request/response. What's tested is the submit-then-poll loop:
 * that it submits the right shape, keeps polling through `processing`, stops
 * on `completed`/`failed`, and gives up loudly on a timeout rather than
 * hanging or returning a broken url.
 */

function responder(handlers: Array<(url: string, init?: RequestInit) => Response>) {
  let call = 0;
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const handler = handlers[Math.min(call, handlers.length - 1)]!;
    call++;
    return handler(String(url), init);
  });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('submit', () => {
  it('posts the avatar id, script and mapped dimensions', async () => {
    const f = responder([
      () => json({ data: { video_id: 'v1' } }),
      () => json({ data: { status: 'completed', video_url: 'https://heygen.example/out.mp4' } }),
    ]);
    const client = createAvatarClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch, pollIntervalMs: 1 });

    await client.generate({ avatarId: 'av_1', script: 'hello', aspectRatio: '9:16' });

    expect(f.mock.calls[0]![0]).toBe('https://api.heygen.com/v2/video/generate');
    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.video_inputs[0].character).toMatchObject({ type: 'avatar', avatar_id: 'av_1' });
    expect(body.video_inputs[0].voice).toMatchObject({ type: 'text', input_text: 'hello' });
    expect(body.dimension).toEqual({ width: 720, height: 1280 });
  });

  it('refuses a response with no video_id', async () => {
    const f = responder([() => json({ data: {} })]);
    const client = createAvatarClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch, pollIntervalMs: 1 });

    await expect(client.generate({ avatarId: 'av_1', script: 'x', aspectRatio: '9:16' })).rejects.toThrow(ToolError);
  });
});

describe('polling', () => {
  it('keeps polling through processing and returns the url once completed', async () => {
    const f = responder([
      () => json({ data: { video_id: 'v1' } }),
      () => json({ data: { status: 'processing' } }),
      () => json({ data: { status: 'processing' } }),
      () => json({ data: { status: 'completed', video_url: 'https://heygen.example/final.mp4' } }),
    ]);
    const client = createAvatarClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch, pollIntervalMs: 1 });

    const out = await client.generate({ avatarId: 'av_1', script: 'x', aspectRatio: '9:16' });
    expect(out.url).toBe('https://heygen.example/final.mp4');
    expect(f).toHaveBeenCalledTimes(4);
  });

  it('stops and throws on a failed render rather than polling forever', async () => {
    const f = responder([
      () => json({ data: { video_id: 'v1' } }),
      () => json({ data: { status: 'failed', error: 'bad prompt' } }),
    ]);
    const client = createAvatarClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch, pollIntervalMs: 1 });

    await expect(client.generate({ avatarId: 'av_1', script: 'x', aspectRatio: '9:16' })).rejects.toThrow(ToolError);
  });

  it('gives up loudly after the timeout rather than hanging', async () => {
    const f = responder([
      () => json({ data: { video_id: 'v1' } }),
      () => json({ data: { status: 'processing' } }),
    ]);
    const client = createAvatarClient({
      apiKey: 'k', fetchImpl: f as unknown as typeof fetch, pollIntervalMs: 5, timeoutMs: 12,
    });

    await expect(client.generate({ avatarId: 'av_1', script: 'x', aspectRatio: '9:16' }))
      .rejects.toThrow(/did not complete/);
  });
});

describe('transport', () => {
  it('reports an upstream failure on a non-2xx response', async () => {
    const f = vi.fn(async () => new Response('rate limited', { status: 429 }));
    const client = createAvatarClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });

    await expect(client.generate({ avatarId: 'av_1', script: 'x', aspectRatio: '9:16' })).rejects.toThrow(ToolError);
  });
});
