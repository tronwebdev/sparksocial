import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ToolError, type Role } from '@sparksocial/shared/types';
import { defineTool, type ToolCtx } from '../src/defineTool.js';
import { register, __resetRegistry } from '../src/registry.js';
import { invokeTool, type InvokeDeps, type InvokeRequest, type ToolCallRecord } from '../src/invoke.js';

/**
 * THE P1 EXIT TEST.
 *
 * Master plan §12, P1: *"the same action performed by clicking and by asking SPARK
 * produces identical `tool_calls` rows with identical guardrail evaluation."*
 *
 * That sentence is the whole definition of "agent-first" made falsifiable. If these
 * tests pass, there is one implementation of every capability and the UI cannot do
 * anything SPARK cannot. If someone later wires a screen straight to a service, the
 * first test in this file is what catches it.
 */

const NOW = new Date('2026-08-15T12:00:00Z');

/* ── Fixtures ──────────────────────────────────────────────────────── */

const Echo = defineTool({
  name: 'draft.copy.write',
  version: 3,
  summary: 'Write post copy from a brief.',
  input: z.object({ brief: z.string() }),
  output: z.object({
    copy: z.string(),
    why: z.object({
      summary: z.string(),
      factors: z.array(z.object({ label: z.string() })),
      evidence: z.array(z.object({ kind: z.enum(['rule']), id: z.string() })).default([]),
      alternatives: z.array(z.object({ option: z.string(), rejectedBecause: z.string() })).default([]),
    }),
  }),
  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,
  async handler(input) {
    return {
      copy: `>> ${input.brief}`,
      why: {
        summary: 'Wrote copy from the brief.',
        factors: [{ label: 'brief' }],
        evidence: [{ kind: 'rule' as const, id: 'r1' }],
        alternatives: [],
      },
    };
  },
});

function ctx(over: Partial<ToolCtx> = {}): ToolCtx {
  return {
    orgId: 'org_1',
    brandId: 'brand_1',
    genomeId: 'gen_1',
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
        get: async () => undefined,
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

const brand: InvokeRequest['brand'] = {
  createdAt: new Date('2026-07-01T00:00:00Z'),
  approvalMode: 'autopublish',
};

function harness(over: Partial<InvokeDeps> = {}) {
  const rows: ToolCallRecord[] = [];
  let seq = 0;
  const deps: InvokeDeps = {
    writeToolCall: async (r) => void rows.push(r),
    newId: () => `call_${++seq}`,
    now: () => NOW,
    ...over,
  };
  return { rows, deps };
}

function request(over: Partial<InvokeRequest> = {}): InvokeRequest {
  return {
    tool: 'draft.copy.write',
    input: { brief: 'a barbershop fade' },
    caller: 'user',
    ctx: ctx(),
    brand,
    ...over,
  };
}

beforeEach(() => {
  __resetRegistry();
  register(Echo);
});

/* ── The acceptance test ───────────────────────────────────────────── */

describe('P1 exit criterion — one capability, two callers, identical rows', () => {
  it('a UI click and a SPARK request write rows that differ ONLY in caller, id and userId', async () => {
    const h = harness();

    // The human clicks a button.
    const clicked = await invokeTool(
      request({ caller: 'user', ctx: ctx({ userId: 'user_1' }) }),
      h.deps,
    );

    // SPARK is asked for the same thing, mid-run, on a schedule (no userId).
    const asked = await invokeTool(
      request({ caller: 'agent', ctx: ctx({ runId: 'run_1' }) }),
      h.deps,
    );

    expect(clicked.status).toBe('succeeded');
    expect(asked.status).toBe('succeeded');
    expect(h.rows).toHaveLength(2);

    const [byUi, byAgent] = h.rows as [ToolCallRecord, ToolCallRecord];

    // Strip the fields that are *supposed* to differ; everything else must match.
    const { id: _a, caller: ca, userId: _c, runId: _d, ...uiRest } = byUi;
    const { id: _e, caller: cb, userId: _g, runId: _h, ...agentRest } = byAgent;

    expect(uiRest).toEqual(agentRest);
    expect(ca).toBe('user');
    expect(cb).toBe('agent');
  });

  it('both callers get the identical policy decision for the identical situation', async () => {
    const h = harness();
    const gatedBrand: InvokeRequest['brand'] = { ...brand, approvalMode: 'review_everything' };

    // `publish` effect so approval mode actually bites for both.
    __resetRegistry();
    register({ ...Echo, name: 'publish.now', effect: 'publish' });

    await invokeTool(request({ tool: 'publish.now', caller: 'user', brand: gatedBrand }), h.deps);
    await invokeTool(request({ tool: 'publish.now', caller: 'agent', brand: gatedBrand }), h.deps);

    const [ui, agent] = h.rows as [ToolCallRecord, ToolCallRecord];
    expect(ui.decision).toBe('approval');
    expect(agent.decision).toBe('approval');
    expect(ui.ruleId).toBe(agent.ruleId);
    expect(ui.ruleId).toBe('approval_mode.review_everything');
  });

  it('records the tool version, so a row stays interpretable after the schema moves', async () => {
    const h = harness();
    await invokeTool(request(), h.deps);
    expect(h.rows[0]!.version).toBe(3);
  });
});

/* ── The chain, step by step ───────────────────────────────────────── */

describe('input validation', () => {
  it('rejects malformed input before policy or the handler runs', async () => {
    const handler = vi.fn();
    __resetRegistry();
    register({ ...Echo, handler });
    const h = harness();

    const res = await invokeTool(request({ input: { brief: 42 } }), h.deps);

    expect(res.status).toBe('failed');
    expect(res.status === 'failed' && res.error.code).toBe('INVALID_INPUT');
    expect(handler).not.toHaveBeenCalled();
    // The failure is still audited — a rejected call is a fact about the system.
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]!.status).toBe('failed');
  });

  it('audits an unknown tool rather than throwing into the caller', async () => {
    const h = harness();
    const res = await invokeTool(request({ tool: 'nope.missing' }), h.deps);
    expect(res.status === 'failed' && res.error.code).toBe('NOT_FOUND');
    expect(h.rows).toHaveLength(1);
  });
});

