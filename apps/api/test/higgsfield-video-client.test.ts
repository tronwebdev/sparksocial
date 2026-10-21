import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import { createHiggsfieldVideoClient } from '../src/higgsfield-video-client.js';

/**
 * Higgsfield, the video backup behind fal.
 *
 * The lifecycle is close enough to fal's that the interesting tests are the
 * four places it differs: a two-part credential, a status body that carries the
 * output rather than pointing at it, four terminal states rather than two, and
 * growing backoff rather than a flat interval.
 *
 * `nsfw` gets the most attention here for its size, because it is the one state
 * whose *error code* changes behaviour somewhere else: `withFallback` retries
 * `UPSTREAM_FAILED` and nothing else, so classifying a moderation refusal
 * wrongly would send a prompt the first model refused to a second one — slowly,
 * and for money the vendor would otherwise not have charged.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const STATUS_URL = 'https://api.higgsfield.ai/requests/req-1/status';

/** Submit, then `statuses` in order, one per poll. */
function vendor(statuses: unknown[]) {
  let polls = 0;
  const fetchImpl = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    if (String(url) === STATUS_URL) return json(statuses[Math.min(polls++, statuses.length - 1)]);
    return json({ status: 'queued', request_id: 'req-1', status_url: STATUS_URL });
  });
  return { fetchImpl, polls: () => polls };
}

function client(fetchImpl: ReturnType<typeof vi.fn>, sleeps: number[] = []) {
  return createHiggsfieldVideoClient({
    keyId: 'id',
    keySecret: 'secret',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    random: () => 0,
  });
}

describe('request shape', () => {
  it('submits to the model endpoint with both halves of the credential', async () => {
    const { fetchImpl } = vendor([{ status: 'completed', video: { url: 'https://hf.example/clip.mp4' } }]);

    const out = await client(fetchImpl).generate({ prompt: 'a kiln firing', aspectRatio: '9:16', durationSec: 6 });

    expect(out).toEqual({ url: 'https://hf.example/clip.mp4' });
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.higgsfield.ai/kling-video/v3.0/std/text-to-video');
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    // One header, both halves, colon-separated — not a bearer token.
    expect(headers.authorization).toBe('Key id:secret');
    expect(headers['idempotency-key']).toMatch(/[0-9a-f-]{36}/);
    expect(JSON.parse(init.body as string)).toMatchObject({
      prompt: 'a kiln firing',
      aspect_ratio: '9:16',
      duration: 6,
    });
  });

  it('honours a configured endpoint id exactly as the vendor prints it', async () => {
    const { fetchImpl } = vendor([{ status: 'completed', video: { url: 'https://hf.example/c.mp4' } }]);

    await createHiggsfieldVideoClient({
      keyId: 'id',
      keySecret: 'secret',
      model: 'minimax/hailuo-2.3/standard/text-to-video',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    }).generate({ prompt: 'x', aspectRatio: '16:9', durationSec: 6 });

    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.higgsfield.ai/minimax/hailuo-2.3/standard/text-to-video');
  });

  it('sends a vertical ratio for anything it does not recognise', async () => {
    // The playbooks declare 9:16, 16:9 and 1:1; anything else is a caller bug,
    // and a vertical clip is the least wrong thing to make for this product.
    const { fetchImpl } = vendor([{ status: 'completed', video: { url: 'https://hf.example/c.mp4' } }]);

    await client(fetchImpl).generate({ prompt: 'x', aspectRatio: '4:5', durationSec: 5 });

    expect(JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string).aspect_ratio).toBe('9:16');
  });
});

describe('the poll loop', () => {
  it('reads the finished clip out of the status body itself', async () => {
    // fal needs a second fetch against `response_url` once status says
    // COMPLETED. Higgsfield's status body *is* the result, so a completed poll
    // is the last request made.
    const { fetchImpl } = vendor([
      { status: 'queued' },
      { status: 'in_progress' },
      { status: 'completed', video: { url: 'https://hf.example/done.mp4' } },
    ]);

    const out = await client(fetchImpl).generate({ prompt: 'x', aspectRatio: '9:16', durationSec: 5 });

    expect(out.url).toBe('https://hf.example/done.mp4');
    // submit + three polls, and nothing after the completed one.
    expect(fetchImpl.mock.calls).toHaveLength(4);
  });

  it('backs off from two seconds towards ten', async () => {
    // The vendor asks for this specifically. With jitter pinned to zero the
    // sequence is exactly 2000, 3000, 4500 — growth, and a ceiling.
    const sleeps: number[] = [];
    const { fetchImpl } = vendor([
      { status: 'queued' },
      { status: 'queued' },
      { status: 'queued' },
      { status: 'completed', video: { url: 'https://hf.example/c.mp4' } },
    ]);

    await client(fetchImpl, sleeps).generate({ prompt: 'x', aspectRatio: '9:16', durationSec: 5 });

    expect(sleeps).toEqual([2_000, 3_000, 4_500]);
  });

  it('polls with the credential too, not just the submit', async () => {
    const { fetchImpl } = vendor([{ status: 'completed', video: { url: 'https://hf.example/c.mp4' } }]);

    await client(fetchImpl).generate({ prompt: 'x', aspectRatio: '9:16', durationSec: 5 });

    const pollInit = fetchImpl.mock.calls[1]![1] as RequestInit;
    expect((pollInit.headers as Record<string, string>).authorization).toBe('Key id:secret');
  });

  it('uses the status URL the vendor returned rather than building one', async () => {
    // Their docs say so explicitly, and a constructed URL is a second copy of
    // their routing that goes stale without warning.
    const fetchImpl = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url) === 'https://api.higgsfield.ai/elsewhere/req-9/status') {
        return json({ status: 'completed', video: { url: 'https://hf.example/c.mp4' } });
      }
      return json({ status: 'queued', request_id: 'req-9', status_url: 'https://api.higgsfield.ai/elsewhere/req-9/status' });
    });

    await client(fetchImpl).generate({ prompt: 'x', aspectRatio: '9:16', durationSec: 5 });

    expect(fetchImpl.mock.calls[1]![0]).toBe('https://api.higgsfield.ai/elsewhere/req-9/status');
  });
});

