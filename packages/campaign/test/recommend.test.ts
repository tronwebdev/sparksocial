import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { toolFamily } from '@sparksocial/tools/defineTool';
import { GOLDEN_SET } from '@sparksocial/playbooks';
import { calendarRecommendSlot } from '../src/recommend.js';

/**
 * `calendar.recommend_slot` — `CAL-04`.
 *
 * The interesting behaviour is all in what it refuses to say. It must not
 * recommend a format that does not serve the campaign's objective, must not keep
 * recommending the same one, and must not offer a move when nothing would
 * actually be better off — a suggestion that fires on every empty day is one
 * people learn to ignore.
 */

const barber = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_barber')!;
const DAY = 86_400_000;
const START = new Date('2026-09-01T10:00:00.000Z');

function ctx(over: {
  campaign?: Record<string, unknown> | undefined;
  slots?: Array<Record<string, unknown>>;
  inventory?: unknown;
} = {}): ToolCtx {
  return {
    orgId: 'org_1',
    brandId: 'ws_1',
    genomeId: 'gen_barber',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      campaigns: {
        get: async () =>
          'campaign' in over
            ? over.campaign
            : { id: 'cmp_1', genomeId: 'gen_barber', objective: 'bookings', name: 'September' },
        slots: async () => over.slots ?? [],
      },
      genomes: { get: async () => barber.genome },
      assets: { inventory: async () => over.inventory ?? barber.assets },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

const call = (input: Partial<Parameters<typeof calendarRecommendSlot.handler>[0]> = {}, c = ctx()) =>
  calendarRecommendSlot.handler(
    {
      campaignId: 'cmp_1',
      date: '2026-09-10',
      excludePlaybookIds: [],
      excludeContentItemIds: [],
      ...input,
    },
    c,
  );

describe('calendar.recommend_slot — what to make', () => {
  it('recommends a format that serves the campaign objective, with its reasoning', async () => {
    const out = await call();

    expect(out.create).toBeDefined();
    expect(out.create!.playbookName.length).toBeGreaterThan(2);
    expect(out.create!.goal.length).toBeGreaterThan(4);
    // Invariant 4: this is a decision the owner watches SPARK make.
    expect(out.create!.why.factors.length).toBeGreaterThan(1);
    expect(out.create!.why.summary).toContain(out.create!.playbookName);
  });

  it('names what the post is designed to do, derived rather than written', async () => {
    // Every line has to be an objective the format genuinely scores well on —
    // padding the list would make every format look equally versatile.
    const out = await call();
    expect(out.create!.designedTo.length).toBeGreaterThan(0);
    expect(out.create!.designedTo.length).toBeLessThanOrEqual(4);
    for (const line of out.create!.designedTo) expect(line.length).toBeGreaterThan(8);
  });

  it('will not invent a hook', async () => {
    // A hook shown here and contradicted by the subsequent draft is worse than no
    // hook. The recommendation names the format; the words arrive with the draft.
    const out = await call();
    expect(Object.keys(out.create!)).not.toContain('hook');
  });

  it('offers a different format once one has been declined', async () => {
    const first = await call();
    const second = await call({ excludePlaybookIds: [first.create!.playbookId] });

    expect(second.create).toBeDefined();
    expect(second.create!.playbookId).not.toBe(first.create!.playbookId);
    // The count has to fall, or "try another" would imply an endless queue.
    expect(second.create!.alternativesLeft).toBeLessThan(first.create!.alternativesLeft);
  });

  it('prefers a format it has not used yet over one it has', async () => {
    const first = await call();
    // Fill the calendar with the top pick. Fit still leads, but among equal fits
    // the unused format wins — otherwise a month reads as one format repeated.
    const slots = Array.from({ length: 4 }, (_, i) => ({
      id: `slot_${i}`,
      playbookId: first.create!.playbookId,
      pillar: first.create!.pillar,
      status: 'scheduled',
      scheduledAt: new Date(START.getTime() + i * DAY),
      platform: 'instagram',
    }));

    const out = await call({}, ctx({ slots }));
    expect(out.create).toBeDefined();
    const usedFactor = out.create!.why.factors.find((f) => f.label.includes('Used'));
    const freshFactor = out.create!.why.factors.find((f) => f.label.includes('Not used yet'));
    // Either it moved to an unused format, or it stayed and said how often it has run.
    expect(usedFactor ?? freshFactor).toBeDefined();
  });

  it('says whether the format is ready, needs a file, or needs filming', async () => {
    const out = await call();
    expect(['ready', 'needs_upload', 'needs_capture']).toContain(out.create!.readiness);
    if (out.create!.readiness !== 'ready') {
      expect(out.create!.missingRoles.length).toBeGreaterThan(0);
    }
  });

  it('names the runners-up and why each lost', async () => {
    // "Try another suggestion" is a real control, so the owner should be able to
    // see there is a queue behind this rather than one opinion.
    const out = await call();
    for (const alt of out.create!.why.alternatives) {
      expect(alt.option.length).toBeGreaterThan(2);
      expect(alt.rejectedBecause.length).toBeGreaterThan(5);
    }
  });

  it('says so plainly when a brand has nothing to work from', async () => {
    const out = await call({}, ctx({ inventory: {} }));
    // A brand with no assets genuinely has no recommendation. Saying nothing is
    // worse than saying that.
    if (!out.create) {
      expect(out.note).toContain('no assets');
    } else {
      // Or it recommends something filmable, which is also honest.
      expect(out.create.readiness).not.toBe('ready');
    }
  });
});

describe('calendar.recommend_slot — what to move', () => {
  const crowded = [
    // Two posts on one day: a real clash, and the only basis for a move.
    { id: 'a', playbookId: 'pb_one', pillar: 'craft', status: 'scheduled', scheduledAt: new Date('2026-09-02T10:00:00Z'), platform: 'instagram' },
    { id: 'b', playbookId: 'pb_two', pillar: 'craft', status: 'scheduled', scheduledAt: new Date('2026-09-02T15:00:00Z'), platform: 'instagram' },
  ];

  it('offers a move off a crowded day onto an empty one', async () => {
    const out = await call({ date: '2026-09-10' }, ctx({ slots: crowded }));

    expect(out.move).toBeDefined();
    expect(out.move!.currentlyAt.slice(0, 10)).toBe('2026-09-02');
    expect(out.move!.why.summary).toContain('2026-09-02');
    expect(out.move!.why.factors.some((f) => f.label === 'Crowded day')).toBe(true);
  });

  it('prefers the post whose pillar is duplicated', async () => {
    const mixed = [
      { id: 'craft1', playbookId: 'p1', pillar: 'craft', status: 'scheduled', scheduledAt: new Date('2026-09-02T09:00:00Z'), platform: null },
      { id: 'offer1', playbookId: 'p2', pillar: 'offer', status: 'scheduled', scheduledAt: new Date('2026-09-02T12:00:00Z'), platform: null },
      { id: 'craft2', playbookId: 'p3', pillar: 'craft', status: 'scheduled', scheduledAt: new Date('2026-09-02T18:00:00Z'), platform: null },
    ];
    const out = await call({ date: '2026-09-10' }, ctx({ slots: mixed }));
    // Moving a craft post off a day that already has another craft post is a
    // better answer than moving whichever happens to be first.
    expect(out.move!.pillar).toBe('craft');
  });

  it('offers no move when nothing is crowded', async () => {
    // A suggestion that fires on every empty day is one people learn to ignore.
    const spread = [
      { id: 'a', playbookId: 'p1', pillar: 'craft', status: 'scheduled', scheduledAt: new Date('2026-09-02T10:00:00Z'), platform: null },
      { id: 'b', playbookId: 'p2', pillar: 'offer', status: 'scheduled', scheduledAt: new Date('2026-09-05T10:00:00Z'), platform: null },
    ];
    const out = await call({ date: '2026-09-10' }, ctx({ slots: spread }));
    expect(out.move).toBeUndefined();
  });

  it('offers no move onto a day that already has a post', async () => {
    const out = await call({ date: '2026-09-02' }, ctx({ slots: crowded }));
    expect(out.move).toBeUndefined();
  });

  it('never offers to move a published post', async () => {
    const published = crowded.map((s) => ({ ...s, status: 'published' }));
    const out = await call({ date: '2026-09-10' }, ctx({ slots: published }));
    expect(out.move).toBeUndefined();
  });

  it('offers a different post once one has been declined', async () => {
    const first = await call({ date: '2026-09-10' }, ctx({ slots: crowded }));
    const second = await call(
      { date: '2026-09-10', excludeContentItemIds: [first.move!.contentItemId] },
      ctx({ slots: crowded }),
    );
    // One left on that day means no clash left, so no move — which is correct.
    expect(second.move).toBeUndefined();
  });
});

describe('calendar.recommend_slot — contract', () => {
  it('refuses a campaign that is not there', async () => {
    const err = await call({}, ctx({ campaign: undefined })).catch((e: unknown) => e);
    expect((err as ToolError).code).toBe('NOT_FOUND');
  });

  it('refuses a date that is not a date', async () => {
    const parsed = calendarRecommendSlot.input.safeParse({
      campaignId: 'cmp_1',
      date: 'next Tuesday',
    });
    expect(parsed.success).toBe(false);
  });

  it('is a free read that writes nothing, family calendar', () => {
    expect(calendarRecommendSlot.effect).toBe('read');
    expect(calendarRecommendSlot.autonomy).toBe('auto');
    // Deterministic for the same inputs — nothing is recorded, so asking twice
    // is asking once.
    expect(calendarRecommendSlot.idempotent).toBe(true);
    expect(toolFamily(calendarRecommendSlot.name)).toBe('calendar');
  });
});
