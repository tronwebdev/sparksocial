import { z } from 'zod';

/**
 * TREND DISCOVERY — PRD §8.9 (`DISC-01`, `DISC-02`), plan §3.2 `trend.*`.
 *
 * The PRD's problem statement is the whole design brief:
 *
 *   *"Low velocity on trends: by the time trends are noticed and repurposed,
 *   they're saturated."*
 *
 * So this is not a "what's popular" feed. Popular is the *late* signal. The
 * product's job is to surface things that are climbing and that this specific
 * brand can credibly join — and to refuse the ones it cannot.
 */

export const TrendSourceName = z.enum(['tiktok', 'x', 'youtube', 'reddit', 'google', 'hackernews', 'producthunt', 'pinterest', 'manual']);
export type TrendSourceName = z.infer<typeof TrendSourceName>;

export const TrendMetrics = z.object({
  /** Absolute reach. Context, never the ranking signal on its own. */
  volume: z.number().min(0),
  /**
   * Rate of growth, normalised 0–1. The early signal — this is what the PRD
   * means by acting "before saturation".
   */
  velocity: z.number().min(0).max(1),
  /**
   * How thoroughly the trend has already been done, 0–1. The late signal, and
   * the one that decides whether joining is worth anything.
   */
  saturation: z.number().min(0).max(1),
  /** Period-over-period change. Negative means it is already dying. */
  growth: z.number(),
});
export type TrendMetrics = z.infer<typeof TrendMetrics>;

export const Trend = z.object({
  id: z.string(),
  source: TrendSourceName,
  topic: z.string().min(1),
  /** Free-text descriptors from the source. Matched against genome signals. */
  tags: z.array(z.string()).default([]),
  metrics: TrendMetrics,
  /** Example posts, for the DISC-02 detail view. */
  samples: z.array(z.object({ url: z.string(), caption: z.string().optional() })).default([]),
  language: z.string().default('en'),
  region: z.string().optional(),
});
export type Trend = z.infer<typeof Trend>;

/**
 * Where trends come from.
 *
 * A seam for the same reason as `PlatformAdapter` and `MessageTransport`: every
 * real source is behind a credential or an approval — TikTok Creative Center
 * needs the audit cleared, X trends carry a per-call cost, Reddit is a
 * ~$12K/yr commercial licence (§8). Ranking and safety are the parts worth
 * building now, and they are worth nothing if they cannot be tested without
 * four vendor contracts.
 */
/**
 * How well a source can honour a keyword.
 *
 * This is declared rather than inferred because the difference is not a detail
 * the caller can shrug at. A source with `'server'` asks the vendor for the
 * keyword and gets back matches from the vendor's whole corpus. A source with
 * `'filter'` fetches its usual trending list and discards what does not match —
 * which for a niche keyword over a fifty-item list returns *nothing*, and
 * "nothing" is indistinguishable on screen from "there are no trends about
 * this". One of those is a fact about the world and the other is a fact about
 * our integration, and the recipe wizard has to be able to say which.
 */
export type KeywordSupport = 'server' | 'filter';

export interface TrendFetchArgs {
  region?: string;
  language?: string;
  limit: number;
  /**
   * Topics the caller is looking for — `AUTO-02`'s keyword step, which had
   * nothing to reach until this parameter existed. Empty or absent means "give me
   * what is trending", the behaviour every caller had before.
   *
   * Matched as OR: a recipe watching `marketing, sales, AI` wants anything about
   * any of them, not the intersection, which would almost always be empty.
   */
  keywords?: readonly string[];
  /**
   * Topics to drop, applied after everything else — the wizard's "exclude
   * keywords". AND-NOT: one match on this list removes the trend, whatever else
   * it matched.
   */
  excludeKeywords?: readonly string[];
}

export interface TrendSource {
  readonly name: string;
  /**
   * Whether this source searches the vendor for a keyword or filters what it
   * already fetched. Absent reads as `'filter'` — the conservative claim, since a
   * source that has not said it can search should not be assumed to.
   */
  readonly keywordSupport?: KeywordSupport;
  fetch(args: TrendFetchArgs): Promise<Trend[]>;
  /**
   * One trend by id, for `trend.detail`/`trend.explain`/`trend.repurpose`.
   * Optional: a source with no cheap lookup-by-id falls back to scanning a
   * larger `fetch()` — real, just less efficient, never fabricated.
   */
  get?(id: string): Promise<Trend | undefined>;
}

/**
 * Whether a trend matches a keyword list, over its topic and its tags.
 *
 * One definition, shared by every adapter that filters client-side and by the
 * composite. Substring rather than token matching, and lowercased: a keyword of
 * `market` should find "marketing", because the alternative is a control that
 * silently requires the owner to guess the vendor's exact word. Over-matching is
 * recoverable — the exclude list and the relevance floor both run afterwards —
 * and under-matching looks like an empty world.
 */