describe('terminal states', () => {
  it('treats a moderation refusal as a guardrail, not an upstream failure', async () => {
    // The load-bearing one. `withFallback` retries `UPSTREAM_FAILED` only, so
    // this code is what stops a refused prompt being sent to a second vendor.
    const { fetchImpl } = vendor([{ status: 'nsfw', request_id: 'req-1' }]);

    await expect(client(fetchImpl).generate({ prompt: 'x', aspectRatio: '9:16', durationSec: 5 })).rejects.toMatchObject(
      { code: 'GUARDRAIL_BLOCKED' },
    );
  });

  it('reports a failure with whatever the vendor said about it', async () => {
    const { fetchImpl } = vendor([{ status: 'failed', error: 'Generation failed' }]);

    const err = await client(fetchImpl)
      .generate({ prompt: 'x', aspectRatio: '9:16', durationSec: 5 })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe('UPSTREAM_FAILED');
    expect((err as ToolError).message).toContain('Generation failed');
  });

  it('treats a cancellation as a failure rather than waiting it out', async () => {
    const { fetchImpl } = vendor([{ status: 'canceled' }]);

    await expect(client(fetchImpl).generate({ prompt: 'x', aspectRatio: '9:16', durationSec: 5 })).rejects.toMatchObject(
      { code: 'UPSTREAM_FAILED' },
    );
  });

  it('does not accept a completed clip with no video', async () => {
    const { fetchImpl } = vendor([{ status: 'completed' }]);

    await expect(client(fetchImpl).generate({ prompt: 'x', aspectRatio: '9:16', durationSec: 5 })).rejects.toThrow(
      /no video/i,
    );
  });
});

describe('vendor errors', () => {
  it('says "out of credit" for a 403, in words an owner can act on', async () => {
    // This is the failure the whole fallback exists for, and the sentence a
    // user sees when *both* vendors are out.
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response('{"detail":"Insufficient credits"}', { status: 403 }),
    );

    const err = await client(fetchImpl as unknown as ReturnType<typeof vi.fn>)
      .generate({ prompt: 'x', aspectRatio: '9:16', durationSec: 5 })
      .catch((e: unknown) => e);

    expect((err as ToolError).message).toMatch(/run out of credit/i);
    expect((err as ToolError).meta).toMatchObject({ vendor: 'Higgsfield', status: 403 });
  });

  it('distinguishes a blocked model from a broken account', async () => {
    // 423 and 503 are the vendor's own: the model is blocked or not ready.
    // "Try again in a few minutes" is true for those and a lie for a 403.
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response('{"detail":"Model disabled"}', { status: 503 }),
    );

    const err = await client(fetchImpl as unknown as ReturnType<typeof vi.fn>)
      .generate({ prompt: 'x', aspectRatio: '9:16', durationSec: 5 })
      .catch((e: unknown) => e);

    expect((err as ToolError).message).toMatch(/model is unavailable/i);
    expect((err as ToolError).meta).toMatchObject({ operator: expect.stringContaining('blocked or not ready') });
  });

  it('gives up rather than polling a stuck job forever', async () => {
    const { fetchImpl } = vendor([{ status: 'in_progress' }]);

    await expect(client(fetchImpl).generate({ prompt: 'x', aspectRatio: '9:16', durationSec: 5 })).rejects.toThrow(
      /did not finish/i,
    );
  });

  it('refuses a submission that comes back without a status URL', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      json({ status: 'queued', request_id: 'req-1' }),
    );

    await expect(
      client(fetchImpl as unknown as ReturnType<typeof vi.fn>).generate({
        prompt: 'x',
        aspectRatio: '9:16',
        durationSec: 5,
      }),
    ).rejects.toThrow(/no status URL/i);
  });
});
