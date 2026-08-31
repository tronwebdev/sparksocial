import { describe, expect, it } from 'vitest';
import {
  applyKeywordFilters,
  createStubTrendSource,
  matchesKeywords,
  type Trend,
} from '../src/trend.js';
import { createCompositeTrendSource, describeKeywordSupport } from '../src/composite.js';

/**
 * KEYWORD SEARCH — the parameter `TrendSource.fetch` did not have.
 *
 * The recipe wizard's step 3 asks for keywords and exclude keywords. Until this
 * existed, `fetch({region, language, limit})` had nowhere to put either, so the
 * whole step was a control that stored two arrays and changed nothing — the same
 * defect class as `engagement_types` and the watermark toggle.
 *
 * ── What these guard, and why it is the honesty rather than the matching ──
 *
 * The matching itself is a substring test; there is not much to get wrong. What
 * matters is the distinction between a source that asks its vendor for a keyword
 * and one that narrows the page it already fetched. The second returns nothing
 * for a niche word, and "nothing" on a screen is indistinguishable from "there
 * are no trends about this" — one being a fact about the world and the other a
 * fact about our integration. `keywordSupport` is what lets a screen tell them
 * apart, so it is asserted rather than assumed.
 */

function trend(over: Partial<Trend> & { id: string }): Trend {
  return {
    source: 'manual',
    topic: '',
    tags: [],
    metrics: { volume: 1000, velocity: 0.5, saturation: 0.2, growth: 1 },
    samples: [],
    language: 'en',
    ...over,
  };
}

describe('matchesKeywords', () => {
  it('matches nothing away when no keywords are given', () => {
    // Every caller before this parameter existed. The default must be "give me
    // what is trending", not "give me nothing".
    expect(matchesKeywords(trend({ id: 'a', topic: 'anything' }), undefined)).toBe(true);
    expect(matchesKeywords(trend({ id: 'a', topic: 'anything' }), [])).toBe(true);
  });

  it('searches the topic and the tags, not just the topic', () => {
    // A trend's tags are frequently where the subject actually is — YouTube puts
    // it in `snippet.tags` and Product Hunt in its topic edges.
    expect(matchesKeywords(trend({ id: 'a', topic: 'A new tool', tags: ['marketing'] }), ['marketing'])).toBe(true);
  });

  it('is case-insensitive and matches substrings', () => {
    /**
     * `market` finds "Marketing" deliberately. The alternative is a control that
     * silently requires the owner to guess the vendor's exact word — and
     * over-matching is recoverable here, because the exclude list and the
     * relevance floor both run afterwards, while under-matching looks like an
     * empty world.
     */
    expect(matchesKeywords(trend({ id: 'a', topic: 'Marketing in 2026' }), ['market'])).toBe(true);
    expect(matchesKeywords(trend({ id: 'a', topic: 'MARKETING' }), ['marketing'])).toBe(true);
  });

  it('is OR across keywords, not AND', () => {
    // A recipe watching three topics wants any of them. The intersection would be
    // empty almost always, which would make the control look broken.
    const t = trend({ id: 'a', topic: 'Sales tactics' });
    expect(matchesKeywords(t, ['marketing', 'sales', 'ai'])).toBe(true);
  });

  it('ignores blank entries rather than matching everything on them', () => {
    // `''.includes` is true for every string, so an empty keyword would quietly
    // disable the filter — and a trailing comma in a text input produces one.
    expect(matchesKeywords(trend({ id: 'a', topic: 'fish' }), ['  '])).toBe(false);
  });

  it('does not match when nothing overlaps', () => {
    expect(matchesKeywords(trend({ id: 'a', topic: 'Sourdough starters' }), ['crypto'])).toBe(false);
  });
});

