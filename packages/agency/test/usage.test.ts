import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { CreditStore, ToolCtx } from '@sparksocial/tools/defineTool';
import { makeOrgUsageGet } from '../src/usage.js';

/**
 * `org.usage.get` — PRD §8.12's usage slice, and §12's "what consumes credits".
 *
 * The behaviour worth pinning is the arithmetic and the exclusions: a share
 * computed against the wrong denominator, or a grant counted as consumption,
 * would both produce a panel that is confidently wrong rather than empty.
 */

/**
 * `budget` is overridden loosely on purpose: these cases care about the cap and
 * the spend, and the store's `byTool` / `allocationsCents` are `org.usage.get`'s
 * business only through `spendByTool`. Filling them in here would make every
 * case restate two fields it is not testing.
 */
type BudgetOverride = () => Promise<{ monthlyCapCents: number; spentCents: number }>;

function credits(over: Partial<Omit<CreditStore, 'budget'>> & { budget?: BudgetOverride } = {}): CreditStore {
  const budget: BudgetOverride = over.budget ?? (async () => ({ monthlyCapCents: 10_000, spentCents: 0 }));
  return {
    spendByTool: async () => [],
    record: async () => {},
    grant: async () => {},
    setBudget: async () => {},
    ...over,
    budget: async () => ({ ...(await budget()), byTool: [], allocationsCents: {} }),
  };
}

const ctx = () =>
  ({
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 10_000 },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  }) as unknown as ToolCtx;

const tool = (over: Parameters<typeof credits>[0] = {}) => makeOrgUsageGet({ credits: credits(over) });

