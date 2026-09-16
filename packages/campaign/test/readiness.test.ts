import { describe, expect, it } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools/defineTool';
import { lagosBarbershop } from '@sparksocial/playbooks';
import { makeCampaignReadiness } from '../src/readiness.js';

/**
 * `campaign.readiness` — what would stop a campaign producing anything.
 *
 * The behaviour worth pinning is the split. A checklist that cannot tell "this
 * will not work" from "this could be better" gets clicked past, and the one time
 * it mattered looks exactly like the twenty times it did not.
 */

/*
 * A real golden fixture, not one written here.
 *
 * Two attempts at hand-building this failed in different places — first on
 * `learned`, which the resolver reads unguarded three packages away, then on six
 * more required identity fields. `lagosBarbershop` is already a valid genome the
 * playbook suite exercises, and a fixture that is merely *plausible* is how a
 * test ends up asserting against a shape the product never produces.
 *
 * It is also the right shape for this test: a trade with physical craft to show
 * and an empty asset library, which is exactly the brand this checklist exists
 * for.
 */
const genome = lagosBarbershop.genome as never;

function ctx(over: { inventory?: Record<string, number>; connected?: string[] } = {}): ToolCtx {
  const inventory = over.inventory ?? {};
  const connected = new Set(over.connected ?? []);
  return {
    orgId: 'org_1',
    brandId: 'brand_1',
    genomeId: 'gen_1',
    userId: 'user_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: { get: async () => genome },
      assets: { inventory: async () => inventory },
      oauthConnections: { get: async (_g: string, _o: string, p: string) => (connected.has(p) ? { id: 'c' } : undefined) },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

const tool = makeCampaignReadiness({ supportedPlatforms: () => ['instagram', 'x'] });
const run = (c: ToolCtx) => tool.handler({ genomeId: 'gen_1', objective: 'bookings', windowDays: 30 }, c);

describe('campaign.readiness', () => {
  it('calls a brand with nothing connected a blocker, not a warning', async () => {
    /*
     * The most expensive failure to find late: the calendar fills, every post
     * drafts, and nothing leaves the building. Every other item costs output;
     * this one costs the entire point.
     */
    const out = await run(ctx({ connected: [] }));
    const connection = out.items.find((i) => i.id === 'connection:none');
    expect(connection).toBeDefined();
    expect(connection!.severity).toBe('blocker');
    expect(out.ready).toBe(false);
  });

  it('drops the connection item once one account is connected', async () => {
    const out = await run(ctx({ connected: ['x'] }));
    expect(out.items.find((i) => i.id === 'connection:none')).toBeUndefined();
  });

  it('never reports ready while a blocker stands', async () => {
    const out = await run(ctx({ connected: [] }));
    expect(out.ready).toBe(false);
    expect(out.items.some((i) => i.severity === 'blocker')).toBe(true);
  });

  it('points a missing asset at the screen that fixes it', async () => {
    // A message naming a gap and not its screen is a better error and still a
    // dead end.
    const out = await run(ctx({ connected: ['x'] }));
    for (const item of out.items) {
      expect(item.fixWith.length).toBeGreaterThan(0);
      expect(item.label).not.toMatch(/_/); // never a raw enum or schema path
    }
  });

  it('reports progress as buildable-today against the window ceiling', async () => {
    const out = await run(ctx({ connected: ['x'] }));
    expect(out.potentialTotal).toBeGreaterThanOrEqual(out.buildableNow);
    expect(out.buildableNow).toBeGreaterThanOrEqual(0);
  });

  it('carries a why, like every tool whose output drives a decision', async () => {
    const out = await run(ctx({ connected: ['x'] }));
    expect(out.why.summary.length).toBeGreaterThan(0);
    expect(out.why.factors.length).toBeGreaterThan(0);
  });

  it('refuses a genome that is not the selected one', async () => {
    await expect(
      tool.handler({ genomeId: 'gen_other', objective: 'bookings', windowDays: 30 }, ctx()),
    ).rejects.toThrow(/not the one selected/);
  });

  it('is a read — it must never be the thing that creates a campaign', async () => {
    expect(tool.effect).toBe('read');
    expect(tool.idempotent).toBe(true);
  });
});
