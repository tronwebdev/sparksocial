import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import { createImageClient } from '../src/image-client.js';

/**
 * The fal.ai HTTP client. No dev-fallback tests here — `image-client.ts`
 * deliberately has none to fall back to (see its own comment on why a fake
 * image is not a degraded-but-usable stand-in the way a pseudo-embedding is).
 * What is tested is the transport contract: request shape, response parsing,
 * and that a bad response fails loudly rather than returning a broken URL.
 */

const respond = (body: unknown, status = 200) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

const client = (fetchImpl: typeof fetch, model?: string) =>
  createImageClient({ apiKey: 'k', fetchImpl, ...(model ? { model } : {}) });

describe('request shape', () => {
  it('posts to the default model with the key header', async () => {
    const f = respond({ images: [{ url: 'https://fal.example/out.png' }] });
    await client(f as unknown as typeof fetch).generate({ prompt: 'a quote card', aspectRatio: '1:1' });

    expect(f.mock.calls[0]![0]).toBe('https://fal.run/fal-ai/flux/schnell');
    const init = f.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Key k');
    expect(JSON.parse(init.body as string)).toMatchObject({ prompt: 'a quote card', image_size: 'square_hd' });
  });

  it('honours a configured model', async () => {
    const f = respond({ images: [{ url: 'https://fal.example/out.png' }] });
    await client(f as unknown as typeof fetch, 'fal-ai/flux-pro').generate({ prompt: 'x', aspectRatio: '1:1' });

    expect(f.mock.calls[0]![0]).toBe('https://fal.run/fal-ai/flux-pro');
  });

  it('maps every playbook-declared aspect ratio to a fal preset', async () => {
    const f = respond({ images: [{ url: 'https://fal.example/out.png' }] });
    const c = client(f as unknown as typeof fetch);

    const cases: Array<[string, string]> = [
      ['1:1', 'square_hd'],
      ['9:16', 'portrait_16_9'],
      ['16:9', 'landscape_16_9'],
      ['4:5', 'portrait_4_3'],
    ];
    for (const [aspectRatio, preset] of cases) {
      await c.generate({ prompt: 'x', aspectRatio });
      const body = JSON.parse(f.mock.calls.at(-1)![1]!.body as string);
      expect(body.image_size).toBe(preset);
    }
  });
});

describe('response handling', () => {
  it('returns the first image url', async () => {
    const f = respond({ images: [{ url: 'https://fal.example/card.png' }, { url: 'https://fal.example/other.png' }] });
    const out = await client(f as unknown as typeof fetch).generate({ prompt: 'x', aspectRatio: '1:1' });

    expect(out.url).toBe('https://fal.example/card.png');
  });

  it('refuses a response with no images', async () => {
    const f = respond({ images: [] });
    await expect(client(f as unknown as typeof fetch).generate({ prompt: 'x', aspectRatio: '1:1' }))
      .rejects.toThrow(/no image/i);
  });

  it('reports an upstream failure rather than a broken url', async () => {
    const f = vi.fn(async () => new Response('rate limited', { status: 429 }));
    await expect(client(f as unknown as typeof fetch).generate({ prompt: 'x', aspectRatio: '1:1' }))
      .rejects.toThrow(ToolError);
  });

  it('does not echo the whole provider error back — a prompt can describe private material', async () => {
    const f = vi.fn(async () => new Response('x'.repeat(5_000), { status: 400 }));
    await client(f as unknown as typeof fetch)
      .generate({ prompt: 'secret', aspectRatio: '1:1' })
      .catch((e: ToolError & { meta?: { detail?: string } }) => {
        expect((e.meta?.detail ?? '').length).toBeLessThanOrEqual(200);
      });
  });
});

/**
 * The heavier models are the whole reason `FAL_MODEL` exists, and they do not
 * answer the synchronous endpoint with an image — fal returns 200 with a queue
 * handle instead. This read `images[0].url` off that, found nothing, and raised
 * "response had no image": a successful submission reported as a vendor fault,
 * on exactly the models somebody switches to when the fast one looks wrong.
 */
describe('a model that queues instead of answering inline', () => {
  const queued = (frames: unknown[]) => {
    let call = 0;
    return vi.fn(async (url: string | URL | Request) => {
      const body = String(url).includes('/status')
        ? frames[Math.min(call++, frames.length - 1)]
        : String(url).includes('/result')
          ? { images: [{ url: 'https://fal.example/slow.png' }] }
          : { status_url: 'https://queue.fal.run/status', response_url: 'https://queue.fal.run/result' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
  };

  it('follows the queue handle to the finished image', async () => {
    const f = queued([{ status: 'IN_PROGRESS' }, { status: 'COMPLETED' }]);
    const out = await client(f as unknown as typeof fetch, 'fal-ai/flux-pro/v1.1').generate({
      prompt: 'a bicycle wheel in a truing stand',
      aspectRatio: '4:5',
    });

    expect(out.url).toBe('https://fal.example/slow.png');
    expect(String(f.mock.calls[0]![0])).toBe('https://fal.run/fal-ai/flux-pro/v1.1');
  });

  it('raises the vendor’s failure rather than a missing-image message', async () => {
    const f = queued([{ status: 'ERROR' }]);
    await expect(
      client(f as unknown as typeof fetch, 'fal-ai/flux-pro/v1.1').generate({ prompt: 'x', aspectRatio: '1:1' }),
    ).rejects.toThrow(/failed on the vendor side/);
  });

  it('still reads an inline image when the model answers with one', async () => {
    const f = respond({ images: [{ url: 'https://fal.example/fast.png' }] });
    const out = await client(f as unknown as typeof fetch).generate({ prompt: 'x', aspectRatio: '1:1' });
    expect(out.url).toBe('https://fal.example/fast.png');
  });
});
