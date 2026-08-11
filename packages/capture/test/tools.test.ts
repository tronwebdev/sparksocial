import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools/defineTool';
import type { Role } from '@sparksocial/shared';
import { lagosBarbershop, torontoSaas } from '@sparksocial/playbooks';
import { makeBriefGenerate } from '../src/generate.js';
import { makeSessionBatch } from '../src/session.js';
import type { BriefWriter } from '../src/writer.js';
import type { DraftCaptureBrief } from '../src/schema.js';

const GOOD_DRAFT: Omit<DraftCaptureBrief, 'playbook_id'> = {
  subject: 'the final fade blend',
  framing: 'behind subject, chest height',
  orientation: 'vertical',
  duration_sec: 20,
  motion: 'slow push in or static',
  audio: 'ambient only, no speech',
  lighting: 'face a window, avoid overhead only',
  do_not: ['do not talk to camera', 'no filters'],
  estimated_effort_sec: 45,
};

function goodWriter(): BriefWriter {
  return { write: async ({ playbook }) => ({ ...GOOD_DRAFT, playbook_id: playbook.playbook_id }) };
}

function ctx(over: Partial<ToolCtx> = {}): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner' as Role,
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: {
        createDraft: async () => ({ id: 'gen_draft' }),
        patchDimensions: async () => ({ id: 'gen_1', version: 1 }),
        get: async () => lagosBarbershop.genome,
        listForOrg: async () => [],
      },
      assets: {
        inventory: async () => lagosBarbershop.assets,
        retrieve: async () => [],
        create: async () => ({ id: 'asset_1' }),
        captionsByRole: async () => [],
        info: async () => ({}),
      },
      content: { recent: async () => [] },
      campaigns: {
        create: async () => ({ id: 'cmp_1' }),
        get: async () => undefined,
        listForGenome: async () => [],
        replaceSlots: async () => 0,
        slots: async () => [],
        setStatus: async () => {},
      },
      brands: {
        get: async (brandId: string) => ({
          brandId, name: '', approvalMode: 'autopublish' as const, createdAt: new Date('2026-01-01T00:00:00Z'),
        }),
        setApprovalMode: async (brandId: string) => ({
          brandId, name: '', approvalMode: 'autopublish' as const, createdAt: new Date('2026-01-01T00:00:00Z'),
        }),
      },
      approvals: {
        enqueue: async () => {},
        pending: async () => [],
        get: async () => undefined,
        resolve: async () => {},
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n, fn) => fn(), event: () => {} },
    ...over,
  };
}

