import { describe, expect, it } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools/defineTool';
import type { Role } from '@sparksocial/shared';
import { lagosBarbershop, manilaFreelancer } from '@sparksocial/playbooks';
import { makeEvaluateDraft } from '../src/tool.js';
import { makeRunGuardrails } from '../src/runGuardrails.js';

/**
 * `guard.evaluate_draft` end to end, and the `runGuardrails` adapter that a
 * future guardrail-declaring tool would go through inside `invokeTool`. Both
 * call the same `gatherAndEvaluate` core — these tests exist to prove the
 * *wiring* is correct, not to re-test each pure check (that's covered per-file).
 */

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
        inventory: async () => ({}),
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
        variantGroup: async () => [],
        tagVariant: async () => undefined,
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
        thread: async () => [],
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
      influencers: {
        add: async () => { throw new Error('influencers.add not stubbed in this test'); },
        remove: async () => {},
        list: async () => [],
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
      // `pb_craft_capture` never requires_likeness_license, so `rights` never
      // reads this — false is a safe default rather than a meaningful stub.
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

const embed = { embed: async (text: string) => [text.length, 0, 0] };

describe('guard.evaluate_draft', () => {
  it('does not declare guardrails on itself', () => {
    // If it did, invokeTool would abort on the first block before this
    // handler ever ran, and the caller would lose every other check's result.
    const tool = makeEvaluateDraft(embed);
    expect(tool.guardrails).toBeUndefined();
  });

  it('reports overall pass when every check clears', async () => {
    const tool = makeEvaluateDraft(embed);
    const res = await tool.handler(
      {
        genomeId: lagosBarbershop.genome.genome_id,
        playbookId: 'pb_craft_capture',
        platform: 'instagram',
        text: 'The fade finishing, up close.',
        referencedAssetIds: [],
      },
      ctx(),
    );
    expect(res.overall).toBe('pass');
    expect(res.why.summary).toContain('clear');
  });

  it('grounds a claim from knowledge_chunks, not just asset captions — the gap knowledge.ingest_* closes', async () => {
    // Before this fix, claim_grounding's corpus was built from
    // `assets.captionsByRole` alone; nothing written via
    // `brand.knowledge.attach`/`knowledge.ingest_site`/`.ingest_docs` was
    // ever actually consulted. This proves a claim grounded *only* by a
    // knowledge chunk now clears — captionsByRole stays empty on purpose.
    const tool = makeEvaluateDraft(embed);
    const res = await tool.handler(
      {
        genomeId: lagosBarbershop.genome.genome_id,
        playbookId: 'pb_craft_capture',
        platform: 'instagram',
        text: 'Fades finished in 20 minutes flat.',
        referencedAssetIds: [],
      },
      ctx({
        db: {
          ...ctx().db,
          assets: { ...ctx().db.assets, captionsByRole: async () => [] },
          knowledge: {
            ...ctx().db.knowledge,
            listAll: async () => [{ id: 'kc_1', genomeId: lagosBarbershop.genome.genome_id, docId: 'faq', text: 'Every fade is finished in 20 minutes flat.', createdAt: new Date() }],
          },
        },
      }),
    );
    expect(res.checks.claim_grounding?.verdict).toBe('pass');
  });

  it('reports overall block when any check blocks, and lists it in why.factors', async () => {
    const tool = makeEvaluateDraft(embed);
    const res = await tool.handler(
      {
        genomeId: lagosBarbershop.genome.genome_id,
        playbookId: 'pb_craft_capture',
        platform: 'x',
        text: 'x'.repeat(300), // over X's 280-char limit
        referencedAssetIds: [],
      },
      ctx(),
    );
    expect(res.overall).toBe('block');
    expect(res.checks.platform_policy?.verdict).toBe('block');
    expect(res.why.factors.some((f) => f.label === 'platform_policy')).toBe(true);
  });

  it('reports overall flag (not block) when the worst check is a flag', async () => {
    const tool = makeEvaluateDraft(embed);
    const res = await tool.handler(
      {
        genomeId: manilaFreelancer.genome.genome_id,
        playbookId: 'pb_portfolio_in_motion',
        platform: 'instagram',
        text: 'This redesign is a total game-changer for the client.',
        referencedAssetIds: [],
      },
      ctx({
        db: {
          ...ctx().db,
          genomes: {
            ...ctx().db.genomes,
            get: async () => ({
              ...manilaFreelancer.genome,
              voice: { ...manilaFreelancer.genome.voice, banned_phrases: ['game-changer'] },
            }),
          },
        },
      }),
    );
    expect(res.overall).toBe('flag');
    expect(res.checks.brand_voice?.verdict).toBe('flag');
  });

  it('blocks with missing_context when the genome cannot be found', async () => {
    const tool = makeEvaluateDraft(embed);
    const res = await tool.handler(
      { genomeId: 'nope', playbookId: 'pb_craft_capture', platform: 'x', text: 'short', referencedAssetIds: [] },
      ctx({ db: { ...ctx().db, genomes: { ...ctx().db.genomes, get: async () => undefined } } }),
    );
    expect(res.overall).toBe('block');
  });

  describe('rights — wired to consent, not to the genome constraint', () => {
    // `pb_avatar_pov` is one of the three playbooks with
    // `requires_likeness_license: true`, so it is the one that actually
    // exercises `gather.ts`'s `ctx.db.consent.hasActive` call.
    const draft = {
      genomeId: lagosBarbershop.genome.genome_id,
      playbookId: 'pb_avatar_pov',
      platform: 'instagram',
      text: 'A short clip.',
      referencedAssetIds: [],
    };

    it('blocks when no consent record is active, even though the base ctx() stub says false', async () => {
      const tool = makeEvaluateDraft(embed);
      const res = await tool.handler(draft, ctx());
      expect(res.overall).toBe('block');
      expect(res.checks.rights?.verdict).toBe('block');
    });

    it('passes rights once ctx.db.consent.hasActive reports an active grant', async () => {
      const tool = makeEvaluateDraft(embed);
      const res = await tool.handler(
        draft,
        ctx({ db: { ...ctx().db, consent: { ...ctx().db.consent, hasActive: async () => true } } }),
      );
      expect(res.checks.rights?.verdict).toBe('pass');
    });
  });
});

describe('makeRunGuardrails (the invokeTool adapter)', () => {
  it('returns one GuardrailVerdict per requested guard, in invoke.ts shape', async () => {
    const runGuardrails = makeRunGuardrails(embed);
    const verdicts = await runGuardrails(
      ['brand_voice', 'platform_policy'],
      {
        genomeId: lagosBarbershop.genome.genome_id,
        playbookId: 'pb_craft_capture',
        platform: 'instagram',
        text: 'A clean, short post.',
        referencedAssetIds: [],
      },
      ctx(),
    );
    expect(verdicts).toHaveLength(2);
    expect(verdicts.map((v) => v.guard).sort()).toEqual(['brand_voice', 'platform_policy']);
    expect(verdicts.every((v) => v.verdict === 'pass')).toBe(true);
  });

  it('blocks loudly on a wiring error rather than silently skipping enforcement', async () => {
    const runGuardrails = makeRunGuardrails(embed);
    const verdicts = await runGuardrails(['brand_voice'], { not: 'a draft' }, ctx());
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]!.verdict).toBe('block');
    expect(verdicts[0]!.rule).toBe('wiring_error');
  });
});
