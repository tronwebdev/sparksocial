import { describe, expect, it } from 'vitest';
import { NICHES, resolveNiche } from '../src/niche.js';

/**
 * Putting the crawl's free-text category onto the twelve-option select.
 *
 * `genome.identity.category` is deliberately free text — the model is told to
 * describe what the site says it is, not to pick from a list it has never
 * seen. So the select was assigned a string that was never one of its options
 * and silently stayed on "Choose one", and the screen looked like the crawl
 * had learned nothing about the business.
 *
 * The strings below are not invented. Each one came back from the deployed
 * crawler during the onboarding walkthrough on 20 Oct.
 */

describe('the categories the crawler actually returned', () => {
  it('puts a jewellery DTC brand in retail', () => {
    expect(resolveNiche('Jewellery brand / DTC e-commerce').niche).toBe('Retail and e-commerce');
  });

  it('puts B2B SaaS in software', () => {
    expect(resolveNiche('B2B SaaS').niche).toBe('Software');
  });

  it('puts an AI agent platform in software', () => {
    expect(resolveNiche('AI sales/revenue agent platform').niche).toBe('Software');
  });
});

describe('an exact member passes straight through', () => {
  it('keeps every option the select offers', () => {
    for (const n of NICHES) {
      expect(resolveNiche(n)).toEqual({ niche: n, other: '' });
    }
  });
});

describe('the ordinary small businesses this product is for', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['barbershop', 'Beauty and grooming'],
    ['Hair salon and spa', 'Beauty and grooming'],
    ['independent coffee roastery', 'Food and drink'],
    ['Neapolitan pizza restaurant', 'Food and drink'],
    ['CrossFit gym', 'Health and fitness'],
    ['dental clinic', 'Health and fitness'],
    ['emergency plumber', 'Trades and services'],
    ['Accounting firm', 'Professional services'],
    ['estate agent', 'Property'],
    ['boutique hotel', 'Hospitality'],
    ['wedding photographer', 'Creative and events'],
    ['online tutoring academy', 'Education'],
  ];

  for (const [category, expected] of cases) {
    it(`${category} → ${expected}`, () => {
      expect(resolveNiche(category).niche).toBe(expected);
    });
  }
});

describe('what it does not know', () => {
  /*
   * The option that exists for exactly this, and the reason the fallback is
   * not "leave it blank": a category the list cannot express is still
   * something the crawl learned, and dropping it loses it.
   */
  it('falls back to "Something else" and keeps the original wording', () => {
    const out = resolveNiche('competitive falconry outfitter');
    expect(out.niche).toBe('Something else');
    expect(out.other).toBe('competitive falconry outfitter');
  });

  it('returns nothing for nothing, rather than guessing', () => {
    expect(resolveNiche(undefined)).toEqual({ niche: '', other: '' });
    expect(resolveNiche('')).toEqual({ niche: '', other: '' });
    expect(resolveNiche('   ')).toEqual({ niche: '', other: '' });
  });

  it('is case-insensitive, since the category is however the model wrote it', () => {
    expect(resolveNiche('JEWELLERY RETAILER').niche).toBe('Retail and e-commerce');
  });

  it('matches American and British spellings of the same trade', () => {
    expect(resolveNiche('jewelry store').niche).toBe('Retail and e-commerce');
    expect(resolveNiche('jewellery store').niche).toBe('Retail and e-commerce');
  });

  /*
   * Specific before generic. "AI sales agent platform" contains both
   * "platform" (Software) and "agency" — and it is software.
   */
  it('prefers the more specific hint when several could match', () => {
    expect(resolveNiche('SaaS platform for marketing agencies').niche).toBe('Software');
  });
});