describe('applyKeywordFilters', () => {
  const trends = [
    trend({ id: 'a', topic: 'Marketing automation' }),
    trend({ id: 'b', topic: 'Politics this week' }),
    trend({ id: 'c', topic: 'Sales enablement', tags: ['politics'] }),
  ];

  it('keeps only matches when the source could not search', () => {
    expect(applyKeywordFilters(trends, { keywords: ['marketing'] }).map((t) => t.id)).toEqual(['a']);
  });

  it('skips the keyword pass when the vendor already searched', () => {
    /**
     * The load-bearing case. A server-side search returns the vendor's own
     * matches, which will often not contain the literal keyword — YouTube
     * searching "sourdough" legitimately returns a video titled "my first loaf".
     * Re-filtering those would discard exactly the results the search was for.
     */
    const searched = [trend({ id: 'x', topic: 'my first loaf' })];
    expect(applyKeywordFilters(searched, { keywords: ['sourdough'], alreadySearched: true })).toHaveLength(1);
  });

  it('applies the exclude list even to searched results', () => {
    // Neither Reddit's nor YouTube's search takes a negation, so this is the half
    // no vendor does — and skipping it for searched results would make the
    // exclude list silently inert on exactly the sources that work best.
    const searched = [trend({ id: 'x', topic: 'AI in politics' })];
    expect(
      applyKeywordFilters(searched, { keywords: ['ai'], excludeKeywords: ['politics'], alreadySearched: true }),
    ).toEqual([]);
  });

  it('excludes on tags as well as topic', () => {
    // `c`'s topic is innocuous and its tag is not. A brand excluding "politics"
    // means the subject, wherever the subject is recorded.
    const kept = applyKeywordFilters(trends, { excludeKeywords: ['politics'] }).map((t) => t.id);
    expect(kept).toEqual(['a']);
  });

  it('is a no-op with neither list', () => {
    expect(applyKeywordFilters(trends, {})).toHaveLength(3);
  });
});

describe('the stub source honours keywords', () => {
  it('narrows, so the keyword path is exercised without a vendor', async () => {
    const source = createStubTrendSource();
    const all = await source.fetch({ limit: 10 });
    const narrowed = await source.fetch({ limit: 10, keywords: ['before'] });

    expect(all.length).toBeGreaterThan(narrowed.length);
    expect(narrowed.every((t) => `${t.topic} ${t.tags.join(' ')}`.toLowerCase().includes('before'))).toBe(true);
  });

  it('declares that it filters rather than searches', () => {
    // It is a fixed four-item array. Claiming `'server'` would be the one lie that
    // makes an empty keyword result unexplainable.
    expect(createStubTrendSource().keywordSupport).toBe('filter');
  });

  it('can return nothing, which is the case the wizard has to explain', async () => {
    const source = createStubTrendSource();
    expect(await source.fetch({ limit: 10, keywords: ['nonexistent-topic'] })).toEqual([]);
  });
});

describe('composite keyword support', () => {
  const server = { name: 'srv', keywordSupport: 'server' as const, fetch: async () => [] };
  const filter = { name: 'flt', keywordSupport: 'filter' as const, fetch: async () => [] };
  const silent = { name: 'sil', fetch: async () => [] };

  it('claims server only when every live source can search', () => {
    /**
     * The pessimistic reading, deliberately. This one value is a promise about
     * the whole merged result: with one of three sources narrowing its trending
     * page, the output is partly searched and partly filtered, and claiming
     * `'server'` would tell the caller the coverage is better than it is.
     */
    expect(createCompositeTrendSource([{ source: server }]).keywordSupport).toBe('server');
    expect(createCompositeTrendSource([{ source: server }, { source: filter }]).keywordSupport).toBe('filter');
  });

  it('is filter with no sources at all, not server by vacuous truth', () => {
    // `[].every(…)` is true, which would have made an empty composite claim the
    // strongest possible capability.
    expect(createCompositeTrendSource([]).keywordSupport).toBe('filter');
  });

  it('reads an undeclared source as filtering', () => {
    // A source that has not claimed it can search must never be assumed to.
    expect(createCompositeTrendSource([{ source: silent }]).keywordSupport).toBe('filter');
    expect(describeKeywordSupport([{ source: silent }])[0]!.keywordSupport).toBe('filter');
  });

  it('describes each source separately, which is what a screen needs', () => {
    // The flattened value cannot say "two of your three search" — and that is the
    // sentence the wizard has to show.
    expect(describeKeywordSupport([{ source: server }, { source: filter }])).toEqual([
      { name: 'srv', keywordSupport: 'server' },
      { name: 'flt', keywordSupport: 'filter' },
    ]);
  });

  it('omits disabled sources from the description', () => {
    // An operator-disabled source contributes nothing to a fetch, so promising its
    // capability would overstate what a keyword will reach.
    expect(describeKeywordSupport([{ source: server, enabled: false }, { source: filter }])).toEqual([
      { name: 'flt', keywordSupport: 'filter' },
    ]);
  });

  it('forwards keywords to its sources', async () => {
    let seen: unknown;
    const spy = {
      name: 'spy',
      keywordSupport: 'server' as const,
      fetch: async (args: unknown) => {
        seen = args;
        return [];
      },
    };
    await createCompositeTrendSource([{ source: spy }]).fetch({ limit: 5, keywords: ['fish'], excludeKeywords: ['politics'] });
    expect(seen).toMatchObject({ keywords: ['fish'], excludeKeywords: ['politics'] });
  });
});
