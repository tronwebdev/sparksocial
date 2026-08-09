import { describe, expect, it } from 'vitest';
import { GOLDEN_SET } from '@sparksocial/playbooks';
import type { Genome } from '@sparksocial/shared/genome';
import { assessSafety } from '../src/safety.js';
import { rankTrends, relevanceFor } from '../src/rank.js';
import { createStubTrendSource, type Trend } from '../src/trend.js';

/**
 * PRD §3: *"by the time trends are noticed and repurposed, they're saturated."*
 *
 * Everything here tests one of two claims that follow from that: a trend's
 * *remaining* window beats its size, and a brand should not be shown trends it
 * cannot credibly join — however hot they are.
 */

const barber = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_barber')!.genome;
const saas = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_saas')!.genome;

const trend = (over: Partial<Trend> & { id: string }): Trend => ({
  source: 'tiktok',
  topic: 'a topic',
  tags: [],
  metrics: { volume: 100_000, velocity: 0.5, saturation: 0.3, growth: 1 },
  samples: [],
  language: 'en',
  ...over,
});

const regulated = (base: Genome): Genome => ({
  ...base,
  constraints: { ...base.constraints, compliance_profile: 'health' },
});

describe('relevanceFor', () => {
  it('scores on genome dimensions, not on category', () => {
    // A barbershop and a joinery both have `physical_craft` as a proof asset,
    // so both should score high on a craft trend. Nothing here knows what
    // either business is (invariant 5).
    const craft = trend({ id: 't', tags: ['craft', 'before_after'] });
    expect(relevanceFor(barber, craft)).toBeGreaterThan(0.5);
  });

  it('gives a brand no credit for a trend outside what it can show', () => {
    const workflow = trend({ id: 't', tags: ['workflow', 'software', 'demo'] });
    // The SaaS has product_ui; the barbershop has nothing to say here.
    expect(relevanceFor(saas, workflow)).toBeGreaterThan(relevanceFor(barber, workflow));
  });

  it('rewards local trends for local brands only', () => {
    const local = trend({ id: 't', tags: ['local', 'community'] });
    expect(barber.identity.geography.scope).toBe('local');
    expect(relevanceFor(barber, local)).toBeGreaterThan(relevanceFor(saas, local));
  });

  it('discounts a trend the brand cannot film', () => {
    const needsScreen = trend({ id: 't', tags: ['screen', 'workflow'] });
    const withScreen = relevanceFor(saas, needsScreen);
    const withoutScreen = relevanceFor(
      { ...saas, dimensions: { ...saas.dimensions, capture_capability: ['nothing'] } },
      needsScreen,
    );
    expect(withoutScreen).toBeLessThan(withScreen);
  });

  it('stays within 0–1', () => {
    const everything = trend({
      id: 't',
      tags: ['craft', 'before_after', 'transformation', 'local', 'seasonal', 'community'],
    });
    expect(relevanceFor(barber, everything)).toBeLessThanOrEqual(1);
    expect(relevanceFor(barber, trend({ id: 't2', tags: ['screen', 'space'] }))).toBeGreaterThanOrEqual(0);
  });
});