export function matchesKeywords(trend: Trend, keywords: readonly string[] | undefined): boolean {
  if (!keywords?.length) return true;
  const haystack = `${trend.topic} ${trend.tags.join(' ')}`.toLowerCase();
  return keywords.some((k) => {
    const needle = k.trim().toLowerCase();
    return needle.length > 0 && haystack.includes(needle);
  });
}

/**
 * Apply a caller's keyword and exclude lists to a fetched batch.
 *
 * Exported so an adapter that searched server-side can still apply the *exclude*
 * list, which no vendor's search endpoint takes: Reddit and YouTube both accept a
 * query and neither accepts a negation. Running it over server results is not
 * redundant work, it is the half the vendor did not do.
 */
export function applyKeywordFilters(
  trends: Trend[],
  args: { keywords?: readonly string[]; excludeKeywords?: readonly string[]; alreadySearched?: boolean },
): Trend[] {
  const kept = args.alreadySearched ? trends : trends.filter((t) => matchesKeywords(t, args.keywords));
  if (!args.excludeKeywords?.length) return kept;
  return kept.filter((t) => !matchesKeywords(t, args.excludeKeywords));
}

/**
 * Deterministic stub covering the shapes ranking has to handle: a rising trend,
 * an already-saturated one, one that is actively dying, and one that is hot but
 * unsafe for a regulated brand.
 *
 * Fixed rather than random — a discovery feed that reshuffles on every call
 * makes "did my filter work?" unanswerable.
 */
export function createStubTrendSource(): TrendSource {
  const trends: Trend[] = [
    {
      id: 'tr_rising',
      source: 'tiktok',
      topic: 'Before-and-after in one continuous shot',
      tags: ['before_after', 'craft', 'transformation'],
      metrics: { volume: 120_000, velocity: 0.82, saturation: 0.18, growth: 2.4 },
      samples: [{ url: 'https://example.invalid/1', caption: 'one take, no cuts' }],
      language: 'en',
    },
    {
      id: 'tr_saturated',
      source: 'tiktok',
      topic: 'The "get ready with me" format',
      tags: ['grwm', 'personality'],
      // The trap: enormous volume, and everyone has already done it.
      metrics: { volume: 9_400_000, velocity: 0.21, saturation: 0.93, growth: 0.1 },
      samples: [],
      language: 'en',
    },
    {
      id: 'tr_dying',
      source: 'x',
      topic: 'A meme format from three weeks ago',
      tags: ['meme'],
      metrics: { volume: 400_000, velocity: 0.12, saturation: 0.71, growth: -0.6 },
      samples: [],
      language: 'en',
    },
    {
      id: 'tr_unsafe',
      source: 'reddit',
      topic: 'Debating a medical treatment claim',
      tags: ['health_claim', 'controversy', 'medical'],
      metrics: { volume: 800_000, velocity: 0.74, saturation: 0.22, growth: 1.9 },
      samples: [],
      language: 'en',
    },
    {
      id: 'tr_local',
      source: 'google',
      topic: 'Local weekend event searches',
      tags: ['local', 'seasonal', 'community'],
      metrics: { volume: 22_000, velocity: 0.55, saturation: 0.3, growth: 0.9 },
      samples: [],
      language: 'en',
    },
    {
      // Present so the fixture exercises a screen-capture genome as well as a
      // physical-craft one. Without it every trend here is craft- or
      // place-shaped, a SaaS genome matches nothing, and the stub silently
      // stops testing half of `relevanceFor`.
      id: 'tr_workflow',
      source: 'youtube',
      topic: 'Showing one workflow end to end, no narration',
      tags: ['workflow', 'software', 'demo', 'screen'],
      metrics: { volume: 310_000, velocity: 0.68, saturation: 0.24, growth: 1.6 },
      samples: [],
      language: 'en',
    },
  ];

  return {
    name: 'stub',
    // Filters rather than claiming to search, which is the truth for a fixed
    // four-item array — and it means every test of the keyword path runs against
    // the same semantics the three filtering adapters have.
    keywordSupport: 'filter',
    async fetch({ limit, keywords, excludeKeywords }) {
      return applyKeywordFilters(trends, { ...(keywords ? { keywords } : {}), ...(excludeKeywords ? { excludeKeywords } : {}) }).slice(0, limit);
    },
    async get(id) {
      return trends.find((t) => t.id === id);
    },
  };
}

/**
 * `TrendSource.get`'s fallback for a source that only implements `fetch` —
 * scans a larger page rather than fabricating a lookup-by-id the source
 * doesn't actually support.
 */
export async function getTrendById(source: TrendSource, id: string): Promise<Trend | undefined> {
  if (source.get) return source.get(id);
  const trends = await source.fetch({ limit: 200 });
  return trends.find((t) => t.id === id);
}
