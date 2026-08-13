import type { Platform } from './adapter.js';
import { DEFAULT_BUDGETS, type RateBudget, type RateLimiter } from './retry.js';

/**
 * SHARED RATE LIMITS — Azure Cache for Redis (CLAUDE.md § Infrastructure).
 *
 * `createRateLimiter` keeps its counters in a module-level Map, so two Container
 * App replicas enforce two independent budgets and the effective limit is
 * `perWindow × replicas`. The budgets exist so that SparkSocial is never the
 * reason an account got flagged, and a limit that quietly multiplies by however
 * many instances the autoscaler happens to be running is not that.
 *
 * ── Why a Lua script rather than three commands ────────────────────────────
 *
 * The window is a sorted set of attempt timestamps. Enforcing it means: drop
 * everything older than the window, count what is left, and add one **only if**
 * the count is under budget. Issued as separate commands that is a
 * check-then-act across a network, and two replicas publishing at the same
 * instant both read the same under-budget count and both proceed — which is
 * precisely the overshoot this class exists to prevent, now with extra latency.
 *
 * Redis runs a script atomically, so the decision and the write cannot be
 * separated by another client.
 *
 * ── Why `now` is passed in ─────────────────────────────────────────────────
 *
 * The script never calls Redis's own `TIME`. Scripts that consult the clock are
 * non-deterministic, and the caller already holds the timestamp the rest of the
 * publish path is reasoning about. Passing it keeps one clock in play instead
 * of two that can disagree across a window boundary.
 */

/**
 * The three commands this needs, and nothing else.
 *
 * `ioredis` and `node-redis` both satisfy this shape, so neither becomes a
 * dependency of `packages/publish` — the concrete client is constructed at the
 * composition root. It also means the whole implementation is testable against
 * a fake, which matters because the sandbox has no Redis and "we'll find out in
 * production" is not a test strategy for a throttle.
 */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

/**
 * ARGV: [1] now (ms), [2] windowMs, [3] perWindow, [4] a unique member id.
 * Returns the count remaining *after* this call, or -1 when refused.
 *
 * The member id must be unique per attempt: a sorted set keyed on the timestamp
 * alone would silently collapse two attempts landing in the same millisecond
 * into one, which under load is exactly when the limit matters.
 */
const CONSUME = `
local key, now, window, limit, member = KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local used = redis.call('ZCARD', key)
if used >= limit then
  return -1
end
redis.call('ZADD', key, now, member)
-- Expire slightly past the window so an idle brand's key disappears on its own
-- rather than accumulating one key per brand-platform pair forever.
redis.call('PEXPIRE', key, window + 1000)
return limit - used - 1
`;

/** Read-only twin. Prunes as it reads, so a stale window cannot report zero left. */
const REMAINING = `
local key, now, window, limit = KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local used = redis.call('ZCARD', key)
if used > limit then
  return 0
end
return limit - used
`;

export interface RedisRateLimiterOptions {
  client: RedisLike;
  budgets?: Record<Platform, RateBudget>;
  /** Namespaced so the limiter can share a Redis with the cache and queues. */
  prefix?: string;
  /**
   * What to do when Redis is unreachable.
   *
   * Defaults to **allowing** the publish. This is a real trade-off and it is
   * made deliberately: these budgets sit far below the platforms' own limits,
   * so failing open risks a modest overshoot, while failing closed means a
   * Redis blip stops every customer's scheduled posts. The platform enforces
   * the limit that actually matters; we are the polite margin on top of it.
   *
   * Set false where that reasoning does not hold.
   */
  allowOnError?: boolean;
}

export function createRedisRateLimiter(opts: RedisRateLimiterOptions): RateLimiter {
  const budgets = opts.budgets ?? DEFAULT_BUDGETS;
  const prefix = opts.prefix ?? 'ss:rate';
  const allowOnError = opts.allowOnError ?? true;
  const key = (brandId: string, platform: Platform) => `${prefix}:${brandId}:${platform}`;

  let attempt = 0;

  return {
    async tryConsume(brandId, platform, now) {
      const budget = budgets[platform];
      // Unique per attempt within the process, and per process. Two replicas
      // writing the same member id in the same millisecond would count once.
      const member = `${now.getTime()}-${process.pid}-${++attempt}`;

      try {
        const left = await opts.client.eval(
          CONSUME,
          1,
          key(brandId, platform),
          now.getTime(),
          budget.windowMs,
          budget.perWindow,
          member,
        );
        return Number(left) >= 0;
      } catch (e) {
        console.error('[error] rate limiter unavailable', {
          brandId,
          platform,
          allowOnError,
          error: e instanceof Error ? e.message : String(e),
        });
        return allowOnError;
      }
    },

    async remaining(brandId, platform, now) {
      const budget = budgets[platform];
      try {
        const left = await opts.client.eval(
          REMAINING,
          1,
          key(brandId, platform),
          now.getTime(),
          budget.windowMs,
          budget.perWindow,
        );
        return Math.max(0, Number(left));
      } catch {
        // A health panel that cannot reach Redis should say "budget unknown",
        // and the closest honest answer in a number-shaped field is the full
        // budget — reporting 0 would read as "you are throttled", which is a
        // different and wrong statement about the account.
        return budget.perWindow;
      }
    },
  };
}