describe('rankTrends — remaining window beats size', () => {
  it('ranks a rising trend above a far larger saturated one', () => {
    // The headline behaviour. 9.4M posts at 93% saturation is not an
    // opportunity, it is a record of one that has passed.
    const rising = trend({
      id: 'rising', tags: ['craft', 'before_after'],
      metrics: { volume: 120_000, velocity: 0.82, saturation: 0.18, growth: 2.4 },
    });
    const saturated = trend({
      id: 'saturated', tags: ['craft', 'before_after'],
      metrics: { volume: 9_400_000, velocity: 0.21, saturation: 0.93, growth: 0.1 },
    });

    const { ranked } = rankTrends(barber, [saturated, rising]);
    expect(ranked[0]!.trend.id).toBe('rising');
  });

  it('saturation alone decides it, even when the crowded trend is moving faster', () => {
    // The previous test passes on velocity alone, so it does not actually
    // exercise saturation. Here the saturated trend has the *higher* velocity:
    // only `velocity x (1 - saturation)` can put the quieter one first.
    const crowded = trend({
      id: 'crowded', tags: ['craft'],
      metrics: { volume: 500_000, velocity: 0.9, saturation: 0.9, growth: 1 },
    });
    const open = trend({
      id: 'open', tags: ['craft'],
      metrics: { volume: 500_000, velocity: 0.5, saturation: 0.1, growth: 1 },
    });

    const { ranked } = rankTrends(barber, [crowded, open]);
    expect(ranked[0]!.trend.id).toBe('open');
  });

  it('discounts a trend that is already declining', () => {
    const identical = { volume: 400_000, velocity: 0.5, saturation: 0.4 };
    const growing = trend({ id: 'up', tags: ['craft'], metrics: { ...identical, growth: 1.2 } });
    const dying = trend({ id: 'down', tags: ['craft'], metrics: { ...identical, growth: -0.6 } });

    const { ranked } = rankTrends(barber, [dying, growing]);
    expect(ranked[0]!.trend.id).toBe('up');
    expect(ranked.find((r) => r.trend.id === 'down')!.factors.some((f) => f.label === 'declining')).toBe(true);
  });

  it('scales score in proportion to relevance — multiplied, not averaged', () => {
    // The property that actually distinguishes multiplication here. Identical
    // metrics, different relevance: the score ratio must equal the relevance
    // ratio. Averaging would compress it toward 1.
    //
    // Naming this precisely matters because the obvious claim — "multiplying
    // makes relevance win" — is false: at r=0.9,w=0.20 vs r=0.3,w=0.75,
    // multiplying picks the *second*. What it buys is proportionality.
    const metrics = { volume: 200_000, velocity: 0.6, saturation: 0.25, growth: 1 };
    const strong = trend({ id: 'strong', tags: ['craft', 'before_after'], metrics });
    const weak = trend({ id: 'weak', tags: ['local'], metrics });

    const { ranked } = rankTrends(barber, [weak, strong]);
    const s = ranked.find((r) => r.trend.id === 'strong')!;
    const w = ranked.find((r) => r.trend.id === 'weak')!;

    expect(s.relevance).toBeGreaterThan(w.relevance);
    // Two decimals, not five: scores are rounded to 3dp, so a tighter
    // tolerance tests the rounding rather than the arithmetic. The margin is
    // still decisive — averaging these two would give ~1.11 against
    // multiplication's ~1.22.
    expect(s.score / w.score).toBeCloseTo(s.relevance / w.relevance, 2);
  });

  it('an off-brand trend is excluded outright, whatever its metrics', () => {
    // This — not the multiplier — is what keeps off-brand trends out of a
    // barbershop's feed. Software tags match nothing in this genome, so the
    // trend falls under RELEVANCE_FLOOR regardless of how hot it is.
    const hotIrrelevant = trend({
      id: 'hot', tags: ['workflow', 'software', 'demo'],
      metrics: { volume: 5_000_000, velocity: 0.95, saturation: 0.05, growth: 3 },
    });

    const { ranked, excluded } = rankTrends(barber, [hotIrrelevant]);
    expect(ranked).toHaveLength(0);
    expect(excluded.map((r) => r.trend.id)).toEqual(['hot']);
  });

  it('treats volume as weak signal, not as the ranking', () => {
    const sameOpportunity = { velocity: 0.6, saturation: 0.2, growth: 1 };
    const big = trend({ id: 'big', tags: ['craft'], metrics: { ...sameOpportunity, volume: 8_000_000 } });
    const small = trend({ id: 'small', tags: ['craft'], metrics: { ...sameOpportunity, volume: 20_000 } });

    const { ranked } = rankTrends(barber, [small, big]);
    // Volume breaks the tie, but only just — the gap must stay small.
    expect(ranked[0]!.trend.id).toBe('big');
    expect(ranked[0]!.score - ranked[1]!.score).toBeLessThan(0.1);
  });
});

