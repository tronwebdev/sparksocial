import { createRequire } from 'node:module';
import { createRateLimiter, createRedisRateLimiter, type RateLimiter, type RedisLike } from '@sparksocial/publish';
import { envStr } from './env.js';

/**
 * Shared rate limits when a Redis is configured, per-replica otherwise.
 *
 * Chosen on the credential like every other seam in this file's neighbourhood
 * (Clerk, Postgres, telemetry, the inference client), so local development and
 * CI need no Redis and production gets the real thing by setting one variable.
 *
 * The warning matters more here than it looks. The in-memory limiter is not
 * merely *less accurate* across replicas — it enforces `perWindow × replicas`,
 * so the throttle silently weakens exactly as traffic grows. That is the
 * opposite of how a safety limit should degrade, and it is invisible unless
 * something says so at boot.
 */
export function buildRateLimiter(): RateLimiter {
  const url = envStr('REDIS_URL', '');
  if (!url) {
    console.warn(
      '[warn] REDIS_URL unset — publish rate limits are per-replica. With more than one replica the ' +
        'effective budget is multiplied by the replica count. Fine for local development; not for Azure.',
    );
    return createRateLimiter();
  }

  return createRedisRateLimiter({ client: connect(url) });
}

/**
 * `ioredis`, resolved at runtime.
 *
 * A static import would make it a hard dependency of every environment that
 * merely *loads* this module — CI, the test suite, a local run — for a client
 * none of them construct. `packages/publish` deliberately depends on nothing
 * Redis-shaped (see `RedisLike`), and pulling the driver in here rather than
 * there keeps that true.
 *
 * Azure Cache for Redis requires TLS on the 6380 endpoint; `rediss://` in the
 * URL is what selects it, so the connection string carries that decision rather
 * than a flag here that could disagree with it.
 */
function connect(url: string): RedisLike {
  // `createRequire` rather than a top-level import: this package is ESM, and a
  // dynamic `import()` would force `buildRateLimiter` async for one branch that
  // most environments never take.
  const require = createRequire(import.meta.url);
  const Redis = require('ioredis') as { default?: new (url: string) => RedisLike } & (new (url: string) => RedisLike);
  // ioredis 6 is dual-published; the CJS entry is the class, the ESM interop
  // shape puts it on `.default`. Handling both beats pinning to whichever one
  // the current bundler happens to hand back.
  const Ctor = Redis.default ?? Redis;
  return new Ctor(url);
}
