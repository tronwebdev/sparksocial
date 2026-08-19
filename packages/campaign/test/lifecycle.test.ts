import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { CampaignStore, ToolCtx } from '@sparksocial/tools';
import { campaignDuplicate, campaignPause, campaignResume } from '../src/lifecycle.js';

/**
 * `campaign.duplicate` / `.pause` / `.resume` — `CampaignStore.setStatus` has
 * existed since the calendar tools shipped; nothing ever called it until now.
 * What matters: pause/resume actually reach the store (not a silent no-op),
 * duplicate copies the plan snapshot rather than recomputing it, and a
 * cross-genome duplicate attempt is refused rather than silently succeeding.
 */

function store(): CampaignStore & { statusWrites: Array<{ campaignId: string; status: string }> } {
  const rows = new Map<string, Record<string, unknown> & { orgId: string; genomeId: string }>();
  const statusWrites: Array<{ campaignId: string; status: string }> = [];
  let n = 0;

  return {
    statusWrites,
    async create(args) {
      const id = `cmp_${++n}`;
      rows.set(id, { ...args, id, status: 'draft' });
      return { id };
    },
    async get(id, orgId) {
      const r = rows.get(id);
      return r && r.orgId === orgId ? (r as never) : undefined;
    },
    async listForGenome(genomeId, orgId, limit) {
      return [...rows.values()]
        .filter((r) => r.genomeId === genomeId && r.orgId === orgId)
        .slice(0, limit) as never;
    },
    async replaceSlots() {
      return 0;
    },
    async slots() {
      return [];
    },
    async setStatus(campaignId, orgId, status) {
      const r = rows.get(campaignId);
      if (!r || r.orgId !== orgId) throw new ToolError('NOT_FOUND', 'No such campaign.', { campaignId });
      r.status = status;
      statusWrites.push({ campaignId, status });
    },
  };
}

function ctx(campaigns: CampaignStore): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: { campaigns },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('campaign.pause / campaign.resume', () => {
  it('pause actually reaches the store, not a silent no-op', async () => {
    const s = store();
    const { id } = await s.create({ orgId: 'org_1', genomeId: 'gen_1', name: 'Sept', objective: 'bookings', windowDays: 30, startAt: new Date(), plan: {} });

    const out = await campaignPause.handler({ campaignId: id }, ctx(s));

    expect(out).toEqual({ campaignId: id, status: 'paused' });
    expect(s.statusWrites).toEqual([{ campaignId: id, status: 'paused' }]);
    expect((await s.get(id, 'org_1'))?.status).toBe('paused');
  });

  it('resume sets status back to active', async () => {
    const s = store();
    const { id } = await s.create({ orgId: 'org_1', genomeId: 'gen_1', name: 'Sept', objective: 'bookings', windowDays: 30, startAt: new Date(), plan: {} });
    await campaignPause.handler({ campaignId: id }, ctx(s));

    const out = await campaignResume.handler({ campaignId: id }, ctx(s));

    expect(out).toEqual({ campaignId: id, status: 'active' });
  });

  it('pause and resume are idempotent — setting the same status twice is not an error', async () => {
    const s = store();
    const { id } = await s.create({ orgId: 'org_1', genomeId: 'gen_1', name: 'Sept', objective: 'bookings', windowDays: 30, startAt: new Date(), plan: {} });

    await campaignPause.handler({ campaignId: id }, ctx(s));
    await expect(campaignPause.handler({ campaignId: id }, ctx(s))).resolves.toEqual({ campaignId: id, status: 'paused' });
    expect(campaignPause.idempotent).toBe(true);
    expect(campaignResume.idempotent).toBe(true);
  });

  it('propagates NOT_FOUND for an unknown campaign', async () => {
    const s = store();
    await expect(campaignPause.handler({ campaignId: 'cmp_missing' }, ctx(s))).rejects.toThrow(ToolError);
  });
});

describe('campaign.duplicate', () => {
  it('copies objective, window, target, and the plan snapshot as-is', async () => {
    const s = store();
    const plan = { pillars: { offer: 4, proof: 4 } };
    const { id: sourceId } = await s.create({
      orgId: 'org_1', genomeId: 'gen_1', name: 'August', objective: 'bookings', windowDays: 30,
      startAt: new Date('2026-08-01'), plan, targetCount: 40, targetLabel: 'bookings',
    });

    const out = await campaignDuplicate.handler({ genomeId: 'gen_1', campaignId: sourceId }, ctx(s));

    expect(out.name).toBe('August (copy)');
    expect(out.objective).toBe('bookings');
    expect(out.windowDays).toBe(30);
    expect(out.campaignId).not.toBe(sourceId);

    const duplicated = await s.get(out.campaignId, 'org_1');
    expect(duplicated?.plan).toEqual(plan); // same reference/snapshot, not recomputed
    expect(duplicated?.targetCount).toBe(40);
  });

  it('accepts an explicit name and startAt override', async () => {
    const s = store();
    const { id: sourceId } = await s.create({ orgId: 'org_1', genomeId: 'gen_1', name: 'August', objective: 'bookings', windowDays: 30, startAt: new Date(), plan: {} });

    const out = await campaignDuplicate.handler(
      { genomeId: 'gen_1', campaignId: sourceId, name: 'September rerun', startAt: '2026-09-01T00:00:00.000Z' },
      ctx(s),
    );

    expect(out.name).toBe('September rerun');
    expect(out.startAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('does not copy slots — a fresh calendar.generate is required on the new campaign', async () => {
    const s = store();
    const { id: sourceId } = await s.create({ orgId: 'org_1', genomeId: 'gen_1', name: 'August', objective: 'bookings', windowDays: 30, startAt: new Date(), plan: {} });

    const out = await campaignDuplicate.handler({ genomeId: 'gen_1', campaignId: sourceId }, ctx(s));

    expect(await s.slots(out.campaignId, 'org_1', 'gen_1')).toEqual([]);
  });

  it('refuses a campaign belonging to a different genome', async () => {
    const s = store();
    const { id: sourceId } = await s.create({ orgId: 'org_1', genomeId: 'gen_other', name: 'August', objective: 'bookings', windowDays: 30, startAt: new Date(), plan: {} });

    await expect(
      campaignDuplicate.handler({ genomeId: 'gen_1', campaignId: sourceId }, ctx(s)),
    ).rejects.toThrow(ToolError);
  });

  it('throws NOT_FOUND for an unknown campaign', async () => {
    const s = store();
    await expect(
      campaignDuplicate.handler({ genomeId: 'gen_1', campaignId: 'cmp_missing' }, ctx(s)),
    ).rejects.toThrow(ToolError);
  });
});
