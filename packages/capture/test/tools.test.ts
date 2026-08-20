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
        patchConstraints: async () => ({ id: 'gen_1', version: 1 }),
        patchIdentity: async () => ({ id: 'gen_1', version: 1 }),
        patchOffer: async () => ({ id: 'gen_1', version: 1 }),
        patchLearned: async () => ({ id: 'gen_1', version: 1 }),
        get: async () => lagosBarbershop.genome,
        listForOrg: async () => [],
      },
      assets: {
        inventory: async () => lagosBarbershop.assets,
        retrieve: async () => [],
        create: async () => ({ id: 'asset_1' }),
        captionsByRole: async () => [],
        info: async () => ({}),
        setRights: async () => undefined,
        recordUsage: async () => undefined,
        moveToFolder: async () => undefined,
      },
      assetFolders: {
        create: async () => { throw new Error('assetFolders.create not stubbed in this test'); },
        list: async () => [],
      },
      content: {
        recent: async () => [],
        createDraft: async () => { throw new Error('content.createDraft not stubbed in this test'); },
        get: async () => undefined,
        updateDraft: async () => undefined,
        list: async () => [],
        schedule: async () => undefined,
        markPublished: async () => {},
        markRolledBack: async () => {},
        markBlocked: async () => {},
        recordPublishFailure: async () => ({ attempts: 1 }),
        publishOrigin: async () => undefined,
        pendingReviewCount: async () => 0,
        markNeedsReview: async () => {},
        markApproved: async () => {},
        markRejected: async () => {},
        recordRender: async () => ({ id: 'render_test', contentItemId: 'c1', aspect: '9:16', storageUrl: 'https://example.com/r.mp4', engine: 'remotion', costCents: 0, createdAt: new Date() }),
        listRenders: async () => [],
      },
      analytics: {
        record: async () => { throw new Error('analytics.record not stubbed in this test'); },
        listForItems: async () => [],
      },
      ctaLinks: {
        create: async () => { throw new Error('ctaLinks.create not stubbed in this test'); },
        listForItems: async () => [],
      },
      engagement: {
        ingest: async () => { throw new Error('engagement.ingest not stubbed in this test'); },
        get: async () => undefined,
        classify: async () => undefined,
        list: async () => [],
        audit: async () => [],
        markReplied: async () => undefined,
        markAutoHandled: async () => undefined,
        markEscalated: async () => undefined,
      },
      opportunities: {
        create: async () => { throw new Error('opportunities.create not stubbed in this test'); },
        get: async () => undefined,
        route: async () => undefined,
      },
      trends: {
        add: async () => { throw new Error('trends.add not stubbed in this test'); },
        remove: async () => {},
        list: async () => [],
      },
      trendObservations: {
        record: async () => {},
        series: async () => [],
      },
      learning: {
        list: async () => [],
        recordOutcome: async () => { throw new Error('learning.recordOutcome not stubbed in this test'); },
        reset: async () => { throw new Error('learning.reset not stubbed in this test'); },
      },
      recipes: {
        create: async () => { throw new Error('recipes.create not stubbed in this test'); },
        get: async () => undefined,
        list: async () => [],
        setStatus: async () => undefined,
        delete: async () => {},
        markRan: async () => {},
        findDue: async () => [],
        recordRun: async () => { throw new Error('recipes.recordRun not stubbed in this test'); },
        listOutputs: async () => [],
        decideOutput: async () => undefined,
      },
      oauthConnections: {
        get: async () => undefined,
        save: async () => { throw new Error('oauthConnections.save not stubbed in this test'); },
        remove: async () => {},
        findExpiring: async () => [],
        markExpiryNotified: async () => {},
      },
      knowledge: {
        attach: async () => { throw new Error('knowledge.attach not stubbed in this test'); },
        listForDoc: async () => [],
        listAll: async () => [],
      },
      orgSettings: {
        get: async () => ({ orgId: 'org_1', plan: 'starter', defaultApprovalMode: 'review_first_week', ssoRequired: false, twoFactorRequired: false, dataResidency: 'any', monthlyCapCents: 50_000, updatedAt: new Date() }),
        setPlan: async () => { throw new Error('orgSettings.setPlan not stubbed in this test'); },
        setGovernance: async () => { throw new Error('orgSettings.setGovernance not stubbed in this test'); },
        setSso: async () => { throw new Error('orgSettings.setSso not stubbed in this test'); },
      },
      brandMembers: {
        set: async () => { throw new Error('brandMembers.set not stubbed in this test'); },
        remove: async () => {},
        listForBrand: async () => [],
        listForUser: async () => [],
      },
      reviewLinks: {
        create: async () => { throw new Error('reviewLinks.create not stubbed in this test'); },
        getByToken: async () => undefined,
        revoke: async () => {},
        listForBrand: async () => [],
      },
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
          brandId, name: '', approvalMode: 'autopublish' as const,
          createdAt: new Date('2026-01-01T00:00:00Z'), agentPaused: false, postsPerWeek: 3,
      strictMode: false,
      timezone: 'UTC',
      engagementAutonomy: 'off' as const,
        }),
        setApprovalMode: async (brandId: string) => ({
          brandId, name: '', approvalMode: 'autopublish' as const,
          createdAt: new Date('2026-01-01T00:00:00Z'), agentPaused: false, postsPerWeek: 3,
      strictMode: false,
      timezone: 'UTC',
      engagementAutonomy: 'off' as const,
        }),
        setAgentPaused: async ({ brandId }: { brandId: string }) => ({
          brandId, name: '', approvalMode: 'autopublish' as const,
          createdAt: new Date('2026-01-01T00:00:00Z'), agentPaused: false, postsPerWeek: 3,
      strictMode: false,
      timezone: 'UTC',
      engagementAutonomy: 'off' as const,
        }),
        setFrequency: async ({ brandId }: { brandId: string }) => ({
          brandId, name: '', approvalMode: 'autopublish' as const,
          createdAt: new Date('2026-01-01T00:00:00Z'), agentPaused: false, postsPerWeek: 3,
      strictMode: false,
      timezone: 'UTC',
      engagementAutonomy: 'off' as const,
        }),
        setPolicy: async ({ brandId }: { brandId: string }) => ({
          brandId, name: '', approvalMode: 'autopublish' as const,
          createdAt: new Date('2026-01-01T00:00:00Z'), agentPaused: false, postsPerWeek: 3,
      strictMode: false,
      timezone: 'UTC',
      engagementAutonomy: 'off' as const,
        }),
        setGovernance: async ({ brandId }: { brandId: string }) => ({
          brandId, name: '', approvalMode: 'autopublish' as const,
          createdAt: new Date('2026-01-01T00:00:00Z'), agentPaused: false, postsPerWeek: 3,
      strictMode: false,
      timezone: 'UTC',
      engagementAutonomy: 'off' as const,
        }),
      },
      // Unused by these tests; present because ScopedDb requires them, which is
      // the point of the interface being structural rather than partial.
      humanLoop: {
        create: async () => { throw new Error('humanLoop not stubbed in this test'); },
        get: async () => undefined,
        listPending: async () => [],
        answer: async () => undefined,
        markDelivered: async () => {},
      },
      consent: {
        grant: async () => { throw new Error('consent not stubbed in this test'); },
        revoke: async () => undefined,
        hasActive: async () => false,
        list: async () => [],
      },
      toolCalls: { get: async () => undefined, list: async () => [] },
      approvals: {
        enqueue: async () => {},
        pending: async () => [],
        get: async () => undefined,
        resolve: async () => {},
      },
      metrics: {
        successMetrics: async () => ({
          connectedAccounts: 0,
          campaignCount: 0,
          firstCampaignStartAt: null,
          firstPublishedAt: null,
          publishedInWindow: 0,
          postsWithTrackedLink: 0,
          postsFromTrends: 0,
          recipeCount: 0,
          outputsApproved: 0,
          outputsRejected: 0,
          messagesInWindow: 0,
          messagesResolved: 0,
          meanReplySeconds: null,
          opportunitiesInWindow: 0,
          opportunitiesRouted: 0,
          publishedEverBlocked: 0,
          rolledBack: 0,
          needsReview: 0,
        }),
        toolActivity: async () => ({
          publishAttempts: 0,
          publishBlocked: 0,
          publishHeld: 0,
          draftCalls: 0,
          trendsRanked: 0,
          repurposeCalls: 0,
        }),
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
