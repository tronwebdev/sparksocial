/**
 * One request per read, however many components ask for it.
 *
 * The Command Center made 24 tool calls on load and about half were repeats —
 * `genome.list` five times, `brand.governance.get` five, `agent.status` four,
 * `campaign.list` three — because each panel resolves what it needs on its own,
 * and thirty-five of them call `useSelectedGenome`. From Nigeria every call is
 * ~0.5 s of round trip to the API, so repeats were not free: they queued behind
 * one another in waves.
 *
 * So the reads below are shared. A caller asking for something already in
 * flight gets the same request; one asking within `FRESH_MS` of an answer gets
 * that answer. Each caller receives its own copy, so one sorting the list in
 * place cannot reorder another's.
 *
 * ── Why it cannot show stale data for long ────────────────────────────────
 *
 * - Only tools declared `effect: 'read'` are listed, and only these — checked
 *   against the registry one by one, not inferred from a name.
 * - Any other call (a write, or a read not on the list) empties the cache when
 *   it returns, so what somebody just did is what the next read sees.
 * - A brand switch empties it, and the selected brand is part of the key
 *   anyway, because the proxy forwards it and some reads depend on it.
 * - `spark:content-changed` empties it, for a post that changed elsewhere.
 * - Failures are never kept.
 *
 * What is left is a change made by somebody else, or by the agent, in the
 * last five seconds — which a page that has just loaded could not have shown
 * either.
 */

import { GENOME_COOKIE } from './selectedGenome';

const SHARED_READS = new Set([
  'genome.list',
  'genome.get',
  'brand.governance.get',
  'agent.status',
  'campaign.list',
  'queue.review.list',
  'content.list',
  'content.get',
  'learning.confidence',
  'calendar.get',
  'human.notifications',
]);

/** How long an answer is reused — long enough to cover one page's waves of loading, short enough not to matter. */
const FRESH_MS = 5_000;

interface Entry {
  /** When the answer arrived; `Infinity` while it is still in flight. */
  at: number;
  result: Promise<{ status: string }>;
}

const entries = new Map<string, Entry>();

export function isSharedRead(name: string): boolean {
  return SHARED_READS.has(name);
}

/** Drop everything — after a write, a brand switch, or a post changing. */
export function forgetReads(): void {
  entries.clear();
}

function selectedBrand(): string {
  if (typeof document === 'undefined') return '';
  return document.cookie.match(new RegExp(`(?:^|; )${GENOME_COOKIE}=([^;]*)`))?.[1] ?? '';
}

function copy<R>(r: R): R {
  return typeof structuredClone === 'function' ? structuredClone(r) : (JSON.parse(JSON.stringify(r)) as R);
}

export function sharedRead<R extends { status: string }>(name: string, input: unknown, run: () => Promise<R>): Promise<R> {
  const key = `${name}\u0000${selectedBrand()}\u0000${JSON.stringify(input ?? null)}`;
  const hit = entries.get(key);
  if (hit && (hit.at === Infinity || Date.now() - hit.at < FRESH_MS)) {
    return (hit.result as Promise<R>).then(copy);
  }
  const result = run();
  const entry: Entry = { at: Infinity, result };
  entries.set(key, entry);
  result.then(
    (r) => {
      // Only if it is still the entry on file — a write may have cleared it mid-flight.
      if (entries.get(key) !== entry) return;
      if (r.status === 'succeeded') entry.at = Date.now();
      else entries.delete(key);
    },
    () => {
      if (entries.get(key) === entry) entries.delete(key);
    },
  );
  return result.then(copy);
}

if (typeof window !== 'undefined') {
  /*
    By name rather than by import: `BRAND_CHANGED_EVENT` lives in a component
    and `CONTENT_CHANGED_EVENT` in a client-only module, and `lib/tools.ts`
    (which imports this) must stay importable from anywhere.
  */
  window.addEventListener('spark:brand-changed', forgetReads);
  window.addEventListener('spark:content-changed', forgetReads);
}
