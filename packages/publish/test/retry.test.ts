import { describe, expect, it, vi } from 'vitest';
import { PublishError, createStubAdapter } from '../src/adapter.js';
import {
  DEFAULT_BUDGETS,
  DEFAULT_RETRY,
  backoffMs,
  createRateLimiter,
  publishWithRetry,
} from '../src/retry.js';

/**
 * Publishing is the one place a bug is visible to somebody else's audience and
 * cannot be taken back. The two failure modes these tests exist for are
 * double-posting and retrying a rate limit into a suspension — not throughput.
 */

const req = (over: Partial<Parameters<typeof publishWithRetry>[0]> = {}) => ({
  platform: 'instagram' as const,
  text: 'hello',
  mediaUrls: [],
  idempotencyKey: 'item_1:instagram',
  ...over,
});

const noSleep = async () => {};

describe('backoffMs', () => {
  it('grows exponentially and stays under the cap', () => {
    const full = () => 1; // full jitter at its maximum
    expect(backoffMs(1, DEFAULT_RETRY, full)).toBe(1_000);
    expect(backoffMs(2, DEFAULT_RETRY, full)).toBe(2_000);
    expect(backoffMs(3, DEFAULT_RETRY, full)).toBe(4_000);
    expect(backoffMs(20, DEFAULT_RETRY, full)).toBe(DEFAULT_RETRY.maxDelayMs);
  });

  it('jitters, so a 09:00 cluster does not retry in lockstep', () => {
    // Scheduled posts bunch on round times across every brand in a workspace.
    // A fixed backoff makes that whole cluster hit the platform together, which
    // is the pattern rate limiters punish.
    const delays = new Set(Array.from({ length: 20 }, () => backoffMs(3, DEFAULT_RETRY)));
    expect(delays.size).toBeGreaterThan(1);
    for (const d of delays) expect(d).toBeLessThanOrEqual(4_000);
  });
});

