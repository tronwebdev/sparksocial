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

export const DEFAULT_BUDGETS: Record<Platform, RateBudget> = {
  // Conservative by design. These are product-level throttles well under the
  // platforms' published limits — the aim is "never the reason an account got
  // flagged", not maximum throughput.
  instagram: { perWindow: 25, windowMs: 24 * 3_600_000 },
  tiktok: { perWindow: 15, windowMs: 24 * 3_600_000 },
  linkedin: { perWindow: 20, windowMs: 24 * 3_600_000 },
  x: { perWindow: 50, windowMs: 24 * 3_600_000 },
  youtube_shorts: { perWindow: 10, windowMs: 24 * 3_600_000 },
};

export interface RateLimiter {
  /** Records an attempt and reports whether it is within budget. */
  tryConsume(brandId: string, platform: Platform, now: Date): boolean;
  /** Remaining posts in the current window, for the health surface. */
  remaining(brandId: string, platform: Platform, now: Date): number;
}

/**
 * In-memory sliding-window limiter.
 *
 * Per-replica, like the run event bus, and for the same reason: correctness
 * does not depend on it being global. It is a *product* throttle sitting well
 * below the platform's own limit, so a brief overshoot across replicas stays
 * inside the real ceiling. Backing it with Redis is the swap when replica count
 * makes the drift material.
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
    tryConsume(brandId, platform, now) {
      const budget = budgets[platform];
      const k = key(brandId, platform);
      const kept = prune(k, budget.windowMs, now.getTime());
      if (kept.length >= budget.perWindow) return false;
      hits.set(k, [...kept, now.getTime()]);
      return true;
    },

    remaining(brandId, platform, now) {
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
