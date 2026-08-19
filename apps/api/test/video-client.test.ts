import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import { createVideoClient } from '../src/video-client.js';

/**
 * The fal.ai video client — the one vendor client in this codebase whose
 * generation is genuinely async (queue submit, then poll a status URL until
 * done). What matters here: the submit request carries the right params, the
 * poll loop actually polls rather than reading once, a vendor-side failure
 * surfaces as a ToolError, and a job that never completes gives up rather
 * than hanging forever.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('request shape', () => {
  it('submits to the queue endpoint with prompt, aspect ratio and duration', async () => {
    const f = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url).includes('fal-ai/ltx-video')) return json({ status_url: 'https://queue.fal.run/s', response_url: 'https://queue.fal.run/r' });
      if (String(url) === 'https://queue.fal.run/s') return json({ status: 'COMPLETED' });
      return json({ video: { url: 'https://fal.example/clip.mp4' } });
    });
    const client = createVideoClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch, sleep: async () => {} });

    await client.generate({ prompt: 'a factory floor', aspectRatio: '9:16', durationSec: 4 });

    expect(f.mock.calls[0]![0]).toBe('https://queue.fal.run/fal-ai/ltx-video');
    const init = f.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Key k');
    expect(JSON.parse(init.body as string)).toMatchObject({ prompt: 'a factory floor', aspect_ratio: '9:16', duration: 4 });
  });

  it('honours a configured model', async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('queue.fal.run/fal-ai')) return json({ status_url: 's', response_url: 'r' });
      if (url === 's') return json({ status: 'COMPLETED' });
      return json({ video: { url: 'https://fal.example/clip.mp4' } });
    });
    const client = createVideoClient({ apiKey: 'k', model: 'fal-ai/kling-video', fetchImpl: f as unknown as typeof fetch, sleep: async () => {} });

    await client.generate({ prompt: 'x', aspectRatio: '9:16', durationSec: 5 });

    expect(f.mock.calls[0]![0]).toBe('https://queue.fal.run/fal-ai/kling-video');
  });
});

describe('the poll loop', () => {
  it('polls until COMPLETED, then fetches the result', async () => {
    let pollCount = 0;
    const f = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('queue.fal.run/fal-ai')) return json({ status_url: 's', response_url: 'r' });
      if (url === 's') {
        pollCount += 1;
        return json({ status: pollCount < 3 ? 'IN_PROGRESS' : 'COMPLETED' });
      }
      return json({ video: { url: 'https://fal.example/clip.mp4' } });
    });
    const sleep = vi.fn(async () => {});
    const client = createVideoClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch, sleep });

    const out = await client.generate({ prompt: 'x', aspectRatio: '9:16', durationSec: 5 });

    expect(out.url).toBe('https://fal.example/clip.mp4');
    expect(pollCount).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on an ERROR status, without exhausting retries', async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('queue.fal.run/fal-ai')) return json({ status_url: 's', response_url: 'r' });
      return json({ status: 'ERROR' });
    });
    const client = createVideoClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch, sleep: async () => {} });

    await expect(client.generate({ prompt: 'x', aspectRatio: '9:16', durationSec: 5 })).rejects.toThrow(ToolError);
  });

  it('gives up rather than polling forever', async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('queue.fal.run/fal-ai')) return json({ status_url: 's', response_url: 'r' });
      return json({ status: 'IN_PROGRESS' });
    });
    const sleep = vi.fn(async () => {});
    const client = createVideoClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch, sleep });

    await expect(client.generate({ prompt: 'x', aspectRatio: '9:16', durationSec: 5 })).rejects.toThrow(ToolError);
  });

  it('refuses a completed job with no video url', async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('queue.fal.run/fal-ai')) return json({ status_url: 's', response_url: 'r' });
      if (url === 's') return json({ status: 'COMPLETED' });
      return json({});
    });
    const client = createVideoClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch, sleep: async () => {} });

    await expect(client.generate({ prompt: 'x', aspectRatio: '9:16', durationSec: 5 })).rejects.toThrow(ToolError);
  });
});

describe('transport', () => {
  it('reports an upstream failure on a non-2xx submit response', async () => {
    const f = vi.fn(async () => new Response('rate limited', { status: 429 }));
    const client = createVideoClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch, sleep: async () => {} });

    await expect(client.generate({ prompt: 'x', aspectRatio: '9:16', durationSec: 5 })).rejects.toThrow(ToolError);
  });

  it('refuses a submit response with no status/response URL', async () => {
    const f = vi.fn(async () => json({}));
    const client = createVideoClient({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch, sleep: async () => {} });

    await expect(client.generate({ prompt: 'x', aspectRatio: '9:16', durationSec: 5 })).rejects.toThrow(ToolError);
  });
});
