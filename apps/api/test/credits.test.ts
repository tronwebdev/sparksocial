import { describe, expect, it } from 'vitest';
import { evaluate } from '@sparksocial/tools';
import { periodStart } from '@sparksocial/db/creditRepository';
import { createDevCreditStore } from '../src/dev-credits.js';
import { readBudget } from '../src/budget.js';

/**
 * SPEND — plan §9.
 *
 * `policy.ts` rule 4 has denied over-budget calls since P1 and both resolvers
 * hardcoded `remainingCents: 100_000`, so it could not fire. These tests are
 * mostly about the end-to-end property: that a charge on the ledger eventually
 * stops a call.
 */

const spend = (cents: number, over: Record<string, unknown> = {}) => ({
  callId: `call_${Math.random()}`,
  orgId: 'org_1',
  tool: 'assemble.plan',
  costCents: cents,
  at: new Date('2026-08-11T12:00:00Z'),
  ...over,
});

describe('the ledger', () => {
  it('accumulates spend within the period', async () => {
    const c = createDevCreditStore(1_000);
    await c.record(spend(300));
    await c.record(spend(250));

    expect(await c.budget('org_1', new Date('2026-08-11T12:00:00Z'))).toEqual({
      monthlyCapCents: 1_000,
      spentCents: 550,
    });
  });

  it('charges a call once, however many times it is recorded', async () => {
    // The property the unique index on `call_id` enforces in Postgres.
    // `invokeTool` already returns early on an idempotent replay, so this is
    // the backstop for a retry introduced at some other layer later.
    const c = createDevCreditStore(1_000);
    const one = spend(400, { callId: 'call_fixed' });
    await c.record(one);
    await c.record(one);
    await c.record({ ...one, costCents: 999 });

    expect((await c.budget('org_1', new Date('2026-08-11T12:00:00Z'))).spentCents).toBe(400);
  });

  it('does not leak one org’s spend into another', async () => {
    const c = createDevCreditStore(1_000);
    await c.record(spend(900));
    await c.record(spend(50, { orgId: 'org_2' }));

    expect((await c.budget('org_1', new Date('2026-08-11T12:00:00Z'))).spentCents).toBe(900);
    expect((await c.budget('org_2', new Date('2026-08-11T12:00:00Z'))).spentCents).toBe(50);
  });

  it('excludes spend from a previous month', async () => {
    // The reset. Without it a cap is a lifetime limit, and every account
    // eventually stops working.
    const c = createDevCreditStore(1_000);
    await c.record(spend(900, { at: new Date('2026-07-31T23:59:59Z') }));

    expect((await c.budget('org_1', new Date('2026-08-01T00:00:00Z'))).spentCents).toBe(0);
  });

  it('counts spend from the first instant of the month', async () => {
    // The boundary itself, which an off-by-one on `>=` would drop.
    const c = createDevCreditStore(1_000);
    await c.record(spend(120, { at: new Date('2026-08-01T00:00:00Z') }));

    expect((await c.budget('org_1', new Date('2026-08-20T00:00:00Z'))).spentCents).toBe(120);
  });

  it('accepts a refund as a negative charge', async () => {
    // Corrections are new rows, never edits — the ledger stays a record of what
    // happened rather than a mutable current value.
    const c = createDevCreditStore(1_000);
    await c.record(spend(500));
    await c.record(spend(-200, { tool: 'refund' }));

    expect((await c.budget('org_1', new Date('2026-08-11T12:00:00Z'))).spentCents).toBe(300);
  });
});

describe('periodStart', () => {
  it('is the first instant of the UTC month', () => {
    expect(periodStart(new Date('2026-08-11T23:30:00Z')).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('does not move with the caller’s timezone', () => {
    // A boundary that shifted per viewer would let one ledger produce two
    // balances, and a spend limit cannot be ambiguous about which side of the
    // line a charge fell on.
    const early = periodStart(new Date('2026-08-01T00:30:00Z'));
    const late = periodStart(new Date('2026-08-31T23:30:00Z'));
    expect(early.toISOString()).toBe(late.toISOString());
  });
});

describe('readBudget', () => {
  it('reports what is left', async () => {
    const c = createDevCreditStore(1_000);
    await c.record(spend(600));

    expect(await readBudget(c, 'org_1', new Date('2026-08-11T12:00:00Z'))).toEqual({
      remainingCents: 400,
      monthlyCapCents: 1_000,
    });
  });

  it('clamps an overspend to zero rather than reporting a negative', async () => {
    const c = createDevCreditStore(1_000);
    await c.record(spend(1_500));

    expect((await readBudget(c, 'org_1', new Date('2026-08-11T12:00:00Z'))).remainingCents).toBe(0);
  });

  it('is permissive with no ledger configured', async () => {
    // The one place permissive is right: a missing ledger is a
    // misconfiguration, and failing every paid call closed would take the
    // product down rather than protect anyone's money. `index.ts` warns at boot.
    expect((await readBudget(undefined, 'org_1')).remainingCents).toBeGreaterThan(0);
  });
});

describe('the ledger actually reaches the policy engine', () => {
  const spendCall = (budget: { remainingCents: number; monthlyCapCents: number }, estimatedCents: number) => ({
    tool: { name: 'assemble.plan', effect: 'spend' as const, autonomy: 'auto' as const, scopes: ['owner' as const] },
    caller: 'agent' as const,
    role: 'owner' as const,
    now: new Date('2026-08-11T12:00:00Z'),
    brand: { createdAt: new Date('2026-01-01T00:00:00Z'), approvalMode: 'autopublish' as const, agentPaused: false },
    budget: { remainingCents: budget.remainingCents, estimatedCents },
  });

  it('allows a call the org can afford', async () => {
    const c = createDevCreditStore(1_000);
    await c.record(spend(200));
    const budget = await readBudget(c, 'org_1', new Date('2026-08-11T12:00:00Z'));

    expect(evaluate(spendCall(budget, 500)).kind).not.toBe('deny');
  });

  it('denies once the ledger says the money is gone', async () => {
    // The end-to-end property. Everything else is plumbing toward this.
    const c = createDevCreditStore(1_000);
    await c.record(spend(950));
    const budget = await readBudget(c, 'org_1', new Date('2026-08-11T12:00:00Z'));

    const decision = evaluate(spendCall(budget, 500));
    expect(decision.kind).toBe('deny');
    expect(decision.kind === 'deny' && decision.ruleId).toBe('budget.exceeded');
  });

  it('lets the same call through again next month', async () => {
    const c = createDevCreditStore(1_000);
    await c.record(spend(950));
    const next = await readBudget(c, 'org_1', new Date('2026-09-01T00:00:00Z'));

    expect(evaluate(spendCall(next, 500)).kind).not.toBe('deny');
  });

  it('does not gate a free tool on a drained budget', async () => {
    // Rule 4 keys on `effect: 'spend'`. An exhausted budget must not stop
    // someone reading their own Timeline to find out why it drained.
    const c = createDevCreditStore(1_000);
    await c.record(spend(1_000));
    const budget = await readBudget(c, 'org_1', new Date('2026-08-11T12:00:00Z'));

    const read = { ...spendCall(budget, 0), tool: { ...spendCall(budget, 0).tool, effect: 'read' as const } };
    expect(evaluate(read)).toEqual({ kind: 'allow' });
  });
});
