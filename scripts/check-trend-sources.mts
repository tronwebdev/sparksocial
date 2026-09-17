/**
 * Does each trend source actually return trends?
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * `createCompositeTrendSource` catches every per-source failure on purpose, so
 * one vendor 403ing degrades the feed to "everyone else" instead of taking it
 * down. That is right for production and useless for setup: a token that is
 * wrong, expired, or lacking a scope produces *exactly* the same feed as a token
 * that was never pasted. The boot banner names which sources are configured, not
 * which ones work.
 *
 * Two of them need this more than the rest. `tiktok.ts` and `pinterest.ts` both
 * carry caveats in their own comments — Creative Center issues browser sessions
 * rather than long-lived API keys, and Pinterest's trends endpoint needs an
 * access level most developer apps are not granted. Both fail by returning
 * nothing, which is indistinguishable from a quiet day.
 *
 * Run after pasting any credential:
 *
 *   npx tsx --env-file-if-exists=apps/api/.env scripts/check-trend-sources.mts
 *
 * It reads the same `buildTrendSourceEntries()` the API boots from, rather than
 * re-deriving the wiring — a probe with its own copy of "which env vars mean
 * Reddit is on" could pass while the product fails.
 */

import { buildTrendSourceEntries, describeAllTrendSources } from '../apps/api/src/trend-sources.js';

const PROBE_LIMIT = 5;
/** Generous: a cold OAuth handshake plus a fetch, not a latency benchmark. */
const TIMEOUT_MS = 20_000;

const statuses = describeAllTrendSources();
const entries = buildTrendSourceEntries();
const live = new Map(entries.map((e) => [e.source.name, e]));

let failures = 0;

for (const status of statuses) {
  const label = status.name.padEnd(12);

  if (!status.configured) {
    console.log(`${label} not configured   — set ${status.requires.join(', ')}`);
    continue;
  }
  if (!status.enabled) {
    // Deliberately turned off is not a failure, and must not read as one.
    console.log(`${label} disabled        — ${status.requires.join(', ')} present, switch is off`);
    continue;
  }

  const entry = live.get(status.name);
  if (!entry) {
    // Configured, enabled, and yet absent from the entries the API builds:
    // the two lists have disagreed, which is a bug in the wiring itself.
    console.log(`${label} MISSING         — configured but absent from buildTrendSourceEntries()`);
    failures += 1;
    continue;
  }

  const started = Date.now();
  try {
    const trends = await withTimeout(entry.source.fetch({ limit: PROBE_LIMIT }), TIMEOUT_MS);
    const ms = Date.now() - started;
    if (trends.length === 0) {
      /*
       * Not an error, and not a pass either. An empty result is what a wrong
       * token, a missing scope and a genuinely quiet feed all look like, so it
       * is reported as the ambiguous thing it is rather than resolved by guess.
       */
      console.log(`${label} EMPTY           — reachable, returned 0 trends in ${ms}ms (token may lack the scope)`);
      failures += 1;
      continue;
    }
    const sample = trends[0]!;
    console.log(`${label} ok              — ${trends.length} trends in ${ms}ms, e.g. "${truncate(sample.topic, 48)}"`);
  } catch (err) {
    console.log(`${label} FAILED          — ${err instanceof Error ? err.message : String(err)}`);
    failures += 1;
  }
}

if (failures > 0) {
  console.log(`\n${failures} source(s) configured but not returning trends.`);
  process.exit(1);
}
console.log('\nEvery configured source returned trends.');

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** A hung vendor must not hang the check — the composite would have moved on. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms).unref()),
  ]);
}
