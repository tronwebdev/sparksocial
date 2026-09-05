import { describe, expect, it } from 'vitest';
import { lagosBarbershop, torontoSaas } from '@sparksocial/playbooks/golden';
import { planCampaign } from '../src/plan.js';

/**
 * Planning a campaign for a brand whose onboarding never finished.
 *
 * `genomeRepository.createDraft` writes dimensions through
 * `GenomeDimensions.partial()` — a draft is allowed to be missing answers
 * nobody has given — and `get` reads them back the same way, then casts the
 * result to the full type. Every consumer therefore believes the array fields
 * are present.
 *
 * That cast has crashed campaign creation twice, one field apart:
 *
 *   secondary_objectives → `Cannot read properties of undefined (reading 'reduce')`
 *   proof_asset          → `Cannot read properties of undefined (reading 'includes')`
 *
 * The first fix defaulted one field and reasoned that consumers guarded the
 * rest. They did not. This test is the class rather than the instance: strip
 * every optional array and plan anyway.
 */
describe('planCampaign against an incomplete genome', () => {
  const strip = (base: typeof lagosBarbershop) => {
    const g = { ...base.genome, dimensions: { ...base.genome.dimensions } };
    for (const k of ['proof_asset', 'capture_capability', 'secondary_objectives']) {
      delete (g.dimensions as Record<string, unknown>)[k];
    }
    return g;
  };

  it('plans rather than throwing, for every objective the wizard offers', () => {
    for (const objective of ['leads', 'bookings', 'trials', 'sales', 'audience', 'hiring'] as const) {
      for (const brand of [lagosBarbershop, torontoSaas]) {
        expect(
          () =>
            planCampaign({
              genome: strip(brand),
              inventory: brand.assets,
              objective,
              windowDays: 30,
            }),
          `${objective}`,
        ).not.toThrow();
      }
    }
  });

  it('returns a mix that still sums to the plan, with nothing invented', () => {
    const plan = planCampaign({
      genome: strip(torontoSaas),
      inventory: torontoSaas.assets,
      objective: 'audience',
      windowDays: 30,
    });

    // A brand that has told us nothing can legitimately build very little —
    // what it must not do is report a mix that disagrees with its own count.
    const total = plan.mix.reduce((n, m) => n + m.count, 0);
    expect(total).toBe(plan.buildableNow);
    expect(plan.mix.every((m) => m.count >= 0)).toBe(true);
  });
});
