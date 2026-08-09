import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { CampaignStore, ToolCtx } from '@sparksocial/tools';
import { GOLDEN_SET } from '@sparksocial/playbooks';
import { calendarGenerate, calendarGet, campaignCreate } from '../src/calendarTool.js';

/**
 * The tool layer around §6.8 Steps 1–4. The behaviours asserted here are the
 * ones that only exist at this level: what the store is asked to do, and what
 * happens on the *second* call — because Step 4 is a review loop and
 * regeneration is the normal path, not the exception.
 */

const barber = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_barber')!;
const START = new Date('2026-09-01T09:00:00.000Z');

/** In-memory campaign store with the same scoping rules as Postgres. */
function store(): CampaignStore & { slotWrites: number[] } {
  const rows = new Map<string, Record<string, unknown> & { orgId: string }>();
  const slots = new Map<string, Array<Record<string, unknown>>>();
  const slotWrites: number[] = [];
  let n = 0;

  return {
    slotWrites,
    async create(args) {
      const id = `cmp_${++n}`;
      rows.set(id, { ...args, id, status: 'draft' });
      slots.set(id, []);
      return { id };
    },
    async get(id, orgId) {
      const r = rows.get(id);
      return r && r.orgId === orgId ? (r as never) : undefined;
    },
    async listForGenome() {
      return [];
    },
    async replaceSlots({ campaignId, slots: next }) {
      slotWrites.push(next.length);
      // Replacement, matching the real store — the assertion below depends on
      // this being a replace and not an append.
      slots.set(campaignId, next.map((s) => ({ ...s, id: `slot_${Math.random()}`, status: 'scheduled' })));
      return next.length;
    },
    async slots(campaignId) {
      return (slots.get(campaignId) ?? []) as never;
    },
    async setStatus() {},
  };
}