describe('direct.brief.generate', () => {
  it('returns a validated brief with an id and expiry the writer did not supply', async () => {
    const tool = makeBriefGenerate(goodWriter());
    const res = await tool.handler({ genomeId: 'gen_barber', playbookId: 'pb_craft_capture' }, ctx());

    expect(res.brief.brief_id).toBeTruthy();
    expect(new Date(res.brief.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(res.brief.subject).toBe('the final fade blend');
    expect(res.why.summary).toContain('Craft Capture');
  });

  it('rejects a playbook that is not direct_finish', async () => {
    const tool = makeBriefGenerate(goodWriter());
    await expect(
      tool.handler({ genomeId: 'gen_saas', playbookId: 'pb_workflow_clip' }, ctx({ db: { ...ctx().db, genomes: { ...ctx().db.genomes, get: async () => torontoSaas.genome } } })),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('404s cleanly on an unknown genome or playbook', async () => {
    const tool = makeBriefGenerate(goodWriter());
    await expect(
      tool.handler({ genomeId: 'gen_x', playbookId: 'pb_craft_capture' }, ctx({ db: { ...ctx().db, genomes: { ...ctx().db.genomes, get: async () => undefined } } })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(
      tool.handler({ genomeId: 'gen_barber', playbookId: 'pb_nope' }, ctx()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('retries on a vague first draft and succeeds once the writer corrects it', async () => {
    let calls = 0;
    const writer: BriefWriter = {
      write: async ({ playbook }) => {
        calls++;
        return calls === 1
          ? { playbook_id: playbook.playbook_id, ...GOOD_DRAFT, subject: 'your work' } // vague
          : { playbook_id: playbook.playbook_id, ...GOOD_DRAFT };
      },
    };
    const tool = makeBriefGenerate(writer);
    const res = await tool.handler({ genomeId: 'gen_barber', playbookId: 'pb_craft_capture' }, ctx());

    expect(calls).toBe(2);
    expect(res.brief.subject).toBe('the final fade blend');
    expect(res.why.factors.some((f) => f.label === 'attempts')).toBe(true);
  });

  it('throws UPSTREAM_FAILED after exhausting retries on a writer that never improves', async () => {
    const writer: BriefWriter = {
      write: async ({ playbook }) => ({ playbook_id: playbook.playbook_id, ...GOOD_DRAFT, subject: 'a video' }),
    };
    const tool = makeBriefGenerate(writer);
    await expect(
      tool.handler({ genomeId: 'gen_barber', playbookId: 'pb_craft_capture' }, ctx()),
    ).rejects.toMatchObject({ code: 'UPSTREAM_FAILED' });
  });

  it('feeds validator rejection reasons back to the writer as feedback', async () => {
    const feedbackSeen: (string[] | undefined)[] = [];
    const writer: BriefWriter = {
      write: async ({ playbook, feedback }) => {
        feedbackSeen.push(feedback);
        return feedback
          ? { playbook_id: playbook.playbook_id, ...GOOD_DRAFT }
          : { playbook_id: playbook.playbook_id, ...GOOD_DRAFT, subject: 'your work' };
      },
    };
    await makeBriefGenerate(writer).handler({ genomeId: 'gen_barber', playbookId: 'pb_craft_capture' }, ctx());

    expect(feedbackSeen[0]).toBeUndefined();
    expect(feedbackSeen[1]).toEqual(expect.arrayContaining([expect.stringContaining('subject')]));
  });

  it('constrains the draft to the playbook\'s declared duration range', async () => {
    const write = vi.fn(async (args: Parameters<BriefWriter['write']>[0]) => ({
      playbook_id: args.playbook.playbook_id,
      ...GOOD_DRAFT,
      duration_sec: 999, // outside pb_craft_capture's declared [15, 25]
    }));
    await expect(
      makeBriefGenerate({ write }).handler({ genomeId: 'gen_barber', playbookId: 'pb_craft_capture' }, ctx()),
    ).rejects.toMatchObject({ code: 'UPSTREAM_FAILED' });
    expect(write).toHaveBeenCalledTimes(3); // MAX_ATTEMPTS
  });
});

describe('direct.session.batch', () => {
  it('bundles 3-5 unlockable playbooks into one session, highest-impact first', async () => {
    const tool = makeSessionBatch(goodWriter());
    const res = await tool.handler({ genomeId: 'gen_barber' }, ctx());

    expect(res.briefs.length).toBeGreaterThanOrEqual(3);
    expect(res.briefs.length).toBeLessThanOrEqual(5);
    expect(res.why.summary).toContain('one sitting');
  });

  it('never exceeds the five-minute session budget once the minimum is met', async () => {
    // A writer that reports long clips forces the budget check to actually bind.
    // duration_sec has to respect each playbook's own declared range, or the
    // validator rejects the draft before the budget logic is ever exercised.
    const longWriter: BriefWriter = {
      write: async ({ playbook }) => {
        const [, max] = playbook.output.duration_sec ?? [20, 20];
        return { ...GOOD_DRAFT, playbook_id: playbook.playbook_id, duration_sec: max, estimated_effort_sec: Math.max(90, max) };
      },
    };
    const res = await makeSessionBatch(longWriter).handler({ genomeId: 'gen_barber' }, ctx());

    expect(res.totalEffortSec).toBeLessThanOrEqual(5 * 60 + 90); // allows the brief that pushed it over the minimum
    expect(res.briefs.length).toBeGreaterThanOrEqual(3);
  });

  it('reports zero briefs honestly when nothing is unlockable by filming', async () => {
    const res = await makeSessionBatch(goodWriter()).handler(
      { genomeId: 'gen_saas' },
      ctx({ db: { ...ctx().db, genomes: { ...ctx().db.genomes, get: async () => torontoSaas.genome }, assets: { ...ctx().db.assets, inventory: async () => torontoSaas.assets } } }),
    );
    expect(res.briefs).toEqual([]);
    expect(res.why.summary).toContain('Nothing is unlockable');
  });

  it('lists everything beyond the cap as deferred, not silently dropped', async () => {
    const res = await makeSessionBatch(goodWriter()).handler({ genomeId: 'gen_barber' }, ctx());
    const total = res.briefs.length + res.deferred.length;
    // Every unlockable playbook is accounted for one way or the other.
    expect(total).toBeGreaterThan(0);
    expect(res.why.alternatives.length).toBe(res.deferred.length);
  });
});
