import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { CreditStore, ToolCtx } from '@sparksocial/tools/defineTool';
import { makeOrgBudgetSet } from '../src/budget.js';

/**
 * `org.budget.set` — the write behind the allocation bars.
 *
 * The behaviour worth pinning is the two refusals. Both exist so that a number
 * on the screen means what it looks like it means: allocations that could exceed
 * the cap would show headroom that is not there, and a cap that could be raised
 * past the plan would make the plan tier decorative.
 */

function store(seed: { monthlyCapCents?: number; allocationsCents?: Record<string, number> } = {}) {
  const state = {
    monthlyCapCents: seed.monthlyCapCents ?? 500_00,
    allocationsCents: { ...(seed.allocationsCents ?? {}) },
  };
  const credits: Pick<CreditStore, 'budget' | 'setBudget'> = {
    budget: async () => ({ ...state, spentCents: 0, byTool: [], allocationsCents: { ...state.allocationsCents } }),
    setBudget: async ({ monthlyCapCents, allocationsCents }) => {
      if (monthlyCapCents !== undefined) state.monthlyCapCents = monthlyCapCents;
      if (allocationsCents !== undefined) state.allocationsCents = { ...allocationsCents };
    },
  };
  return { state, credits };
}

const ctx = (plan = 'starter') =>
  ({
    orgId: 'org_1',
    role: 'owner',
    db: {
      orgSettings: {
        get: async () => ({ orgId: 'org_1', plan, monthlyCapCents: 500_00, updatedAt: new Date() }),
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  }) as unknown as ToolCtx;

const tool = (seed?: Parameters<typeof store>[0]) => {
  const s = store(seed);
  return { tool: makeOrgBudgetSet({ credits: s.credits }), state: s.state };
};

describe('org.budget.set', () => {
  it('lets a workspace hold itself below what its plan allows', async () => {
    const { tool: t, state } = tool();
    const out = await t.handler({ monthlyCapCents: 200_00 }, ctx());

    expect(state.monthlyCapCents).toBe(200_00);
    expect(out.monthlyCapCredits).toBe(10_000);
  });

  it('refuses a cap above the plan, and names the plan', async () => {
    // Otherwise the tier is decorative: an owner grants themselves headroom on a
    // settings screen and the billing plan means nothing.
    const { tool: t, state } = tool();
    await expect(t.handler({ monthlyCapCents: 900_00 }, ctx('starter'))).rejects.toThrow(ToolError);
    await expect(t.handler({ monthlyCapCents: 900_00 }, ctx('starter'))).rejects.toThrow(/starter/);
    expect(state.monthlyCapCents).toBe(500_00);
  });

  it('lets a larger plan set a larger cap', async () => {
    const { tool: t, state } = tool();
    await t.handler({ monthlyCapCents: 900_00 }, ctx('growth'));
    expect(state.monthlyCapCents).toBe(900_00);
  });

  it('refuses allocations that add up to more than the cap', async () => {
    // The check that keeps the bars honest. Allocate $900 of a $500 limit and
    // every bar reads as having room, while the first refusal comes from the
    // monthly cap with a message about a limit the screen never showed as close.
    const { tool: t, state } = tool();
    await expect(
      t.handler({ allocationsCents: { render: 400_00, ai_generation: 300_00 } }, ctx()),
    ).rejects.toThrow(/more than the \$500\.00 monthly limit/);
    expect(state.allocationsCents).toEqual({});
  });

  it('accepts allocations that fit, and reports the unallocated remainder', async () => {
    const { tool: t, state } = tool();
    const out = await t.handler({ allocationsCents: { render: 300_00, ai_generation: 100_00 } }, ctx());

    expect(state.allocationsCents).toEqual({ render: 300_00, ai_generation: 100_00 });
    // What a category with no sub-cap has left to draw on.
    expect(out.unallocatedCents).toBe(100_00);
    expect(out.allocations.find((a) => a.category === 'render')).toMatchObject({
      label: 'Render',
      capCredits: 15_000,
    });
  });

  it('checks allocations against the cap being set, not the one being replaced', async () => {
    // Lowering the cap and the allocations together must be one decision. Checked
    // against the old cap, this passes and leaves the workspace over-allocated.
    const { tool: t } = tool({ allocationsCents: { render: 400_00 } });
    await expect(
      t.handler({ monthlyCapCents: 200_00, allocationsCents: { render: 400_00 } }, ctx()),
    ).rejects.toThrow(/more than the \$200\.00 monthly limit/);
  });

  it('re-checks the stored allocations when only the cap moves', async () => {
    // Lowering the cap under allocations that were valid before is the same
    // over-allocation, arrived at from the other side.
    const { tool: t } = tool({ allocationsCents: { render: 400_00 } });
    await expect(t.handler({ monthlyCapCents: 200_00 }, ctx())).rejects.toThrow(/more than/);
  });

  it('treats a category left out as a sub-cap removed', async () => {
    // Replacement, not merge: with a merge there is no way to say "this category
    // is no longer bounded" without inventing a second verb.
    const { tool: t, state } = tool({ allocationsCents: { render: 300_00, ai_generation: 100_00 } });
    await t.handler({ allocationsCents: { render: 300_00 } }, ctx());
    expect(state.allocationsCents).toEqual({ render: 300_00 });
  });

  it('leaves allocations alone when only the cap is sent', async () => {
    const { tool: t, state } = tool({ allocationsCents: { render: 100_00 } });
    await t.handler({ monthlyCapCents: 400_00 }, ctx());
    expect(state.allocationsCents).toEqual({ render: 100_00 });
  });

  it('refuses a category the workspace does not have', async () => {
    const { tool: t } = tool();
    await expect(t.handler({ allocationsCents: { rendering: 100_00 } }, ctx())).rejects.toThrow(
      /Not a kind of spending/,
    );
  });

  it('accepts an explicit zero, which is not the same as removing the sub-cap', async () => {
    // "Spend nothing on this" is a real instruction, and `policy.ts` enforces it.
    const { tool: t, state } = tool();
    await t.handler({ allocationsCents: { stock: 0 } }, ctx());
    expect(state.allocationsCents).toEqual({ stock: 0 });
  });

  it('is owner-only — a spend ceiling an admin can raise is not a ceiling', () => {
    const { tool: t } = tool();
    expect(t.scopes).toEqual(['owner']);
  });
});
