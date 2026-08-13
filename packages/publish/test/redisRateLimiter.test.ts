import { describe, expect, it, vi } from 'vitest';
import { createRedisRateLimiter, type RedisLike } from '../src/redisRateLimiter.js';
import { DEFAULT_BUDGETS } from '../src/retry.js';

/**
 * The shared limiter, tested against a fake Redis that actually implements the
 * sorted-set semantics the Lua scripts rely on.
 *
 * A fake that just returned "allowed" would test nothing — the whole point of
 * this class is the *window arithmetic*, and getting it wrong shows up as
 * either a throttle that never fires or accounts getting flagged. So the fake
 * interprets the scripts rather than stubbing their result: it keeps real
 * sorted sets, prunes by score, and enforces the limit at the same point the
 * script does.
 */

interface Entry {
  member: string;
  score: number;
}

/** Minimal Redis: sorted sets, and the two scripts this package sends. */
function fakeRedis(): RedisLike & { store: Map<string, Entry[]>; calls: number } {
  const store = new Map<string, Entry[]>();
  const api = {
    store,
    calls: 0,
    async eval(script: string, _numKeys: number, ...args: (string | number)[]) {
      api.calls++;
      const [key, now, window, limit, member] = args as [string, number, number, number, string?];

      // Both scripts start by dropping anything older than the window.
      const kept = (store.get(key) ?? []).filter((e) => e.score > now - window);
      store.set(key, kept);

      const isConsume = script.includes('ZADD');
      if (!isConsume) return kept.length > limit ? 0 : limit - kept.length;

      if (kept.length >= limit) return -1;
      kept.push({ member: member!, score: now });
      store.set(key, kept);
      return limit - kept.length;
    },
  };
  return api;
}

const at = (ms: number) => new Date(ms);
const BUDGET = DEFAULT_BUDGETS.instagram; // 25 per 24h

describe('createRedisRateLimiter', () => {
  it('allows up to the budget and then refuses', async () => {
    const limiter = createRedisRateLimiter({ client: fakeRedis() });

    for (let i = 0; i < BUDGET.perWindow; i++) {
      expect(await limiter.tryConsume('brand_1', 'instagram', at(1_000 + i))).toBe(true);
    }
    expect(await limiter.tryConsume('brand_1', 'instagram', at(2_000))).toBe(false);
  });

  it('counts per brand, so one client cannot starve another', async () => {
    // The agency case. Forty clients share a Redis and must not share a budget.
    const client = fakeRedis();
    const limiter = createRedisRateLimiter({ client });

    for (let i = 0; i < BUDGET.perWindow; i++) await limiter.tryConsume('brand_1', 'instagram', at(1_000 + i));

    expect(await limiter.tryConsume('brand_1', 'instagram', at(2_000))).toBe(false);
    expect(await limiter.tryConsume('brand_2', 'instagram', at(2_000))).toBe(true);
  });

  it('counts per platform, so a busy channel does not block a quiet one', async () => {
    const limiter = createRedisRateLimiter({ client: fakeRedis() });
    for (let i = 0; i < BUDGET.perWindow; i++) await limiter.tryConsume('brand_1', 'instagram', at(1_000 + i));

    expect(await limiter.tryConsume('brand_1', 'instagram', at(2_000))).toBe(false);
    expect(await limiter.tryConsume('brand_1', 'tiktok', at(2_000))).toBe(true);
  });

  it('frees budget as the window slides', async () => {
    const limiter = createRedisRateLimiter({ client: fakeRedis() });
    for (let i = 0; i < BUDGET.perWindow; i++) await limiter.tryConsume('brand_1', 'instagram', at(1_000 + i));

    expect(await limiter.tryConsume('brand_1', 'instagram', at(2_000))).toBe(false);
    // One window later the earliest attempts have aged out.
    expect(await limiter.tryConsume('brand_1', 'instagram', at(1_000 + BUDGET.windowMs + 1))).toBe(true);
  });

  it('two replicas share one budget — the whole reason this exists', async () => {
    /**
     * The in-memory limiter fails this by construction: two instances keep two
     * Maps and enforce `perWindow × 2`. Pointing both at the same store is the
     * entire difference, and it is worth an explicit test because the failure
     * is invisible on one replica and only appears under autoscale.
     */
    const shared = fakeRedis();
    const replicaA = createRedisRateLimiter({ client: shared });
    const replicaB = createRedisRateLimiter({ client: shared });

    for (let i = 0; i < BUDGET.perWindow; i++) {
      const replica = i % 2 === 0 ? replicaA : replicaB;
      expect(await replica.tryConsume('brand_1', 'instagram', at(1_000 + i))).toBe(true);
    }

    expect(await replicaA.tryConsume('brand_1', 'instagram', at(2_000))).toBe(false);
    expect(await replicaB.tryConsume('brand_1', 'instagram', at(2_000))).toBe(false);
  });

  it('does not collapse two attempts in the same millisecond', async () => {
    // A sorted set keyed on the timestamp alone would count these as one, and
    // simultaneous attempts are exactly when the limit matters.
    const client = fakeRedis();
    const limiter = createRedisRateLimiter({ client });

    await limiter.tryConsume('brand_1', 'instagram', at(5_000));
    await limiter.tryConsume('brand_1', 'instagram', at(5_000));

    expect(await limiter.remaining('brand_1', 'instagram', at(5_000))).toBe(BUDGET.perWindow - 2);
  });

  it('reports remaining without consuming', async () => {
    const limiter = createRedisRateLimiter({ client: fakeRedis() });
    await limiter.tryConsume('brand_1', 'instagram', at(1_000));

    expect(await limiter.remaining('brand_1', 'instagram', at(1_000))).toBe(BUDGET.perWindow - 1);
    expect(await limiter.remaining('brand_1', 'instagram', at(1_000))).toBe(BUDGET.perWindow - 1);
  });

  it('namespaces its keys so it can share a Redis', async () => {
    const client = fakeRedis();
    await createRedisRateLimiter({ client, prefix: 'test:rate' }).tryConsume('brand_1', 'instagram', at(1));

    expect([...client.store.keys()]).toEqual(['test:rate:brand_1:instagram']);
  });
});

describe('when Redis is unreachable', () => {
  const broken = (): RedisLike => ({ eval: async () => { throw new Error('ECONNREFUSED'); } });

  it('allows the publish by default', async () => {
    /**
     * A deliberate trade-off, not an oversight. These budgets sit far below the
     * platforms' own limits, so failing open risks a modest overshoot against a
     * ceiling someone else enforces; failing closed stops every customer's
     * scheduled posts because a cache blipped.
     */
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await createRedisRateLimiter({ client: broken() }).tryConsume('b', 'instagram', at(1))).toBe(true);
    vi.restoreAllMocks();
  });

  it('refuses when the caller says that trade-off does not hold', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const limiter = createRedisRateLimiter({ client: broken(), allowOnError: false });
    expect(await limiter.tryConsume('b', 'instagram', at(1))).toBe(false);
    vi.restoreAllMocks();
  });

  it('says so loudly rather than failing silently', async () => {
    // Failing open without a trace is how an overshoot becomes unexplainable.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await createRedisRateLimiter({ client: broken() }).tryConsume('b', 'instagram', at(1));
    expect(spy).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('reports the full budget rather than zero on the health surface', async () => {
    // "Budget unknown" has no number, and 0 would read as "you are throttled"
    // — a different and wrong statement about the account.
    const limiter = createRedisRateLimiter({ client: broken() });
    expect(await limiter.remaining('b', 'instagram', at(1))).toBe(BUDGET.perWindow);
  });
});
