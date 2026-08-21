import { PublishError, type Platform, type PublishReceipt, type PublishRequest } from './adapter.js';

/**
 * RETRY AND RATE BUDGETS — plan §12 P4: *"scheduling, retry, health, rate
 * budgets"*.
 *
 * Publishing is the one place in this product where a bug is visible to
 * somebody else's audience and cannot be taken back. Two failure modes matter
 * more than throughput:
 *
 *   - **Double-posting.** A retry that reaches the platform twice puts the same
 *     post on a customer's feed twice. Every attempt therefore carries the same
 *     idempotency key, and adapters are expected to honour it.
 *   - **Getting rate-limited into a ban.** Retrying a 429 immediately is how an
 *     account gets throttled and then suspended, taking the customer's whole
 *     presence with it. Backoff is exponential and a platform-supplied
 *     `Retry-After` always wins over our own schedule.
 */

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = {
  // Three attempts, not ten. A post that fails three times is failing for a
  // reason a human needs to see, and the calendar has a fallback (§6.5) — it
  // does not need this call to succeed at any cost.
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
};

/**
 * Exponential backoff with full jitter.
 *
 * Jitter is not decoration here. Scheduled posts cluster on round times — 09:00
 * across every brand in the workspace — so a fixed backoff makes every retry
 * from that cluster hit the platform in lockstep, which is precisely the
 * pattern rate limiters punish. Full jitter spreads them.
 */
export function backoffMs(attempt: number, policy: RetryPolicy, random: () => number = Math.random): number {
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.floor(random() * exponential);
}

/**
 * Per-platform posting budget.
 *
 * Deliberately counted per platform *per brand*: platform limits apply to the
 * connected account, so one brand's busy day must not consume another's
 * allowance. An agency workspace running forty clients would otherwise have its
 * first client starve the rest.
 */
export interface RateBudget {
  /** Posts allowed in the window, per platform per brand. */
  perWindow: number;
  windowMs: number;
}

const DAY = 24 * 3_600_000;

export const DEFAULT_BUDGETS: Record<Platform, RateBudget> = {
  // Conservative by design. These are product-level throttles well under the
  // platforms' published limits — the aim is "never the reason an account got
  // flagged", not maximum throughput.
  instagram: { perWindow: 25, windowMs: DAY },
  // Stories are expected to be frequent and are ephemeral, so the ceiling is
  // higher than the feed's — the reputational risk a throttle guards against is
  // mostly a feed phenomenon.
  instagram_story: { perWindow: 40, windowMs: DAY },
  tiktok: { perWindow: 15, windowMs: DAY },
  linkedin: { perWindow: 20, windowMs: DAY },
  x: { perWindow: 50, windowMs: DAY },
  youtube_shorts: { perWindow: 10, windowMs: DAY },
  // Long-form is slow to produce and slow to consume; more than a few a day is
  // a mistake rather than a strategy.
  youtube_long: { perWindow: 3, windowMs: DAY },
  facebook: { perWindow: 25, windowMs: DAY },
  // Groups are the highest-moderation-risk surface here: posting too often is
  // how an account gets removed by a group admin rather than by the platform.
  facebook_group: { perWindow: 5, windowMs: DAY },
  threads: { perWindow: 25, windowMs: DAY },
  pinterest: { perWindow: 25, windowMs: DAY },
  google_business: { perWindow: 10, windowMs: DAY },
  // Reddit's own communities enforce this harder than Reddit does — the PRD's
  // Track 7 flags automated posting there as a per-community risk, and this is
  // the throttle that keeps a mistake small.
  reddit: { perWindow: 3, windowMs: DAY },
  bluesky: { perWindow: 50, windowMs: DAY },
};

/**
 * Async because the shared implementation is Redis.
 *
 * The in-memory one has no need of it, and paying that cost anyway is the
 * point: a synchronous interface silently forbids every distributed
 * implementation, and discovering that at the moment you add a second replica
 * means changing every call site under time pressure.
 */
export interface RateLimiter {
  /** Records an attempt and reports whether it was within budget. */
  tryConsume(brandId: string, platform: Platform, now: Date): Promise<boolean>;
  /** Remaining posts in the current window, for the health surface. */
  remaining(brandId: string, platform: Platform, now: Date): Promise<number>;
}

/**
 * In-memory sliding-window limiter — development, tests, single replica.
 *
 * Per-replica, so N replicas enforce N times the budget. That is survivable for
 * a *product* throttle sitting well below the platform's own limit, and it is
 * not survivable as a permanent answer: the budgets exist so that SparkSocial is
 * never the reason an account got flagged, and "never" does not scale by
 * replica count. `createRedisRateLimiter` is the shared one; this stays because
 * local development and CI should not need a Redis.
 */
export function createRateLimiter(budgets: Record<Platform, RateBudget> = DEFAULT_BUDGETS): RateLimiter {
  const hits = new Map<string, number[]>();
  const key = (brandId: string, platform: Platform) => `${brandId}:${platform}`;

  const prune = (k: string, windowMs: number, now: number): number[] => {
    const kept = (hits.get(k) ?? []).filter((t) => now - t < windowMs);
    // Drop the entry entirely when it empties, so a long-lived process does not
    // accumulate a key per brand-platform pair forever.
    if (kept.length === 0) hits.delete(k);
    else hits.set(k, kept);
    return kept;
  };

  return {
    async tryConsume(brandId, platform, now) {
      const budget = budgets[platform];
      const k = key(brandId, platform);
      const kept = prune(k, budget.windowMs, now.getTime());
      if (kept.length >= budget.perWindow) return false;
      hits.set(k, [...kept, now.getTime()]);
      return true;
    },

    async remaining(brandId, platform, now) {
      const budget = budgets[platform];
      const kept = prune(key(brandId, platform), budget.windowMs, now.getTime());
      return Math.max(0, budget.perWindow - kept.length);
    },
  };
}

export interface PublishWithRetryDeps {
  publish: (req: PublishRequest) => Promise<PublishReceipt>;
  policy?: RetryPolicy;
  /** Injected for tests; production passes a real sleep. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onAttempt?: (attempt: number, error: PublishError) => void;
}

/**
 * Publishes with bounded retries.
 *
 * A non-retryable failure aborts immediately rather than burning the remaining
 * attempts: if the caption is over length, it will be over length on attempt
 * three too, and those attempts cost rate budget a transient failure elsewhere
 * may need.
 */
export async function publishWithRetry(
  req: PublishRequest,
  deps: PublishWithRetryDeps,
): Promise<PublishReceipt> {
  const policy = deps.policy ?? DEFAULT_RETRY;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let last: PublishError | undefined;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await deps.publish(req);
    } catch (e) {
      const error =
        e instanceof PublishError
          ? e
          : // An unclassified throw is treated as retryable-once rather than
            // permanent: an adapter that crashed on a socket error should not
            // permanently drop a scheduled post.
            new PublishError(req.platform, e instanceof Error ? e.message : String(e), true);

      last = error;
      deps.onAttempt?.(attempt, error);

      if (!error.retryable || attempt === policy.maxAttempts) break;

      // A platform that told us when to come back knows better than our curve.
      const delay = error.retryAfterMs ?? backoffMs(attempt, policy, deps.random);
      await sleep(delay);
    }
  }

  throw last ?? new PublishError(req.platform, 'Publishing failed.', false);
}