function ctx(campaigns: CampaignStore, over: { genome?: unknown } = {}): ToolCtx {
  return {
    orgId: 'org_1',
    brandId: 'ws_gen_barber',
    genomeId: 'gen_barber',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: {
        createDraft: async () => ({ id: 'g' }),
        patchDimensions: async () => ({ id: 'g', version: 1 }),
        get: async () => ('genome' in over ? over.genome : barber.genome),
        listForOrg: async () => [],
      },
      assets: {
        inventory: async () => barber.assets,
        retrieve: async () => [],
        create: async () => ({ id: 'a' }),
        captionsByRole: async () => [],
        info: async () => ({}),
      },
      content: { recent: async () => [] },
      campaigns,
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

const create = (c: ToolCtx) =>
  campaignCreate.handler(
    { genomeId: 'gen_barber', name: 'September', objective: 'bookings', windowDays: 30, startAt: START.toISOString() },
    c,
  );

describe('campaign.create', () => {
  it('snapshots the plan rather than leaving it to be recomputed', async () => {
    const s = store();
    const spy = vi.spyOn(s, 'create');
    await create(ctx(s));

    // The resolver and the Asset Graph both move underneath a live campaign;
    // reopening it in week three must show the numbers the owner agreed to.
    const args = spy.mock.calls[0]![0];
    expect(args.plan).toBeDefined();
    expect(args.plan).toHaveProperty('buildableNow');
    expect(args.plan).toHaveProperty('mix');
  });

  it('takes orgId from the context, never the input', async () => {
    const s = store();
    const spy = vi.spyOn(s, 'create');
    await create(ctx(s));
    expect(spy.mock.calls[0]![0].orgId).toBe('org_1');
  });

  it('refuses an out-of-scope genome', async () => {
    await expect(create(ctx(store(), { genome: undefined }))).rejects.toThrow(ToolError);
  });
});

describe('calendar.generate', () => {
  let s: ReturnType<typeof store>;
  beforeEach(() => {
    s = store();
  });

  it('writes a full calendar for a real genome', async () => {
    const c = ctx(s);
    const { campaignId } = await create(c);
    const out = await calendarGenerate.handler({ campaignId }, c);

    expect(out.slotCount).toBeGreaterThan(0);
    expect(out.slots).toHaveLength(out.slotCount);
    // Every slot must be renderable by something — a slot with no format is a
    // hole the calendar cannot fill later.
    for (const slot of out.slots) {
      expect(slot.playbookId).toBeTruthy();
      expect(slot.playbookName).toBeTruthy();
    }
  });

  it('REPLACES on regeneration instead of stacking a second month', async () => {
    // Step 4 is a loop: adjust the mix, regenerate, look again. Appending would
    // silently double the month on the first adjustment.
    const c = ctx(s);
    const { campaignId } = await create(c);

    const first = await calendarGenerate.handler({ campaignId }, c);
    const second = await calendarGenerate.handler({ campaignId }, c);

    expect(second.slotCount).toBe(first.slotCount);
    expect((await s.slots(campaignId, 'org_1', 'gen_barber')).length).toBe(first.slotCount);
  });

  it('is deterministic without an override, so a regeneration is comparable', async () => {
    const c = ctx(s);
    const { campaignId } = await create(c);
    const a = await calendarGenerate.handler({ campaignId }, c);
    const b = await calendarGenerate.handler({ campaignId }, c);
    expect(b.slots).toEqual(a.slots);
  });

  it('a mix override shifts the pillar balance', async () => {
    // "less offer, more craft" — the adjustment must actually move the mix.
    const c = ctx(s);
    const { campaignId } = await create(c);

    const before = await calendarGenerate.handler({ campaignId }, c);
    const after = await calendarGenerate.handler(
      { campaignId, mixOverride: { product: 0.05, community: 0.45 } },
      c,
    );

    const count = (slots: typeof before.slots, pillar: string) =>
      slots.filter((s2) => s2.pillar === pillar).length;

    expect(count(after.slots, 'product')).toBeLessThan(count(before.slots, 'product'));
    expect(count(after.slots, 'community')).toBeGreaterThan(count(before.slots, 'community'));
  });

  it('an override cannot push promotional content past the ceiling', async () => {
    // The override routes through `deriveMix`, which re-caps — a user
    // preference must not be able to do what the learning loop cannot.
    const c = ctx(s);
    const { campaignId } = await create(c);
    const out = await calendarGenerate.handler({ campaignId, mixOverride: { product: 1 } }, c);

    const product = out.slots.filter((s2) => s2.pillar === 'product').length;
    expect(product / out.slots.length).toBeLessThanOrEqual(0.35);
  });

  it('refuses a campaign belonging to another org', async () => {
    const c = ctx(s);
    const { campaignId } = await create(c);

    const other = ctx(s);
    (other as { orgId: string }).orgId = 'org_attacker';

    await expect(calendarGenerate.handler({ campaignId }, other)).rejects.toThrow(ToolError);
  });
});

describe('calendar.get', () => {
  it('reports the actual mix, which is what Step 4 is reviewed at', async () => {
    const s = store();
    const c = ctx(s);
    const { campaignId } = await create(c);
    await calendarGenerate.handler({ campaignId }, c);

    const out = await calendarGet.handler({ campaignId }, c);
    const summed = out.mixActual.reduce((acc, m) => acc + m.count, 0);
    expect(summed).toBe(out.slots.length);
    // Ordered heaviest-first, so the shape of the month reads at a glance.
    expect(out.mixActual.map((m) => m.count)).toEqual([...out.mixActual.map((m) => m.count)].sort((a, b) => b - a));
  });

  it('is readable by every role — a calendar a client cannot see is not a review surface', () => {
    expect(calendarGet.scopes).toContain('client');
    expect(calendarGet.scopes).toContain('viewer');
    expect(calendarGet.effect).toBe('read');
  });

  it('refuses a campaign belonging to another org', async () => {
    const s = store();
    const c = ctx(s);
    const { campaignId } = await create(c);

    const other = ctx(s);
    (other as { orgId: string }).orgId = 'org_attacker';

    await expect(calendarGet.handler({ campaignId }, other)).rejects.toThrow(ToolError);
  });
});
