import { describe, expect, it } from 'vitest';
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

function credits(over: Partial<CreditStore> = {}): CreditStore {
  return {
    budget: async () => ({ monthlyCapCents: 10_000, spentCents: 0 }),
    spendByTool: async () => [],
    record: async () => {},
    grant: async () => {},
    ...over,
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

const tool = (over: Partial<CreditStore> = {}) => makeOrgUsageGet({ credits: credits(over) });

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

  it('passes the caller’s limit through to the store', async () => {
    let seen: number | undefined;
    await tool({
      spendByTool: async (_o, _n, limit) => {
        seen = limit;
        return [];
      },
    }).handler({ topTools: 3 }, ctx());
    expect(seen).toBe(3);
  });

  it('is not readable by a viewer or a client — spend is commercial, not editorial', () => {
    const scopes = tool().scopes;
    expect(scopes).toEqual(['owner', 'admin']);
    expect(scopes).not.toContain('client');
  });
});
