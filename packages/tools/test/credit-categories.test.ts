import { describe, expect, it } from 'vitest';
import { relative } from 'node:path';
import {
  CATEGORIES_WITHOUT_TOOLS,
  CATEGORISED_TOOLS,
  CENTS_PER_CREDIT,
  CREDIT_CATEGORIES,
  centsToCredits,
  creditCategoryFor,
  creditsToCents,
  forecastCents,
} from '@sparksocial/shared/credits';
import { REPO_ROOT, declaredTools } from './support/toolSource.js';

/**
 * A STATIC CHECK OVER THE REGISTRY: every tool that can spend money has a credit
 * category.
 *
 * The Credit & Usage screen's whole claim is that its rows add up to its
 * headline. A tool that charges and belongs to no category breaks that claim
 * silently — the money still leaves, the total still moves, and the breakdown
 * quietly stops summing. Nobody notices until a customer asks where $40 went and
 * the answer is four rows that come to $12.
 *
 * The map lives in `packages/shared/src/credits.ts` and is written by hand, on
 * purpose: `effect` distinguishes read from publish, and the name prefix groups
 * by domain rather than by what the money bought, so neither can tell a 50c
 * vendor render from a 2c model call. That is exactly the distinction the screen
 * exists to draw. A hand-written map needs a check that it stayed complete;
 * that is this file.
 */

/** Tools declaring `estimateCents` — the ones that can charge. */
function costBearingTools(): Array<{ name: string; file: string }> {
  return declaredTools()
    .filter((t) => /estimateCents:/.test(t.block))
    .map((t) => ({ name: t.name, file: relative(REPO_ROOT, t.file) }));
}

describe('credit categories', () => {
  it('finds the tools it is guarding, so an empty list cannot pass silently', () => {
    const tools = costBearingTools();
    expect(tools.length).toBeGreaterThan(20);
    expect(tools.map((t) => t.name)).toContain('compose.render');
    expect(tools.map((t) => t.name)).toContain('content.draft');
  });

  it('every cost-bearing tool has a category', () => {
    const missing = costBearingTools()
      .filter((t) => !creditCategoryFor(t.name))
      .map((t) => `${t.name}  (${t.file})`);

    expect(
      missing,
      'These tools declare `estimateCents`, so they charge real money, but they are in no credit ' +
        'category — their spend lands in the headline total and in none of the rows beneath it, and ' +
        'the Credit & Usage screen stops adding up. Add each to `CATEGORY_BY_TOOL` in ' +
        '`packages/shared/src/credits.ts`, choosing by what the money bought rather than by the ' +
        `name prefix.\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('has no category entry for a tool that no longer exists', () => {
    // The other direction. A stale entry is harmless to the arithmetic and fatal
    // to trust in the map: it makes the list look maintained when it is not.
    const declared = new Set(declaredTools().map((t) => t.name));
    const stale = CATEGORISED_TOOLS.filter((name) => !declared.has(name));
    expect(stale, `Categorised tools that are no longer declared anywhere: ${stale.join(', ')}`).toEqual([]);
  });

  it('names no category the design does not have', () => {
    for (const name of CATEGORISED_TOOLS) {
      expect(CREDIT_CATEGORIES).toContain(creditCategoryFor(name));
    }
  });

  it('the two empty categories really are empty', () => {
    // If a transcription or stock tool ever lands, this fails and the screen's
    // "not available yet" note has to come off with it — otherwise it would keep
    // explaining away a zero that is now a real number.
    for (const category of CATEGORIES_WITHOUT_TOOLS) {
      expect(CATEGORISED_TOOLS.filter((n) => creditCategoryFor(n) === category)).toEqual([]);
    }
  });
});

describe('credit arithmetic', () => {
  it('converts at the rate the starter plan was priced against', () => {
    // $500 cap ÷ the prototype's 25,000 credits. If this changes, it is a pricing
    // decision and it should be visible in a diff rather than inferred later.
    expect(CENTS_PER_CREDIT).toBe(2);
    expect(centsToCredits(500_00)).toBe(25_000);
  });

  it('rounds a part-credit up, so a 1c call is never free', () => {
    expect(centsToCredits(1)).toBe(1);
    expect(centsToCredits(3)).toBe(2);
    expect(centsToCredits(0)).toBe(0);
  });

  it('never reports negative credits for a cap already blown through', () => {
    expect(centsToCredits(-500)).toBe(0);
    expect(creditsToCents(-10)).toBe(0);
  });

  it('projects a part-month straight to month end', () => {
    // 10 days into a 30-day month, $30 spent → $90 projected.
    expect(
      forecastCents({
        spentCents: 30_00,
        periodStart: new Date('2026-06-01T00:00:00Z'),
        now: new Date('2026-06-11T00:00:00Z'),
        daysInPeriod: 30,
      }),
    ).toBe(90_00);
  });

  it('declines to project on the first day', () => {
    // A 30× multiplier off four hours of history is a number worse than none.
    expect(
      forecastCents({
        spentCents: 14_00,
        periodStart: new Date('2026-06-01T00:00:00Z'),
        now: new Date('2026-06-01T04:00:00Z'),
        daysInPeriod: 30,
      }),
    ).toBeUndefined();
  });
});