describe('idempotency', () => {
  const NonIdempotent = { ...Echo, name: 'publish.now', effect: 'publish' as const, idempotent: false };

  it('refuses a non-idempotent tool called without a key', async () => {
    __resetRegistry();
    register(NonIdempotent);
    const h = harness();

    const res = await invokeTool(request({ tool: 'publish.now' }), h.deps);
    expect(res.status === 'failed' && res.error.code).toBe('INVALID_INPUT');
    expect(res.status === 'failed' && res.error.message).toContain('idempotency key');
  });

  it('replays the prior result instead of repeating the side effect', async () => {
    const handler = vi.fn(async () => ({
      copy: 'x',
      why: { summary: 's', factors: [], evidence: [], alternatives: [] },
    }));
    __resetRegistry();
    register({ ...NonIdempotent, handler });

    const prior: ToolCallRecord = {
      id: 'call_prior',
      tool: 'publish.now',
      version: 3,
      caller: 'user',
      orgId: 'org_1',
      role: 'owner',
      input: {},
      output: { copy: 'already published' },
      effect: 'publish',
      decision: 'allow',
      costCents: 0,
      status: 'succeeded',
      at: NOW,
    };
    const h = harness({ lookupIdempotent: async () => prior });

    const res = await invokeTool(request({ tool: 'publish.now', idempotencyKey: 'k1' }), h.deps);

    expect(res.status).toBe('succeeded');
    expect(res.status === 'succeeded' && res.output).toEqual({ copy: 'already published' });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('guardrails', () => {
  const Guarded = { ...Echo, guardrails: ['claim_grounding' as const, 'brand_voice' as const] };

  it('a block aborts before the handler and reports the fix action', async () => {
    const handler = vi.fn();
    __resetRegistry();
    register({ ...Guarded, handler });
    const h = harness({
      runGuardrails: async () => [
        {
          guard: 'claim_grounding' as const,
          verdict: 'block' as const,
          rule: 'Claim "3x faster" is not grounded in any knowledge asset.',
          fixAction: 'Ingest the docs page, or remove the specific number.',
        },
      ],
    });

    const res = await invokeTool(request(), h.deps);

    expect(res.status === 'failed' && res.error.code).toBe('GUARDRAIL_BLOCKED');
    expect(res.status === 'failed' && res.error.meta.fixAction).toContain('Ingest the docs');
    expect(handler).not.toHaveBeenCalled();
  });

  it('a flag escalates to approval rather than blocking (PRD §9)', async () => {
    __resetRegistry();
    register({ ...Guarded, name: 'publish.now', effect: 'publish' as const });
    const h = harness({
      runGuardrails: async () => [{ guard: 'brand_voice' as const, verdict: 'flag' as const, rule: 'banned phrase' }],
    });

    const res = await invokeTool(request({ tool: 'publish.now' }), h.deps);

    expect(res.status).toBe('gated');
    expect(res.status === 'gated' && res.decision.kind).toBe('approval');
    expect(res.status === 'gated' && res.decision.kind !== 'allow' && res.decision.ruleId).toBe('guardrail.flagged');
  });

  it('passes cleanly when every guard returns pass', async () => {
    __resetRegistry();
    register(Guarded);
    const h = harness({
      runGuardrails: async () => [{ guard: 'brand_voice' as const, verdict: 'pass' as const }],
    });
    const res = await invokeTool(request(), h.deps);
    expect(res.status).toBe('succeeded');
  });
});

describe('gating', () => {
  it('a denied call never runs the handler but is still audited', async () => {
    const handler = vi.fn();
    __resetRegistry();
    register({ ...Echo, handler });
    const h = harness();

    const res = await invokeTool(request({ ctx: ctx({ role: 'viewer' }) }), h.deps);

    expect(res.status).toBe('gated');
    expect(res.status === 'gated' && res.decision.kind).toBe('deny');
    expect(handler).not.toHaveBeenCalled();
    expect(h.rows[0]!.status).toBe('gated');
    expect(h.rows[0]!.ruleId).toBe('role.scope');
  });

  it('the audit row carries the rule id, so the Review queue can say why', async () => {
    const h = harness();
    __resetRegistry();
    register({ ...Echo, name: 'publish.now', effect: 'publish' });

    await invokeTool(
      request({ tool: 'publish.now', brand: { ...brand, approvalMode: 'review_everything' } }),
      h.deps,
    );

    expect(h.rows[0]).toMatchObject({
      status: 'gated',
      decision: 'approval',
      ruleId: 'approval_mode.review_everything',
    });
    expect(h.rows[0]!.reason).toContain('reviews all content');
  });
});

describe('execution, cost and explainability', () => {
  it('lifts the `why` from the output onto the audit row (CLAUDE.md invariant 4)', async () => {
    const h = harness();
    const res = await invokeTool(request(), h.deps);

    expect(res.status === 'succeeded' && res.why?.summary).toBe('Wrote copy from the brief.');
    expect(h.rows[0]!.why?.summary).toBe('Wrote copy from the brief.');
  });

  it('records cost only for tools that actually spend', async () => {
    const recordCost = vi.fn(async () => {});
    const h = harness({ recordCost });

    await invokeTool(request(), h.deps); // no estimateCents ⇒ free
    expect(recordCost).not.toHaveBeenCalled();

    __resetRegistry();
    register({ ...Echo, name: 'synthesize.image', effect: 'spend' as const, estimateCents: () => 42 });
    await invokeTool(request({ tool: 'synthesize.image' }), h.deps);

    expect(recordCost).toHaveBeenCalledOnce();
    expect(h.rows[1]!.costCents).toBe(42);
  });

  it('validates the handler output and fails loudly on a malformed result', async () => {
    __resetRegistry();
    register({ ...Echo, handler: async () => ({ copy: 123 }) as never });
    const h = harness();

    const res = await invokeTool(request(), h.deps);
    expect(res.status === 'failed' && res.error.code).toBe('UPSTREAM_FAILED');
    expect(res.status === 'failed' && res.error.message).toContain('malformed result');
  });

  it('preserves a ToolError thrown by the handler, including its code', async () => {
    __resetRegistry();
    register({
      ...Echo,
      handler: async () => {
        throw new ToolError('UPSTREAM_FAILED', 'HeyGen returned 503.');
      },
    });
    const h = harness();

    const res = await invokeTool(request(), h.deps);
    expect(res.status === 'failed' && res.error.code).toBe('UPSTREAM_FAILED');
    expect(h.rows[0]!.error?.message).toBe('HeyGen returned 503.');
  });

  it('emits fan-out events for every terminal outcome', async () => {
    const emit = vi.fn();
    const h = harness({ emit });

    await invokeTool(request(), h.deps);
    await invokeTool(request({ ctx: ctx({ role: 'viewer' }) }), h.deps);
    await invokeTool(request({ tool: 'nope.missing' }), h.deps);

    expect(emit.mock.calls.map((c) => c[0])).toEqual(['tool.succeeded', 'tool.deny', 'tool.failed']);
  });
});

/* ── policySubject: the tool derives the publish context, not the caller ──── */

describe('policySubject — brand platform/content-type restrictions actually fire', () => {
  /**
   * The bug this closes: `policy.ts` rule 7 read `subject.platform` and
   * `subject.contentType` from the *request*, and nothing in the product ever
   * set them. `approval.policy.set` persisted `restrictedPlatforms`, the settings
   * panel edited it, `loadBrandGovernance` loaded it — and it was compared
   * against a field that was always `undefined`. A workspace could switch on
   * "Instagram requires review", see it saved, and publish to Instagram
   * unreviewed forever.
   */
  const publisher = (subject: () => Promise<{ platform?: string; contentType?: string }>) => ({
    ...Echo,
    name: 'publish.now',
    effect: 'publish' as const,
    policySubject: subject,
  });

  it('routes a restricted platform to approval, from the tool own derivation', async () => {
    register(publisher(async () => ({ platform: 'instagram' })));
    const { deps } = harness();

    const out = await invokeTool(
      request({ tool: 'publish.now', brand: { ...brand, restrictedPlatforms: ['instagram'] } }),
      deps,
    );

    expect(out.status).toBe('gated');
    if (out.status === 'gated' && out.decision.kind !== 'allow') {
      expect(out.decision.ruleId).toBe('brand.restricted_platform');
    }
  });

  it('lets an unrestricted platform through', async () => {
    register(publisher(async () => ({ platform: 'tiktok' })));
    const { deps } = harness();
    const out = await invokeTool(
      request({ tool: 'publish.now', brand: { ...brand, restrictedPlatforms: ['instagram'] } }),
      deps,
    );
    expect(out.status).toBe('succeeded');
  });

  it('cannot be bypassed by a caller omitting the platform', async () => {
    // The whole point of moving this off the request. `subject` no longer
    // carries platform at all, so there is nothing for a caller to leave out.
    register(publisher(async () => ({ platform: 'instagram' })));
    const { deps } = harness();
    const out = await invokeTool(
      request({
        tool: 'publish.now',
        brand: { ...brand, restrictedPlatforms: ['instagram'] },
        subject: {},
      }),
      deps,
    );
    expect(out.status).toBe('gated');
  });

  it('routes a restricted content type to approval', async () => {
    register(publisher(async () => ({ platform: 'tiktok', contentType: 'carousel' })));
    const { deps } = harness();
    const out = await invokeTool(
      request({ tool: 'publish.now', brand: { ...brand, restrictedContentTypes: ['carousel'] } }),
      deps,
    );
    expect(out.status).toBe('gated');
    if (out.status === 'gated' && out.decision.kind !== 'allow') {
      expect(out.decision.ruleId).toBe('brand.restricted_content_type');
    }
  });

  it('fails the call when the derivation throws, rather than publishing unrestricted', async () => {
    // An unreadable content item is not a reason to skip the restrictions that
    // item was subject to.
    register(
      publisher(async () => {
        throw new Error('content item is gone');
      }),
    );
    const { deps } = harness();
    const out = await invokeTool(request({ tool: 'publish.now' }), deps);
    expect(out.status).toBe('failed');
  });

  it('still merges caller-supplied guardrail flags, which only ever escalate', async () => {
    // Containment flags describe the *turn*, not the post, so they stay on the
    // request — see `InvokeRequest.subject`.
    register(publisher(async () => ({ platform: 'tiktok' })));
    const { deps } = harness();
    const out = await invokeTool(
      request({ tool: 'publish.now', subject: { guardrailFlags: ['untrusted_context'] } }),
      deps,
    );
    expect(out.status).toBe('gated');
    if (out.status === 'gated' && out.decision.kind !== 'allow') {
      expect(out.decision.ruleId).toBe('guardrail.flagged');
    }
  });
});

/* ── Idempotency: the claim closes the concurrency window ─────────────────── */

describe('reserveIdempotent — two concurrent calls do not both take the side effect', () => {
  /**
   * `lookupIdempotent` only ever saw keys whose audit row was already written,
   * and the row is written *after* the handler returns. Two simultaneous
   * `publish.now` calls with one key therefore both missed the lookup and both
   * posted; the platform adapter own dedupe was the only thing between that and
   * a duplicate post on someone feed.
   */
  const NonIdempotentPublish = {
    ...Echo,
    name: 'publish.now',
    effect: 'publish' as const,
    idempotent: false,
    policySubject: async () => ({}),
  };

  function claimingHarness() {
    const claimed = new Set<string>();
    const { rows, deps } = harness({
      reserveIdempotent: async (key) => {
        if (claimed.has(key)) return 'in_flight';
        claimed.add(key);
        return 'reserved';
      },
      releaseIdempotent: async (key) => void claimed.delete(key),
    });
    return { rows, deps, claimed };
  }

  /** Echo's output shape, so an overridden handler still passes output validation. */
  const echoed = {
    copy: 'posted',
    why: { summary: 'ok', factors: [], evidence: [], alternatives: [] },
  };

  it('refuses the second caller with IN_FLIGHT instead of running the handler twice', async () => {
    let ran = 0;
    register({
      ...NonIdempotentPublish,
      handler: async () => {
        ran += 1;
        return echoed;
      },
    });
    const { deps } = claimingHarness();

    const first = await invokeTool(request({ tool: 'publish.now', idempotencyKey: 'k1' }), deps);
    const second = await invokeTool(request({ tool: 'publish.now', idempotencyKey: 'k1' }), deps);

    expect(first.status).toBe('succeeded');
    expect(second.status).toBe('failed');
    if (second.status === 'failed') expect(second.error.code).toBe('IN_FLIGHT');
    expect(ran).toBe(1);
  });

  it('gives the key back after a failure, so a genuine retry can proceed', async () => {
    let attempts = 0;
    register({
      ...NonIdempotentPublish,
      handler: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('transport down');
        return echoed;
      },
    });
    const { deps } = claimingHarness();

    const failed = await invokeTool(request({ tool: 'publish.now', idempotencyKey: 'k2' }), deps);
    expect(failed.status).toBe('failed');

    const retried = await invokeTool(request({ tool: 'publish.now', idempotencyKey: 'k2' }), deps);
    expect(retried.status).toBe('succeeded');
    expect(attempts).toBe(2);
  });

  it('does not burn the key on a gated call, so the approved replay is not a duplicate', async () => {
    // The claim sits after the gate on purpose: a held call took no side effect.
    register(NonIdempotentPublish);
    const { deps, claimed } = claimingHarness();

    const gated = await invokeTool(
      request({
        tool: 'publish.now',
        idempotencyKey: 'k3',
        brand: { ...brand, approvalMode: 'review_everything' },
      }),
      deps,
    );

    expect(gated.status).toBe('gated');
    expect(claimed.has('k3')).toBe(false);
  });
});

/* ── Cost is recorded even when the handler throws ────────────────────────── */

describe('recordCost on failure', () => {
  it('bills a spend whose handler reached the vendor and then threw', async () => {
    // A timeout after a render has started has spent the money regardless of
    // what we report. Skipping the ledger absorbed that silently — the 50c
    // avatar-video and 60c dubbing tools being the expensive cases.
    const billed: ToolCallRecord[] = [];
    register({
      ...Echo,
      name: 'content.generate_avatar_video',
      estimateCents: () => 50,
      handler: async () => {
        throw new Error('vendor timed out after starting the render');
      },
    });
    const { deps } = harness({ recordCost: async (r) => void billed.push(r) });

    const out = await invokeTool(request({ tool: 'content.generate_avatar_video' }), deps);

    expect(out.status).toBe('failed');
    expect(billed).toHaveLength(1);
    expect(billed[0]!.costCents).toBe(50);
  });

  it('bills nothing when there was no estimate to bill', async () => {
    const billed: ToolCallRecord[] = [];
    register({
      ...Echo,
      name: 'free.thing',
      handler: async () => {
        throw new Error('nope');
      },
    });
    const { deps } = harness({ recordCost: async (r) => void billed.push(r) });

    await invokeTool(request({ tool: 'free.thing' }), deps);
    expect(billed).toHaveLength(0);
  });
});

/* ── The engagement gate cannot be self-certified ─────────────────────────── */

describe('policy rule 6 — engagement eligibility is derived, never asserted', () => {
  /**
   * `engagement` used to sit on `InvokeRequest` and was forwarded verbatim from
   * the HTTP request body, so a client could post
   * `engagement: { eligible: true, autonomyConfigured: true }` and send
   * unattended replies for a campaign that had never published anything.
   *
   * It failed *closed* when omitted — rule 6 denies without it — which is why
   * it never presented as a broken feature. Forgeable is worse than broken.
   */
  const replier = (engagement?: { eligible: boolean; autonomyConfigured: boolean }) => ({
    ...Echo,
    name: 'engage.reply.send',
    effect: 'publish' as const,
    policySubject: async () => (engagement ? { engagement } : {}),
  });

  it('denies when the tool derives ineligible, whatever the request said', async () => {
    register(replier({ eligible: false, autonomyConfigured: true }));
    const { deps } = harness();

    // The request cannot carry `engagement` any more — this is the shape a
    // caller trying the old bypass would send, and it is simply ignored.
    const out = await invokeTool(
      { ...request({ tool: 'engage.reply.send' }), ...({ engagement: { eligible: true, autonomyConfigured: true } } as object) },
      deps,
    );

    expect(out.status).toBe('gated');
    if (out.status === 'gated' && out.decision.kind !== 'allow') {
      expect(out.decision.kind).toBe('deny');
      expect(out.decision.ruleId).toBe('engage.ineligible');
    }
  });

  it('holds for approval when eligible but autonomy is unconfigured', async () => {
    register(replier({ eligible: true, autonomyConfigured: false }));
    const { deps } = harness();
    const out = await invokeTool(request({ tool: 'engage.reply.send' }), deps);

    expect(out.status).toBe('gated');
    if (out.status === 'gated' && out.decision.kind !== 'allow') {
      expect(out.decision.kind).toBe('approval');
      expect(out.decision.ruleId).toBe('engage.unconfigured');
    }
  });

  it('allows once the tool derives both', async () => {
    register(replier({ eligible: true, autonomyConfigured: true }));
    const { deps } = harness();
    const out = await invokeTool(request({ tool: 'engage.reply.send' }), deps);
    expect(out.status).toBe('succeeded');
  });

  it('denies an engage publish whose tool derives nothing at all', async () => {
    // A `policySubject` that omits `engagement` must not read as permission.
    // Failing closed is the whole reason the old bypass went unnoticed, and it
    // is still the right behaviour — it just can no longer be overridden.
    register(replier());
    const { deps } = harness();
    const out = await invokeTool(request({ tool: 'engage.reply.send' }), deps);

    expect(out.status).toBe('gated');
    if (out.status === 'gated' && out.decision.kind !== 'allow') {
      expect(out.decision.ruleId).toBe('engage.ineligible');
    }
  });
});
