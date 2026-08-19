import type { Trend, TrendSource } from './trend.js';

/**
 * MULTI-SOURCE TREND AGGREGATION — plan §8, closing the gap `trend.ts`'s own
 * comment named: every real source is behind a credential or an approval, so
 * the product needs to run on whichever ones are actually configured, in
 * whatever combination, without any one of them being able to take the
 * whole feed down.
 *
 * Two properties this file is responsible for:
 *
 * 1. **A source is a switch, not a delete.** `enabled: false` takes a fully-
 *    configured source (real credentials, working client) out of the merge
 *    without touching its config — the operator turns Reddit off without
 *    unsetting `REDDIT_CLIENT_ID`. Building the switch as a separate flag
 *    from "is it configured" is what makes that possible; if the only way to
 *    disable a source were removing its credentials, re-enabling it later
 *    would mean re-entering them.
 *
 * 2. **One source's failure is that source's problem, not the feed's.** Every
 *    `fetch()` runs through `Promise.allSettled`, never `Promise.all` — a
 *    timeout, a 403, a rate limit on one provider degrades the merge to
 *    "everyone else" instead of throwing `trend.rank` into an error state.
 *    The same applies per-source inside `fetch()` itself: a paid API going
 *    over quota should read as "this source found nothing this time," not as
 *    a 500 for every brand asking about trends.
 */

export interface TrendSourceEntry {
  source: TrendSource;
  /**
   * The operator's switch, independent of whether the source has real
   * credentials. Defaults to `true` — a source with no explicit flag and no
   * credentials never gets an entry at all (see `buildTrendSource`-style
   * factories), so by the time something reaches this array it's meant to be
   * live unless told otherwise.
   */
  enabled?: boolean;
}

/**
 * A prefixed id keeps two sources from colliding on `Trend.id` without
 * requiring every implementation to coordinate its own id scheme — Reddit's
 * `t3_abc123` and a stub's `tr_rising` are both real, unrelated ids, and
 * `${entryName}::${rawId}` is enough to route a later `get()` back to the
 * one source that minted it.
 */
const SEP = '::';

function prefix(entryName: string, id: string): string {
  return `${entryName}${SEP}${id}`;
}

function splitPrefixed(id: string): { entryName: string; rawId: string } | null {
  const at = id.indexOf(SEP);
  if (at === -1) return null;
  return { entryName: id.slice(0, at), rawId: id.slice(at + SEP.length) };
}

function rePrefix(entryName: string, trend: Trend): Trend {
  return { ...trend, id: prefix(entryName, trend.id) };
}

export interface CompositeTrendSourceDeps {
  /** Injected so a failure is visible without a source being able to throw past the caller. Defaults to `console.warn`. */
  onSourceError?: (entryName: string, error: unknown) => void;
}

/**
 * Merges any number of `TrendSource`s into one. Disabled entries are
 * excluded before anything runs; enabled entries that throw are caught
 * per-source and simply contribute nothing to that call.
 *
 * With zero enabled entries, `fetch()` returns `[]` rather than throwing —
 * "no trend sources configured" is a valid, quiet state (the caller sees an
 * empty feed), not an error.
 */
export function createCompositeTrendSource(entries: TrendSourceEntry[], deps: CompositeTrendSourceDeps = {}): TrendSource {
  const onError = deps.onSourceError ?? ((entryName, error) => {
    console.warn(`[warn] trend source "${entryName}" failed, skipping it for this call`, {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const active = () => entries.filter((e) => e.enabled !== false);

  return {
    name: `composite(${active().map((e) => e.source.name).join('+') || 'none'})`,

    async fetch(args) {
      const live = active();
      const results = await Promise.allSettled(
        live.map((e) => e.source.fetch(args)),
      );

      const trends: Trend[] = [];
      results.forEach((result, i) => {
        const entryName = live[i]!.source.name;
        if (result.status === 'fulfilled') {
          trends.push(...result.value.map((t) => rePrefix(entryName, t)));
        } else {
          onError(entryName, result.reason);
        }
      });

      // Highest opportunity signal first as a rough pre-sort — trend.rank
      // re-scores everything against the genome anyway, so this only matters
      // for callers (trend.fetch) that read the merged list unranked.
      trends.sort((a, b) => b.metrics.velocity * (1 - b.metrics.saturation) - a.metrics.velocity * (1 - a.metrics.saturation));
      return trends.slice(0, args.limit);
    },

    async get(id) {
      const split = splitPrefixed(id);
      if (!split) return undefined;
      const entry = active().find((e) => e.source.name === split.entryName);
      if (!entry) return undefined;
      try {
        const found = entry.source.get
          ? await entry.source.get(split.rawId)
          : (await entry.source.fetch({ limit: 200 })).find((t) => t.id === split.rawId);
        return found ? rePrefix(entry.source.name, found) : undefined;
      } catch (error) {
        onError(entry.source.name, error);
        return undefined;
      }
    },
  };
}