describe('rankTrends — safety is exclusion, not a penalty', () => {
  it('removes an unsafe trend however fast it is climbing', () => {
    // A missed trend costs one post; a bad one costs the account. No velocity
    // should be able to outweigh that.
    const unsafe = trend({
      id: 'unsafe', tags: ['health_claim', 'medical'],
      metrics: { volume: 800_000, velocity: 0.95, saturation: 0.05, growth: 3 },
    });

    const { ranked, excluded } = rankTrends(regulated(barber), [unsafe]);
    expect(ranked).toHaveLength(0);
    expect(excluded.map((r) => r.trend.id)).toEqual(['unsafe']);
  });

  it('removes an unsafe trend the brand IS relevant to — only safety can do that', () => {
    // The test above passes on the relevance floor alone: medical tags match
    // nothing in this genome. This one carries craft tags too, so it clears
    // the floor comfortably and safety is the only thing left that can
    // exclude it.
    const relevantButUnsafe = trend({
      id: 'relevant_unsafe',
      tags: ['craft', 'before_after', 'treatment'],
      metrics: { volume: 300_000, velocity: 0.8, saturation: 0.1, growth: 2 },
    });

    const { ranked, excluded } = rankTrends(regulated(barber), [relevantButUnsafe]);
    // Above the floor, so nothing but the safety filter explains its absence.
    expect(excluded[0]!.relevance).toBeGreaterThan(0.4);
    expect(excluded[0]!.safety.safe).toBe(false);
    expect(ranked).toHaveLength(0);
  });

  it('returns exclusions rather than silently dropping them', () => {
    // The refusals are the product's argument, so they have to be inspectable.
    const { excluded } = rankTrends(regulated(barber), [
      trend({ id: 'bad', tags: ['medical'] }),
      trend({ id: 'good', tags: ['craft'] }),
    ]);
    expect(excluded.find((r) => r.trend.id === 'bad')?.safety.detail).toMatch(/health/i);
  });

  it('excludes a trend with nothing the brand can say, separately from unsafe', () => {
    const alien = trend({ id: 'alien', topic: 'quantum computing benchmarks', tags: ['quantum'] });
    const { excluded } = rankTrends(barber, [alien]);
    const row = excluded.find((r) => r.trend.id === 'alien');
    // Safe, just irrelevant — the two reasons must not be conflated.
    expect(row?.safety.safe).toBe(true);
  });
});

describe('assessSafety', () => {
  it('keys compliance on the genome constraint, never on the business type', () => {
    const medical = trend({ id: 't', tags: ['health_claim'] });
    // Same trend, same business — only `compliance_profile` differs.
    expect(assessSafety(barber, medical).safe).toBe(true);
    expect(assessSafety(regulated(barber), medical).safe).toBe(false);
  });

  it('blocks controversy for every brand', () => {
    const tragedy = trend({ id: 't', tags: ['tragedy'] });
    expect(assessSafety(barber, tragedy).reasons).toContain('controversy');
    expect(assessSafety(saas, tragedy).reasons).toContain('controversy');
  });

  it('blocks a likeness-dependent format when nobody is licensed', () => {
    const grwm = trend({ id: 't', tags: ['grwm'] });
    const unlicensed = {
      ...barber,
      dimensions: { ...barber.dimensions, talent_availability: 'no' as const },
    };
    expect(assessSafety(unlicensed, grwm).reasons).toContain('requires_likeness');

    const licensed = {
      ...barber,
      dimensions: { ...barber.dimensions, talent_availability: 'yes_licensed' as const },
    };
    expect(assessSafety(licensed, grwm).reasons).not.toContain('requires_likeness');
  });

  it('blocks a trend in a language the brand does not publish in', () => {
    const french = trend({ id: 't', language: 'fr' });
    expect(assessSafety(barber, french).reasons).toContain('language_mismatch');
  });

  it('gives a usable reason, not just a code', () => {
    const detail = assessSafety(regulated(barber), trend({ id: 't', tags: ['treatment'] })).detail;
    expect(detail).toMatch(/cannot make claims/i);
  });
});

describe('the stub source', () => {
  it('is deterministic, so a filter change is judgeable', async () => {
    const source = createStubTrendSource();
    expect(await source.fetch({ limit: 5 })).toEqual(await source.fetch({ limit: 5 }));
  });

  it('covers the shapes ranking has to separate', async () => {
    const trends = await createStubTrendSource().fetch({ limit: 10 });
    const { ranked, excluded } = rankTrends(barber, trends);

    // The saturated giant must not lead, and something must be excluded —
    // a fixture where everything passes would prove nothing.
    expect(ranked[0]?.trend.id).not.toBe('tr_saturated');
    expect(excluded.length).toBeGreaterThan(0);
  });

  it('gives both a craft genome and a screen genome something to work with', async () => {
    // Live output caught this: every fixture trend was craft- or place-shaped,
    // so a SaaS genome matched nothing and the whole feed came back empty.
    // Correct behaviour on a bad fixture — and it meant half of `relevanceFor`
    // was never exercised end to end.
    const trends = await createStubTrendSource().fetch({ limit: 10 });

    expect(rankTrends(barber, trends).ranked.length).toBeGreaterThan(0);
    expect(rankTrends(saas, trends).ranked.length).toBeGreaterThan(0);
  });
});
