import type { Trend, TrendSource } from './trend.js';

/**
 * THE REGION BREAKDOWN — `DISC-02`'s Geo & Audience panel, for real.
 *
 * ── Why this is a wrapper and not a field ────────────────────────────────
 *
 * No vendor returns a distribution. Every trends endpoint in this codebase
 * answers one question — *what is trending in this country* — and takes the
 * country as an input: YouTube a `regionCode`, Google Trends a `geo`, TikTok a
 * `country_code`, X a WOEID. So "which countries is this trending in, and how
 * hard" is not a field anybody can read; it is an answer this package composes
 * by **asking more than one country and merging the replies**.
 *
 * That has a price, and the price is the design of this file:
 *
 *   - One extra request per region per fetch, per source. Three regions triples
 *     the call count, against quotas that are real (YouTube's daily units) and
 *     bills that are real (X's tier).
 *   - So it is **opt-in and explicit**: `TREND_REGIONS=US,GB,NG`. Unset, or set
 *     to a single region, and nothing wraps anything — the source is returned
 *     as-is and `regions` carries at most the one entry the adapter set.
 *   - Regions are fetched with `allSettled`, like the composite's sources: one
 *     country's rate limit must not empty the whole feed.
 *
 * ── What merging actually means ──────────────────────────────────────────
 *
 * A trend is the same trend across regions when its **id** matches, which is
 * why the region is deliberately *not* in the ids the adapters mint — except
 * Google's, whose feed is per-geo and whose terms are region-specific strings,
 * so `google::US::taxes` and `google::GB::taxes` are genuinely different rows
 * and are merged on their topic instead.
 *
 * The merged trend keeps the *first* region's rates rather than combining them:
 * `velocity` and `saturation` are 0–1 and adding rates is meaningless.
 *
 * `volume` is summed **only when the adapter attributed it to a region**, which
 * is the correction that matters here. A term with 20k Google searches in the US
 * and 7k in the UK genuinely has 27k, and Google says so per geo. YouTube does
 * not: its `viewCount` is global, so the US chart and the UK chart return the
 * same video with the same 64.6M views, and summing them reported 129M — a
 * number no vendor ever said. An adapter that cannot attribute its volume
 * returns `regions: []` and gets region entries with no volume: the panel then
 * says *where* it is trending without claiming *how much* per country.
 */

export interface MultiRegionOptions {
  /** ISO-ish codes, in preference order. The first is treated as primary. */
  regions: readonly string[];
  onRegionError?: (region: string, error: unknown) => void;
}

/** Google's ids embed their geo; everything else mints an id that is region-free. */
function mergeKey(trend: Trend): string {
  return trend.source === 'google' ? `google::${trend.topic.toLowerCase()}` : trend.id;
}

export function createMultiRegionTrendSource(source: TrendSource, options: MultiRegionOptions): TrendSource {
  const regions = [...new Set(options.regions.map((r) => r.trim().toUpperCase()).filter(Boolean))];
  const onError =
    options.onRegionError ??
    ((region, error) => {
      console.warn(`[warn] trend region "${region}" failed, skipping it for this call`, {
        error: error instanceof Error ? error.message : String(error),
      });
    });

  // Nothing to compose. Returning the source itself keeps the call count and
  // the `get()` path exactly as they were — no wrapper, no behaviour change.
  if (regions.length < 2) return source;

  return {
    name: `${source.name}@${regions.join('+')}`,
    ...(source.keywordSupport ? { keywordSupport: source.keywordSupport } : {}),

    async fetch(args) {
      const results = await Promise.allSettled(
        regions.map((region) => source.fetch({ ...args, region })),
      );

      /** Insertion-ordered: the primary region's trends lead the merged list. */
      const merged = new Map<string, Trend>();

      results.forEach((result, i) => {
        const region = regions[i]!;
        if (result.status === 'rejected') {
          onError(region, result.reason);
          return;
        }

        for (const trend of result.value) {
          const key = mergeKey(trend);
          const existing = merged.get(key);

          /* The adapter may already have set its own single-region entry; take
             the region from the trend where it did, and from the loop where it
             did not, so a source that ignores `region` is not mislabelled. */
          const entryCode = trend.regions[0]?.code ?? trend.region ?? region;
          /* Attributed by the adapter — see the note above on why this decides
             whether the volumes may be added. */
          const attributed = trend.regions[0]?.volume;
          const entry = attributed === undefined ? { code: entryCode } : { code: entryCode, volume: attributed };

          if (!existing) {
            merged.set(key, { ...trend, regions: [entry] });
            continue;
          }

          if (existing.regions.some((r) => r.code === entry.code)) continue;

          merged.set(key, {
            ...existing,
            metrics:
              attributed === undefined
                ? existing.metrics
                : { ...existing.metrics, volume: existing.metrics.volume + attributed },
            regions: [...existing.regions, entry],
            /* Fill a gap from a later region rather than overwrite: a term with
               no picture in the US feed and one in the UK feed should show the
               picture. */
            ...(existing.media ? {} : trend.media ? { media: trend.media } : {}),
            samples: existing.samples.length ? existing.samples : trend.samples,
          });
        }
      });

      const trends = [...merged.values()].map((t) => ({
        ...t,
        /* Largest first, so `regions[0]` is the top geo without the UI sorting.
           Unattributed entries have no volume to sort on and keep their fetch
           order, which is the operator's own region preference order. */
        regions: [...t.regions].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)),
      }));

      return trends.slice(0, args.limit);
    },

    /**
     * `get()` asks the primary region only.
     *
     * A detail view opened on one trend does not justify N billed lookups, and
     * the breakdown the panel renders came from the ranked list that opened it.
     * The wrapped source's own `get` is used when it has one — otherwise this
     * falls through to its `fetch`-and-scan, unchanged.
     */
    ...(source.get ? { get: (id: string) => source.get!(id) } : {}),
  };
}