describe('org.usage.get', () => {
  it('reports the cap, the spend and what is left', async () => {
    const out = await tool({
      budget: async () => ({ monthlyCapCents: 10_000, spentCents: 2_500 }),
    }).handler({ topTools: 10 }, ctx());

    expect(out).toMatchObject({ monthlyCapCents: 10_000, spentCents: 2_500, remainingCents: 7_500 });
    expect(out.usedFraction).toBeCloseTo(0.25);
    expect(out.alert).toBe('ok');
  });

  it('computes each tool’s share against actual spend, not against the cap', async () => {
    // Against the cap, everything reads as a few percent early in a month, and
    // "what did the money go on" becomes unanswerable.
    const out = await tool({
      budget: async () => ({ monthlyCapCents: 100_000, spentCents: 1_000 }),
      spendByTool: async () => [
        { tool: 'content.generate_avatar_video', costCents: 750, calls: 15 },
        { tool: 'publish.now', costCents: 250, calls: 25 },
      ],
    }).handler({ topTools: 10 }, ctx());

    expect(out.byTool[0]).toMatchObject({ tool: 'content.generate_avatar_video', share: 0.75 });
    expect(out.byTool[1]).toMatchObject({ tool: 'publish.now', share: 0.25 });
  });

  it('names the biggest spender in the why, which is the whole question §12 asks', async () => {
    const out = await tool({
      budget: async () => ({ monthlyCapCents: 10_000, spentCents: 900 }),
      spendByTool: async () => [{ tool: 'content.generate_dub', costCents: 900, calls: 15 }],
    }).handler({ topTools: 10 }, ctx());

    expect(out.why.summary).toContain('content.generate_dub');
    expect(out.why.factors[0]).toMatchObject({ label: 'content.generate_dub', weight: 1 });
  });

  it.each([
    [0, 'ok'],
    [4_900, 'ok'],
    [5_000, 'warning'],
    [7_900, 'warning'],
    [8_000, 'critical'],
    [9_900, 'critical'],
    [10_000, 'exhausted'],
  ])('bands %i¢ of a 10,000¢ cap as %s', async (spentCents, expected) => {
    const out = await tool({
      budget: async () => ({ monthlyCapCents: 10_000, spentCents }),
    }).handler({ topTools: 10 }, ctx());
    expect(out.alert).toBe(expected);
  });

  it('clamps an overspend rather than reporting more than 100%', async () => {
    // Arithmetically correct after an overspend and nonsense on a progress bar —
    // the same clamp `readBudget` applies to `remainingCents`.
    const out = await tool({
      budget: async () => ({ monthlyCapCents: 10_000, spentCents: 14_000 }),
    }).handler({ topTools: 10 }, ctx());

    expect(out.usedFraction).toBe(1);
    expect(out.remainingCents).toBe(0);
    expect(out.alert).toBe('exhausted');
  });

  it('refuses when no cap is configured, rather than dividing by zero', async () => {
    // A zero cap is `readBudget`'s "no ledger configured" state, not a plan.
    // Reporting infinite headroom against it would be worse than saying so.
    await expect(
      tool({ budget: async () => ({ monthlyCapCents: 0, spentCents: 0 }) }).handler({ topTools: 10 }, ctx()),
    ).rejects.toThrow(ToolError);
  });

  it('reports zero shares rather than NaN when nothing has been spent', async () => {
    const out = await tool({
      spendByTool: async () => [{ tool: 'publish.now', costCents: 0, calls: 0 }],
    }).handler({ topTools: 10 }, ctx());
    expect(out.byTool[0]!.share).toBe(0);
  });

  it('bounds the list the caller asked for without bounding what it reads', async () => {
    // `topTools` used to be passed straight to the store. It cannot be any more:
    // the category rollup is computed from the same read, and a store limit of 3
    // would silently drop the rest of the month's spend out of the categories
    // while leaving it in the headline total.
    let seen: number | undefined;
    const out = await tool({
      spendByTool: async (_o, _n, limit) => {
        seen = limit;
        return [
          { tool: 'compose.render', costCents: 40, calls: 1 },
          { tool: 'content.draft', costCents: 30, calls: 1 },
          { tool: 'publish.now', costCents: 20, calls: 1 },
          { tool: 'content.generate_image', costCents: 10, calls: 1 },
        ];
      },
    }).handler({ topTools: 3 }, ctx());

    expect(seen).toBeGreaterThanOrEqual(200);
    expect(out.byTool).toHaveLength(3);
    // The fourth tool is off the list and still inside its category.
    expect(out.byCategory.reduce((n, c) => n + c.costCents, 0)).toBe(100);
  });

  it('is not readable by a viewer or a client — spend is commercial, not editorial', () => {
    const scopes = tool().scopes;
    expect(scopes).toEqual(['owner', 'admin']);
    expect(scopes).not.toContain('client');
  });

  it('rolls the whole breakdown into categories, not just the rows on screen', async () => {
    // The bug this pins: `topTools` bounds the *list*, and if it also bounded the
    // rollup the tail would land nowhere and the categories would come to less
    // than the headline. A billing panel whose parts do not sum to its total is
    // one nobody trusts twice.
    const out = await tool({
      budget: async () => ({ monthlyCapCents: 100_000, spentCents: 1_000 }),
      spendByTool: async () => [
        { tool: 'compose.render', costCents: 600, calls: 6 },
        { tool: 'content.draft', costCents: 300, calls: 30 },
        { tool: 'publish.now', costCents: 100, calls: 10 },
      ],
    }).handler({ topTools: 1 }, ctx());

    expect(out.byTool).toHaveLength(1);
    const total = out.byCategory.reduce((n, c) => n + c.costCents, 0);
    expect(total).toBe(1_000);
    expect(out.byCategory.find((c) => c.category === 'render')).toMatchObject({ costCents: 600, calls: 6 });
    expect(out.byCategory.find((c) => c.category === 'ai_generation')).toMatchObject({ costCents: 300 });
    expect(out.byCategory.find((c) => c.category === 'delivery')).toMatchObject({ costCents: 100 });
  });

  it('emits every category, and marks the ones nothing can spend against', async () => {
    // Stable rows month to month: a category that appears and vanishes with the
    // data reads as a bug rather than as a zero. And a zero that means "this does
    // not exist yet" is a different fact from one that means "you spent nothing".
    const out = await tool({
      budget: async () => ({ monthlyCapCents: 10_000, spentCents: 0 }),
    }).handler({ topTools: 10 }, ctx());

    expect(out.byCategory.map((c) => c.category)).toEqual([
      'render',
      'transcription',
      'stock',
      'ai_generation',
      'delivery',
    ]);
    expect(out.byCategory.find((c) => c.category === 'transcription')?.unavailable).toBe(true);
    expect(out.byCategory.find((c) => c.category === 'render')?.unavailable).toBe(false);
  });

  it('keeps a free tool off the breakdown rather than bucketing it', async () => {
    // `genome.list` charges nothing. Given a category it would sit on the bill at
    // zero and bury the rows that matter.
    const out = await tool({
      budget: async () => ({ monthlyCapCents: 10_000, spentCents: 600 }),
      spendByTool: async () => [
        { tool: 'compose.render', costCents: 600, calls: 6 },
        { tool: 'genome.list', costCents: 0, calls: 400 },
      ],
    }).handler({ topTools: 10 }, ctx());

    expect(out.byCategory.reduce((n, c) => n + c.calls, 0)).toBe(6);
  });

  it('reports the same numbers in credits', async () => {
    const out = await tool({
      budget: async () => ({ monthlyCapCents: 500_00, spentCents: 314_00 }),
    }).handler({ topTools: 10 }, ctx());

    expect(out.monthlyCapCredits).toBe(25_000);
    expect(out.spentCredits).toBe(15_700);
    expect(out.remainingCredits).toBe(9_300);
  });

  it('projects the month and says when the projection clears the cap', async () => {
    vi.useFakeTimers();
    try {
      // Half of a 30-day June gone, $300 of a $500 cap spent → $600 projected.
      vi.setSystemTime(new Date('2026-06-16T00:00:00Z'));
      const out = await tool({
        budget: async () => ({ monthlyCapCents: 500_00, spentCents: 300_00 }),
      }).handler({ topTools: 10 }, ctx());

      expect(out.forecastCents).toBe(600_00);
      expect(out.forecastCredits).toBe(30_000);
      expect(out.forecastOverCap).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('omits the projection on the first day instead of guessing', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-01T04:00:00Z'));
      const out = await tool({
        budget: async () => ({ monthlyCapCents: 500_00, spentCents: 14_00 }),
      }).handler({ topTools: 10 }, ctx());

      expect(out.forecastCents).toBeUndefined();
      expect(out.forecastOverCap).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
