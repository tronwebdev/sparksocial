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

  /*
   * The two character types are not interchangeable, and getting it wrong is
   * not caught anywhere upstream: HeyGen accepts the submit and the render
   * fails minutes later. `genome.avatar.from_image` mints `talking_photo_id`s,
   * so this branch is the whole reason the photo path can work at all.
   */
  it('sends a talking_photo character when the id came from a photo, not a trained avatar', async () => {
    const f = responder([
      () => json({ data: { video_id: 'v1' } }),
      () => json({ data: { status: 'completed', video_url: 'https://heygen.example/out.mp4' } }),
    ]);
    const client = createAvatarClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch, pollIntervalMs: 1 });

    await client.generate({ avatarId: 'tp_1', script: 'hello', aspectRatio: '9:16', avatarKind: 'talking_photo' });

    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.video_inputs[0].character).toEqual({ type: 'talking_photo', talking_photo_id: 'tp_1' });
    expect(body.video_inputs[0].character.avatar_id).toBeUndefined();
  });

  it('still defaults to a trained avatar, so every caller written before photos keeps working', async () => {
    const f = responder([
      () => json({ data: { video_id: 'v1' } }),
      () => json({ data: { status: 'completed', video_url: 'https://heygen.example/out.mp4' } }),
    ]);
    const client = createAvatarClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch, pollIntervalMs: 1 });

    await client.generate({ avatarId: 'av_1', script: 'hello', aspectRatio: '9:16' });

    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.video_inputs[0].character.type).toBe('avatar');
  });
});

describe('fromImage', () => {
  it('fetches the photo and posts the bytes to the upload host', async () => {
    const f = responder([
      () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
      () => json({ data: { talking_photo_id: 'tp_9' } }),
    ]);
    const client = createAvatarClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });

    const out = await client.fromImage!({ imageUrl: 'https://storage.example/f.jpg', contentType: 'image/jpeg' });

    expect(out).toEqual({ talkingPhotoId: 'tp_9' });
    // A different host from every other call in the client, and a raw body.
    expect(f.mock.calls[1]![0]).toBe('https://upload.heygen.com/v1/talking_photo');
    const init = f.mock.calls[1]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['content-type']).toBe('image/jpeg');
  });

  it('says a face was probably not found when HeyGen returns no id', async () => {
    const f = responder([
      () => new Response(new Uint8Array([1]), { status: 200 }),
      () => json({ data: {} }),
    ]);
    const client = createAvatarClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });

    await expect(
      client.fromImage!({ imageUrl: 'https://storage.example/f.jpg', contentType: 'image/jpeg' }),
    ).rejects.toThrow(/face/i);
  });

  it('fails readably when the uploaded photo can no longer be read', async () => {
    const f = responder([() => new Response('gone', { status: 403 })]);
    const client = createAvatarClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });

    await expect(
      client.fromImage!({ imageUrl: 'https://storage.example/f.jpg', contentType: 'image/jpeg' }),
    ).rejects.toThrow(ToolError);
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