describe('publishWithRetry', () => {
  it('returns on first success without sleeping', async () => {
    const publish = vi.fn(async () => ({
      platform: 'instagram' as const, externalId: 'x', via: 'stub', publishedAt: new Date(),
    }));
    const sleep = vi.fn(noSleep);

    await publishWithRetry(req(), { publish, sleep });

    expect(publish).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a retryable failure and succeeds', async () => {
    let n = 0;
    const publish = vi.fn(async () => {
      if (++n < 3) throw new PublishError('instagram', 'upstream hiccup', true);
      return { platform: 'instagram' as const, externalId: 'ok', via: 'stub', publishedAt: new Date() };
    });

    const out = await publishWithRetry(req(), { publish, sleep: noSleep });

    expect(out.externalId).toBe('ok');
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it('aborts immediately on a permanent failure instead of burning attempts', async () => {
    // A caption over the length limit fails identically on attempt three, and
    // those attempts cost rate budget a transient failure elsewhere may need.
    const publish = vi.fn(async () => {
      throw new PublishError('instagram', 'caption too long', false);
    });

    await expect(publishWithRetry(req(), { publish, sleep: noSleep })).rejects.toThrow('caption too long');
    expect(publish).toHaveBeenCalledOnce();
  });

  it('sends the same idempotency key on every attempt', async () => {
    // The key is what stops a retry becoming a second post on a real feed.
    const seen: string[] = [];
    let n = 0;
    const publish = vi.fn(async (r: { idempotencyKey: string }) => {
      seen.push(r.idempotencyKey);
      if (++n < 3) throw new PublishError('instagram', 'flaky', true);
      return { platform: 'instagram' as const, externalId: 'ok', via: 'stub', publishedAt: new Date() };
    });

    await publishWithRetry(req(), { publish, sleep: noSleep });

    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(1);
  });

  it('honours a platform-supplied Retry-After over its own curve', async () => {
    // The platform knows when it will accept traffic again; guessing shorter is
    // how a 429 becomes a suspension.
    const delays: number[] = [];
    let n = 0;
    const publish = async () => {
      if (++n === 1) throw new PublishError('instagram', 'slow down', true, 45_000);
      return { platform: 'instagram' as const, externalId: 'ok', via: 'stub', publishedAt: new Date() };
    };

    await publishWithRetry(req(), { publish, sleep: async (ms) => void delays.push(ms) });

    expect(delays).toEqual([45_000]);
  });

  it('stops at maxAttempts and surfaces the last error', async () => {
    const publish = vi.fn(async () => {
      throw new PublishError('instagram', 'still down', true);
    });

    await expect(publishWithRetry(req(), { publish, sleep: noSleep })).rejects.toThrow('still down');
    expect(publish).toHaveBeenCalledTimes(DEFAULT_RETRY.maxAttempts);
  });

  it('treats an unclassified throw as retryable rather than dropping the post', async () => {
    let n = 0;
    const publish = async () => {
      if (++n === 1) throw new Error('socket hang up');
      return { platform: 'instagram' as const, externalId: 'ok', via: 'stub', publishedAt: new Date() };
    };

    const out = await publishWithRetry(req(), { publish, sleep: noSleep });
    expect(out.externalId).toBe('ok');
  });
});

describe('createRateLimiter', () => {
  const now = new Date('2026-09-01T09:00:00.000Z');
  const later = (ms: number) => new Date(now.getTime() + ms);

  it('allows up to the platform budget and then refuses', () => {
    const limiter = createRateLimiter();
    const budget = DEFAULT_BUDGETS.youtube_shorts.perWindow;

    for (let i = 0; i < budget; i++) {
      expect(limiter.tryConsume('brand_1', 'youtube_shorts', now), `post ${i}`).toBe(true);
    }
    expect(limiter.tryConsume('brand_1', 'youtube_shorts', now)).toBe(false);
    expect(limiter.remaining('brand_1', 'youtube_shorts', now)).toBe(0);
  });

  it('counts per brand, so one client cannot starve another', () => {
    // An agency workspace runs forty clients against separate connected
    // accounts; platform limits apply per account, not per workspace.
    const limiter = createRateLimiter();
    const budget = DEFAULT_BUDGETS.youtube_shorts.perWindow;

    for (let i = 0; i < budget; i++) limiter.tryConsume('brand_busy', 'youtube_shorts', now);

    expect(limiter.tryConsume('brand_busy', 'youtube_shorts', now)).toBe(false);
    expect(limiter.tryConsume('brand_quiet', 'youtube_shorts', now)).toBe(true);
  });

  it('counts per platform, so a busy channel does not block a quiet one', () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < DEFAULT_BUDGETS.youtube_shorts.perWindow; i++) {
      limiter.tryConsume('brand_1', 'youtube_shorts', now);
    }
    expect(limiter.tryConsume('brand_1', 'youtube_shorts', now)).toBe(false);
    expect(limiter.tryConsume('brand_1', 'x', now)).toBe(true);
  });

  it('frees budget as the window slides', () => {
    const limiter = createRateLimiter();
    const { perWindow, windowMs } = DEFAULT_BUDGETS.youtube_shorts;

    for (let i = 0; i < perWindow; i++) limiter.tryConsume('brand_1', 'youtube_shorts', now);
    expect(limiter.tryConsume('brand_1', 'youtube_shorts', now)).toBe(false);

    // Just inside the window: still refused. Past it: allowed again.
    expect(limiter.tryConsume('brand_1', 'youtube_shorts', later(windowMs - 1_000))).toBe(false);
    expect(limiter.tryConsume('brand_1', 'youtube_shorts', later(windowMs + 1_000))).toBe(true);
  });

  it('reports remaining budget for the health surface', () => {
    const limiter = createRateLimiter();
    const budget = DEFAULT_BUDGETS.x.perWindow;
    expect(limiter.remaining('brand_1', 'x', now)).toBe(budget);
    limiter.tryConsume('brand_1', 'x', now);
    expect(limiter.remaining('brand_1', 'x', now)).toBe(budget - 1);
  });
});

describe('stub adapter', () => {
  it('replays a repeated idempotency key instead of posting twice', async () => {
    // A stub that double-posted would hide the exact bug the key exists for.
    const adapter = createStubAdapter();
    const first = await adapter.publish(req());
    const second = await adapter.publish(req());

    expect(first.externalId).not.toBe(second.externalId);
    expect(second.externalId).toContain('replay');
  });
});
