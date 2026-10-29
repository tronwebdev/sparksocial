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

describe('submit — HeyGen v3 (v1/v2 retire on 2026-10-31)', () => {
  it('posts the avatar id, script and aspect ratio to /v3/videos, and polls /v3/videos/{id}', async () => {
    const f = responder([
      () => json({ data: { video_id: 'v1', status: 'waiting' } }),
      () => json({ data: { id: 'v1', status: 'completed', video_url: 'https://heygen.example/out.mp4' } }),
    ]);
    const client = createAvatarClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch, pollIntervalMs: 1 });

    const out = await client.generate({ avatarId: 'av_1', script: 'hello', aspectRatio: '9:16' });

    expect(out.url).toBe('https://heygen.example/out.mp4');
    expect(f.mock.calls[0]![0]).toBe('https://api.heygen.com/v3/videos');
    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ type: 'avatar', avatar_id: 'av_1', script: 'hello', aspect_ratio: '9:16' });
    expect(f.mock.calls[1]![0]).toBe('https://api.heygen.com/v3/videos/v1');
  });

  /*
   * A photo avatar is an avatar in v3 — `talking_photo` is no longer a
   * character type. A caller still passing `avatarKind: 'talking_photo'` (the
   * photo path does) must get the same request, not a v2 shape v3 rejects.
   */
  it('sends a photo avatar exactly as it sends a trained one', async () => {
    const f = responder([
      () => json({ data: { video_id: 'v1' } }),
      () => json({ data: { status: 'completed', video_url: 'https://heygen.example/out.mp4' } }),
    ]);
    const client = createAvatarClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch, pollIntervalMs: 1 });

    await client.generate({ avatarId: 'pa_1', script: 'hello', aspectRatio: '1:1', avatarKind: 'talking_photo' });

    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ type: 'avatar', avatar_id: 'pa_1', script: 'hello', aspect_ratio: '1:1' });
  });

  it('renders vertical for a ratio v3 does not take', async () => {
    const f = responder([
      () => json({ data: { video_id: 'v1' } }),
      () => json({ data: { status: 'completed', video_url: 'https://heygen.example/out.mp4' } }),
    ]);
    const client = createAvatarClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch, pollIntervalMs: 1 });

    await client.generate({ avatarId: 'av_1', script: 'hello', aspectRatio: '3:2' });
    expect(JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string).aspect_ratio).toBe('9:16');
  });

  /* Seen live on 29 Oct: v3 answers a credit shortfall with 402. */
  it('reports our missing credit as ours, not as a broken post', async () => {
    const f = responder([
      () =>
        json(
          { error: { code: 'insufficient_credit', message: 'Insufficient credits. Upgrade to continue.' } },
          402,
        ),
    ]);
    const client = createAvatarClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });

    await expect(client.generate({ avatarId: 'av_1', script: 'x', aspectRatio: '9:16' })).rejects.toThrow(
      /temporarily unavailable/i,
    );
  });
});

describe('fromImage — v3 asset, then photo avatar', () => {
  it('uploads the photo as a multipart asset, then creates a photo avatar from it', async () => {
    const f = responder([
      () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
      () => json({ data: { asset_id: 'asset_9', url: 'https://x', mime_type: 'image/jpeg', size_bytes: 3 } }),
      () => json({ data: { avatar_item: { id: 'pa_9' } } }),
    ]);
    const client = createAvatarClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });

    const out = await client.fromImage!({ imageUrl: 'https://storage.example/f.jpg', contentType: 'image/jpeg' });

    expect(out).toEqual({ talkingPhotoId: 'pa_9' });
    expect(f.mock.calls[1]![0]).toBe('https://api.heygen.com/v3/assets');
    const upload = f.mock.calls[1]![1] as RequestInit;
    expect(upload.body).toBeInstanceOf(FormData);
    expect((upload.body as FormData).get('file')).toBeInstanceOf(Blob);

    expect(f.mock.calls[2]![0]).toBe('https://api.heygen.com/v3/avatars');
    const created = JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string);
    expect(created).toMatchObject({ type: 'photo', file: { type: 'asset_id', asset_id: 'asset_9' } });
  });

  it('says a face was probably not found when HeyGen returns no avatar id', async () => {
    const f = responder([
      () => new Response(new Uint8Array([1]), { status: 200 }),
      () => json({ data: { asset_id: 'asset_1' } }),
      () => json({ data: {} }),
    ]);
    const client = createAvatarClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });

    await expect(
      client.fromImage!({ imageUrl: 'https://storage.example/f.jpg', contentType: 'image/jpeg' }),
    ).rejects.toThrow(/face/i);
  });

  it('does not blame the photo for a v3 credit refusal', async () => {
    const f = responder([
      () => new Response(new Uint8Array([1]), { status: 200 }),
      () => json({ error: { code: 'insufficient_credit', message: 'Insufficient credits.' } }, 402),
    ]);
    const client = createAvatarClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });

    await expect(
      client.fromImage!({ imageUrl: 'https://storage.example/f.jpg', contentType: 'image/jpeg' }),
    ).rejects.toThrow(/nothing is wrong with your photo/i);
  });

  it('fails readably when the uploaded photo can no longer be read', async () => {
    const f = responder([() => new Response('gone', { status: 403 })]);
    const client = createAvatarClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });

    await expect(
      client.fromImage!({ imageUrl: 'https://storage.example/f.jpg', contentType: 'image/jpeg' }),
    ).rejects.toThrow(ToolError);
  });

  it('refuses a response with no video id', async () => {
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
      () => json({ data: { status: 'failed', failure_code: 'bad_prompt', failure_message: 'bad prompt' } }),
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
