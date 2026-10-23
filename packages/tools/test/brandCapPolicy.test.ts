import { describe, expect, it } from 'vitest';
import { evaluate, type PolicyInput } from '../src/policy.js';

/**
 * The hard per-brand cap — `budget.brand_exceeded`.
 *
 * `credit_ledger` has carried `brand_id` on every row since it was written, so
 * an agency could always see that one client had eaten the month. It could not
 * stop the next one: the only ceiling was the org's, and the first brand to
 * spend it spent everybody's. `org.budget.set`'s category sub-caps bound what
 * the money goes on, never who spends it.
 *
 * Hard rather than soft on purpose. `org.usage.get` already warns, in bands at
 * 50/80/100%, and warnings were never the missing piece — a limit that only
 * warned leaves the agency able to describe the overspend and unable to
 * prevent it.
 */
function input(over: Partial<PolicyInput> = {}): PolicyInput {
  return {
    tool: { name: 'content.generate_image', effect: 'spend', autonomy: 'auto', scopes: ['owner'] },
    caller: 'user',
    role: 'owner',
    now: new Date('2026-10-23T10:00:00Z'),
    brand: { createdAt: new Date('2026-01-01T00:00:00Z'), approvalMode: 'autopublish' },
    subject: {},
    budget: { remainingCents: 100_00, estimatedCents: 40 },
    ...over,
  } as PolicyInput;
}

describe('a brand cannot spend past its own ceiling', () => {
  it('refuses a call that would cross it', () => {
    const d = evaluate(
      input({ budget: { remainingCents: 100_00, estimatedCents: 40, brand: { name: 'this brand', remainingCents: 20 } } }),
    );

    expect(d.kind).toBe('deny');
    expect(d.kind === 'deny' && d.ruleId).toBe('budget.brand_exceeded');
  });

  it('allows one that fits', () => {
    const d = evaluate(
      input({ budget: { remainingCents: 100_00, estimatedCents: 40, brand: { name: 'this brand', remainingCents: 400 } } }),
    );

    expect(d.kind).toBe('allow');
  });

  /*
   * Absent is unlimited-within-the-org, which is every brand until an owner
   * sets a number. Reading a missing cap as zero would freeze an entire
   * organisation the moment this shipped.
   */
  it('does not invent a ceiling for a brand that has none', () => {
    const d = evaluate(input({ budget: { remainingCents: 100_00, estimatedCents: 40 } }));

    expect(d.kind).toBe('allow');
  });

  /*
   * Order matters. The most useful answer is the one a person cannot fix by
   * raising something smaller — "the organisation is out" beats "this client
   * is out", which beats "this client's render allocation is out".
   */
  it('reports the organisation first when both are exhausted', () => {
    const d = evaluate(
      input({ budget: { remainingCents: 10, estimatedCents: 40, brand: { name: 'this brand', remainingCents: 5 } } }),
    );

    expect(d.kind === 'deny' && d.ruleId).toBe('budget.exceeded');
  });

  it('reports the brand before its category', () => {
    const d = evaluate(
      input({
        budget: {
          remainingCents: 100_00,
          estimatedCents: 40,
          brand: { name: 'this brand', remainingCents: 5 },
          category: { name: 'Render', remainingCents: 5 },
        },
      }),
    );

    expect(d.kind === 'deny' && d.ruleId).toBe('budget.brand_exceeded');
  });

  /*
   * A ceiling is not a permission, so no capability lifts it — the same stance
   * rule 4 already takes for the org cap, and for the same reason: a group
   * that could spend past the cap would make the cap advisory.
   */
  it('is not liftable by a capability', () => {
    const d = evaluate(
      input({
        capabilities: ['spend_credits'],
        budget: { remainingCents: 100_00, estimatedCents: 40, brand: { name: 'this brand', remainingCents: 1 } },
      }),
    );

    expect(d.kind === 'deny' && d.ruleId).toBe('budget.brand_exceeded');
  });
});
