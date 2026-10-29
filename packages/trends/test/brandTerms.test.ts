import { describe, expect, it } from 'vitest';
import { GOLDEN_SET } from '@sparksocial/playbooks';
import type { Genome } from '@sparksocial/shared/genome';
import type { ToolCtx } from '@sparksocial/tools';
import { brandTerms } from '../src/brandTerms.js';
import { relevanceFor } from '../src/rank.js';
import { makeTrendRank } from '../src/tool.js';
import type { Trend, TrendFetchArgs } from '../src/trend.js';

/**
 * A brand's Discovery feed is about the brand.
 *
 * Found on production, 29 October: a coffee roaster's "For you" feed led with
 * a Minecraft video and a baseball team, because nothing asked a source for
 * anything about coffee and relevance scored only format fit.
 */

const barber = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_barber')!.genome;

/** The genome as production holds it for Monmouth Coffee — no products recorded. */
const roaster: Genome = {
  ...barber,
  genome_id: 'gen_roaster',
  identity: {
    ...barber.identity,
    business_name: 'Monmouth Coffee',
    category: 'Retail and e-commerce',
    sub_category: 'Speciality coffee roastery with London shops and online/mail order',
  },
  offer: { products: [], primary_cta: '' },
};

const trend = (over: Partial<Trend> & { id: string }): Trend => ({
  source: 'youtube',
  topic: 'a topic',
  tags: [],
  metrics: { volume: 100_000, velocity: 0.6, saturation: 0.2, growth: 1 },
  regions: [],
  samples: [],
  language: 'en',
  ...over,
});

describe('brandTerms', () => {
  it('searches for the head of the sub-category, not its whole sentence', () => {
    const { phrases, words } = brandTerms(roaster);
    expect(phrases).toEqual(['Speciality coffee roastery']);
    expect([...words]).toEqual(expect.arrayContaining(['speciality', 'coffee', 'roastery']));
    expect(words.has('london')).toBe(false); // after "with" — not what the brand is
  });

  it('puts products first when a brand has them, and never ends on a joining word', () => {
    const { phrases } = brandTerms({
      ...roaster,
      identity: { ...roaster.identity, sub_category: 'Bombay-inspired Indian cafés and restaurants' },
      offer: { products: [{ name: 'House espresso blend' }], primary_cta: '' },
    });
    expect(phrases[0]).toBe('House espresso blend');
    expect(phrases[1]).toBe('Bombay-inspired Indian cafés and restaurants');
    expect(phrases.every((p) => !/\band$/i.test(p))).toBe(true);
  });

  it('falls back to the category label when there is no sub-category', () => {
    const { identity } = roaster;
    const { sub_category: _drop, ...rest } = identity;
    const { phrases } = brandTerms({ ...roaster, identity: { ...rest, category: 'Bakery & Café' } });
    expect(phrases).toEqual(['Bakery & Café']);
  });
});

describe('relevance is about the subject, not only the format', () => {
  it('scores a trend naming what the brand is about above one that does not', () => {
    const coffee = trend({ id: 'c', topic: 'Why speciality coffee costs more' });
    const unrelated = trend({ id: 'u', topic: 'Beating Minecraft With The Phobia Mod' });
    expect(relevanceFor(roaster, coffee)).toBeGreaterThan(relevanceFor(roaster, unrelated));
    // Above the floor, so it reaches the feed at all.
    expect(relevanceFor(roaster, coffee)).toBeGreaterThan(0.25);
  });

  it('meets a plural halfway', () => {
    const plural = trend({ id: 'p', topic: 'London roasteries ranked' });
    expect(relevanceFor(roaster, plural)).toBeGreaterThan(relevanceFor(roaster, trend({ id: 'n', topic: 'a topic' })));
  });
});

describe('trend.rank searches for the brand as well as what is trending', () => {
  function ctx(): ToolCtx {
    return {
      orgId: 'org_1',
      role: 'owner',
      approvalMode: 'autopublish',
      budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
      db: {
        genomes: { get: async () => roaster },
        trendObservations: { record: async () => {}, series: async () => [] },
        trendSourceMutes: { list: async () => [] },
      } as unknown as ToolCtx['db'],
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    } as unknown as ToolCtx;
  }

  function spySource() {
    const calls: TrendFetchArgs[] = [];
    return {
      calls,
      source: {
        name: 'spy',
        async fetch(args: TrendFetchArgs) {
          calls.push(args);
          return args.keywords?.length
            ? [trend({ id: 'coffee', topic: 'Speciality coffee at home' })]
            : [trend({ id: 'game', topic: 'Beating Minecraft With The Phobia Mod' })];
        },
      },
    };
  }

  it('asks the sources for the brand’s own words, and ranks what that finds', async () => {
    const { calls, source } = spySource();
    const out = await makeTrendRank(source as never).handler({ genomeId: 'gen_roaster', limit: 5 }, ctx());

    expect(calls.some((c) => c.keywords?.includes('Speciality coffee roastery'))).toBe(true);
    expect(out.trends.map((t) => t.topic)).toContain('Speciality coffee at home');
    expect(out.trends.map((t) => t.topic)).not.toContain('Beating Minecraft With The Phobia Mod');
  });

  it('reuses the brand search for three hours — it costs quota on every load otherwise', async () => {
    const { calls, source } = spySource();
    let t = 0;
    const tool = makeTrendRank(source as never, () => t);

    await tool.handler({ genomeId: 'gen_roaster', limit: 5 }, ctx());
    t = 60 * 60 * 1000; // an hour later
    await tool.handler({ genomeId: 'gen_roaster', limit: 5 }, ctx());
    expect(calls.filter((c) => c.keywords?.length)).toHaveLength(1);

    t = 4 * 60 * 60 * 1000; // past the window
    await tool.handler({ genomeId: 'gen_roaster', limit: 5 }, ctx());
    expect(calls.filter((c) => c.keywords?.length)).toHaveLength(2);
  });

  it('keeps the general feed when the brand search fails', async () => {
    const source = {
      name: 'flaky',
      async fetch(args: TrendFetchArgs) {
        if (args.keywords?.length) throw new Error('quota exceeded');
        return [trend({ id: 'coffee2', topic: 'Coffee roastery tour' })];
      },
    };
    const out = await makeTrendRank(source as never).handler({ genomeId: 'gen_roaster', limit: 5 }, ctx());
    expect(out.trends.map((t) => t.topic)).toContain('Coffee roastery tour');
  });
});
