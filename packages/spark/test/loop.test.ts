import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Role } from '@sparksocial/shared';
import { defineTool, type ToolCtx } from '@sparksocial/tools/defineTool';
import { register, __resetRegistry, type InvokeDeps, type ToolCallRecord } from '@sparksocial/tools';
import { runAgent, type ModelClient, type ModelTurn } from '../src/loop.js';
import { memoryRunRecorder } from '../src/run.js';

/**
 * The loop's job is routing and governance, not cleverness: every tool call the
 * model makes must land in `invokeTool` with `caller: 'agent'`, carry the run id,
 * and be refused *before* that if it is out of the agent's scope.
 */

const Retrieve = defineTool({
  name: 'asset.retrieve',
  version: 1,
  summary: 'Find assets by intent.',
  input: z.object({ intent: z.string() }),
  output: z.object({ found: z.number() }),
  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,
  async handler() {
    return { found: 3 };
  },
});

const Publish = defineTool({
  name: 'publish.now',
  version: 1,
  summary: 'Publish a post.',
  input: z.object({ text: z.string() }),
  output: z.object({ ok: z.boolean() }),
  effect: 'publish',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: false,
  // Required of every publish tool by `defineTool` — see `PolicySubject`. These
  // tests are about containment flags, not platform restrictions.
  policySubject: async () => ({}),
  async handler() {
    return { ok: true };
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
        createDraft: async () => ({ id: 'g' }),
        patchDimensions: async () => ({ id: 'g', version: 1 }),
        patchConstraints: async () => ({ id: 'g', version: 1 }),
        patchIdentity: async () => ({ id: 'g', version: 1 }),
        patchOffer: async () => ({ id: 'g', version: 1 }),
        patchLearned: async () => ({ id: 'g', version: 1 }),
        get: async () => undefined,
        listForOrg: async () => [],
      },
      assets: {
        inventory: async () => ({}),
        retrieve: async () => [],
        create: async () => ({ id: 'a' }),
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

const brand = { createdAt: new Date('2026-07-01T00:00:00Z'), approvalMode: 'autopublish' as const };

/** A model that plays a fixed script of turns, so the loop is what's under test. */
function scriptedModel(turns: ModelTurn[]): ModelClient {
  let i = 0;
  return { async turn() { return turns[i++] ?? { toolCalls: [], text: 'done' }; } };
}

function harness(over: Partial<InvokeDeps> = {}) {
  const rows: ToolCallRecord[] = [];
  const recorder = memoryRunRecorder();
  const invoke: InvokeDeps = { writeToolCall: async (r) => void rows.push(r), ...over };
  return { rows, recorder, invoke };
}

beforeEach(() => {
  __resetRegistry();
  register(Retrieve);
  register(Publish);
});

describe('the agent goes through the same door as the UI', () => {
  it('every tool call is audited with caller "agent" and the run id attached', async () => {
    const h = harness();
    const result = await runAgent(
      {
        agent: 'curator',
        goal: 'Find fade photos',
        brandId: 'brand_1',
        trigger: 'user',
        ctx: ctx(),
        brand,
      },
      {
        model: scriptedModel([
          { toolCalls: [{ id: 'tc1', name: 'asset.retrieve', input: { intent: 'fade' } }] },
          { toolCalls: [], text: 'Found three.' },
        ]),
        invoke: h.invoke,
        recorder: h.recorder,
      },
    );

    expect(result.status).toBe('succeeded');
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]!.caller).toBe('agent');
    expect(h.rows[0]!.runId).toBe(result.runId);
    expect(h.rows[0]!.status).toBe('succeeded');
  });

  it('a gated call is reported to the model as needing approval, not as a failure', async () => {
    const h = harness();
    // review_everything makes the publish gate.
    const gated = { ...brand, approvalMode: 'review_everything' as const };
    const model = vi.fn<ModelClient['turn']>()
      .mockResolvedValueOnce({ toolCalls: [{ id: 'tc1', name: 'publish.now', input: { text: 'hi' } }] })
      .mockResolvedValueOnce({ toolCalls: [], text: 'Queued for review.' });

    await runAgent(
      { agent: 'producer', goal: 'Publish', brandId: 'brand_1', trigger: 'user', ctx: ctx(), brand: gated },
      { model: { turn: model }, invoke: h.invoke, recorder: h.recorder },
    );

    // The model must be told approval is needed and not to retry — otherwise it
    // loops against a standing policy until maxTurns.
    const seen = model.mock.calls[1]![0].messages.map((m) => m.content).join('\n');
    expect(seen).toContain('A human must approve it');
    expect(seen).toContain('do not retry');
  });
});

describe('the system prompt tells the model which brand it is working on', () => {
  // Regression: the model had no way to learn ctx.genomeId at all — no tool
  // answers "what brand is this conversation about" — so a chat asking about
  // "my campaigns" always got refused as unresolvable, even though the
  // caller's session had already resolved a genomeId server-side.
  it('includes the active genomeId, so the model never has to ask or guess', async () => {
    const h = harness();
    const model = vi.fn<ModelClient['turn']>().mockResolvedValue({ toolCalls: [], text: 'ok' });

    await runAgent(
      { agent: 'spark', goal: 'What are my campaigns?', brandId: 'brand_1', trigger: 'user', ctx: ctx({ genomeId: 'gen_42' }), brand },
      { model: { turn: model }, invoke: h.invoke, recorder: h.recorder },
    );

    expect(model.mock.calls[0]![0].system).toContain('gen_42');
  });

  it('says plainly that no brand is selected, rather than staying silent about it', async () => {
    const h = harness();
    const model = vi.fn<ModelClient['turn']>().mockResolvedValue({ toolCalls: [], text: 'ok' });

    await runAgent(
      { agent: 'spark', goal: 'What are my campaigns?', brandId: 'brand_1', trigger: 'user', ctx: ctx({ genomeId: undefined }), brand },
      { model: { turn: model }, invoke: h.invoke, recorder: h.recorder },
    );

    expect(model.mock.calls[0]![0].system).toContain('No brand is selected');
  });

  it('a delegated sub-agent gets the same genomeId, not a blank prompt', async () => {
    const h = harness();
    const sparkModel = vi.fn<ModelClient['turn']>().mockResolvedValueOnce({
      toolCalls: [{ id: 'tc1', name: 'agent.delegate', input: { agent: 'curator', goal: 'find assets' } }],
    });
    const curatorModel = vi.fn<ModelClient['turn']>().mockResolvedValue({ toolCalls: [], text: 'done' });
    const model: ModelClient = {
      turn: (args) => (args.agent === 'spark' ? sparkModel : curatorModel)(args),
    };

    await runAgent(
      { agent: 'spark', goal: 'find fade photos', brandId: 'brand_1', trigger: 'user', ctx: ctx({ genomeId: 'gen_42' }), brand },
      { model, invoke: h.invoke, recorder: h.recorder },
    );

    expect(curatorModel.mock.calls[0]![0].system).toContain('gen_42');
  });
});

describe('scope is enforced before governance', () => {
  it('refuses an out-of-scope call without writing an audit row', async () => {
    const h = harness();
    const model = vi.fn<ModelClient['turn']>()
      .mockResolvedValueOnce({ toolCalls: [{ id: 'tc1', name: 'publish.now', input: { text: 'x' } }] })
      .mockResolvedValueOnce({ toolCalls: [], text: 'ok' });

    // Curator's scope is `asset.*` — publish.now is a routing bug, not a
    // governance question, so it must not consume a policy evaluation.
    await runAgent(
      { agent: 'curator', goal: 'Publish', brandId: 'brand_1', trigger: 'user', ctx: ctx(), brand },
      { model: { turn: model }, invoke: h.invoke, recorder: h.recorder },
    );

    expect(h.rows).toHaveLength(0);
    // `messages` is mutated in place across turns, and vitest records the array
    // by reference — so `.at(-1)` on a recorded call reads the array's *final*
    // state, not its state at call time. Assert the message exists at all.
    const seen = model.mock.calls[1]![0].messages.map((m) => m.content);
    expect(seen.some((c) => c.includes('out of scope'))).toBe(true);
  });

  it('only exposes in-scope tools to the model in the first place', async () => {
    const h = harness();
    const model = vi.fn<ModelClient['turn']>().mockResolvedValue({ toolCalls: [], text: 'ok' });

    await runAgent(
      { agent: 'curator', goal: 'x', brandId: 'brand_1', trigger: 'user', ctx: ctx(), brand },
      { model: { turn: model }, invoke: h.invoke, recorder: h.recorder },
    );

    const exposed = model.mock.calls[0]![0].tools.map((t) => t.name);
    expect(exposed).toContain('asset.retrieve');
    expect(exposed).not.toContain('publish.now');
  });
});

describe('§10 containment reaches the policy engine', () => {
  it('a publish in an untrusted-context turn is escalated to approval', async () => {
    const h = harness();
    const result = await runAgent(
      {
        agent: 'producer',
        goal: 'Publish what the crawled page suggested',
        brandId: 'brand_1',
        trigger: 'user',
        ctx: ctx(),
        brand, // autopublish — would normally sail straight through
        ingestedUntrusted: true,
      },
      {
        model: scriptedModel([
          { toolCalls: [{ id: 'tc1', name: 'publish.now', input: { text: 'injected' } }] },
          { toolCalls: [], text: 'held' },
        ]),
        invoke: h.invoke,
        recorder: h.recorder,
      },
    );

    expect(result.status).toBe('succeeded');
    expect(h.rows).toHaveLength(1);
    // Autopublish is on, yet the row is gated — the containment flag did it.
    expect(h.rows[0]!.status).toBe('gated');
    expect(h.rows[0]!.decision).toBe('approval');
    expect(h.rows[0]!.ruleId).toBe('guardrail.flagged');
  });

  it('the same publish sails through when nothing untrusted was read', async () => {
    const h = harness();
    await runAgent(
      {
        agent: 'producer',
        goal: 'Publish',
        brandId: 'brand_1',
        trigger: 'user',
        ctx: ctx(),
        brand,
        ingestedUntrusted: false,
      },
      {
        model: scriptedModel([
          { toolCalls: [{ id: 'tc1', name: 'publish.now', input: { text: 'clean' } }] },
          { toolCalls: [], text: 'done' },
        ]),
        invoke: h.invoke,
        recorder: h.recorder,
      },
    );

    expect(h.rows[0]!.status).toBe('succeeded');
  });

  it('a read in an untrusted turn is NOT gated — containment is targeted, not a blanket freeze', async () => {
    const h = harness();
    await runAgent(
      {
        agent: 'curator',
        goal: 'Look at what the page mentioned',
        brandId: 'brand_1',
        trigger: 'user',
        ctx: ctx(),
        brand,
        ingestedUntrusted: true,
      },
      {
        model: scriptedModel([
          { toolCalls: [{ id: 'tc1', name: 'asset.retrieve', input: { intent: 'x' } }] },
          { toolCalls: [], text: 'done' },
        ]),
        invoke: h.invoke,
        recorder: h.recorder,
      },
    );

    expect(h.rows[0]!.status).toBe('succeeded');
  });
});

describe('run and step recording', () => {
  it('records a run plus a step per think and per tool call', async () => {
    const h = harness();
    await runAgent(
      { agent: 'curator', goal: 'Find photos', brandId: 'brand_1', trigger: 'schedule', ctx: ctx(), brand },
      {
        model: scriptedModel([
          { toolCalls: [{ id: 'tc1', name: 'asset.retrieve', input: { intent: 'fade' } }] },
          { toolCalls: [], text: 'Found three.' },
        ]),
        invoke: h.invoke,
        recorder: h.recorder,
      },
    );

    expect(h.recorder.runs).toHaveLength(1);
    expect(h.recorder.runs[0]).toMatchObject({ agent: 'curator', trigger: 'schedule', status: 'succeeded' });

    // think, tool, think — the reasoning between calls is what a tool_calls-only
    // timeline cannot show.
    expect(h.recorder.steps.map((s) => s.type)).toEqual(['think', 'tool', 'think']);
    expect(h.recorder.steps.map((s) => s.idx)).toEqual([0, 1, 2]);
  });

  it('marks the run failed and records why when the model refuses', async () => {
    const h = harness();
    const result = await runAgent(
      { agent: 'spark', goal: 'x', brandId: 'brand_1', trigger: 'user', ctx: ctx(), brand },
      { model: scriptedModel([{ toolCalls: [], refused: true }]), invoke: h.invoke, recorder: h.recorder },
    );

    expect(result.status).toBe('failed');
    expect(h.recorder.runs[0]!.error?.code).toBe('refusal');
  });

  it('links a delegated run to its parent', async () => {
    const h = harness();
    await runAgent(
      {
        agent: 'curator',
        goal: 'sub-task',
        brandId: 'brand_1',
        trigger: 'event',
        ctx: ctx(),
        brand,
        parentRunId: 'run_parent',
      },
      { model: scriptedModel([{ toolCalls: [], text: 'ok' }]), invoke: h.invoke, recorder: h.recorder },
    );

    expect(h.recorder.runs[0]!.parentRunId).toBe('run_parent');
  });
});

describe('delegation — plan §4.1, one orchestrator and nine specialists', () => {
  it('only the orchestrator is ever shown the delegation tool', async () => {
    const h = harness();
    const sparkModel = vi.fn<ModelClient['turn']>().mockResolvedValue({ toolCalls: [], text: 'ok' });
    await runAgent(
      { agent: 'spark', goal: 'x', brandId: 'brand_1', trigger: 'user', ctx: ctx(), brand },
      { model: { turn: sparkModel }, invoke: h.invoke, recorder: h.recorder },
    );
    expect(sparkModel.mock.calls[0]![0].tools.map((t) => t.name)).toContain('agent.delegate');

    const curatorModel = vi.fn<ModelClient['turn']>().mockResolvedValue({ toolCalls: [], text: 'ok' });
    await runAgent(
      { agent: 'curator', goal: 'x', brandId: 'brand_1', trigger: 'user', ctx: ctx(), brand },
      { model: { turn: curatorModel }, invoke: h.invoke, recorder: h.recorder },
    );
    expect(curatorModel.mock.calls[0]![0].tools.map((t) => t.name)).not.toContain('agent.delegate');
  });

  it('spark delegating to curator actually runs curator, whose own tool calls land in the same audit trail', async () => {
    const h = harness();
    const model = vi.fn<ModelClient['turn']>()
      .mockResolvedValueOnce({
        toolCalls: [{ id: 'tc1', name: 'agent.delegate', input: { agent: 'curator', goal: 'find fade photos' } }],
      })
      // Curator's own turn.
      .mockResolvedValueOnce({ toolCalls: [{ id: 'tc2', name: 'asset.retrieve', input: { intent: 'fade' } }] })
      .mockResolvedValueOnce({ toolCalls: [], text: 'Found three fade photos.' })
      // Back to spark.
      .mockResolvedValueOnce({ toolCalls: [], text: 'Curator found three.' });

    const result = await runAgent(
      { agent: 'spark', goal: 'Get me fade photos', brandId: 'brand_1', trigger: 'user', ctx: ctx(), brand },
      { model: { turn: model }, invoke: h.invoke, recorder: h.recorder },
    );

    expect(result.status).toBe('succeeded');
    expect(result.text).toBe('Curator found three.');

    // Two runs: spark's own, and curator's — linked by parentRunId.
    expect(h.recorder.runs).toHaveLength(2);
    const sparkRun = h.recorder.runs.find((r) => r.agent === 'spark')!;
    const curatorRun = h.recorder.runs.find((r) => r.agent === 'curator')!;
    expect(curatorRun.parentRunId).toBe(sparkRun.id);
    expect(curatorRun.trigger).toBe('event');

    // Curator's asset.retrieve call is audited exactly like any other agent
    // call — same caller, same store — delegation doesn't create a side channel.
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]!.caller).toBe('agent');
    expect(h.rows[0]!.runId).toBe(curatorRun.id);

    // The subagent's audit row is reachable from the parent's own result.
    expect(result.toolCallIds).toEqual([h.rows[0]!.id]);

    // Spark's next turn was told what curator found.
    const seenBySpark = model.mock.calls[3]![0].messages.map((m) => m.content).join('\n');
    expect(seenBySpark).toContain('Found three fade photos');
  });

  it('refuses delegation to an agent that does not exist, without crashing the run', async () => {
    const h = harness();
    const model = vi.fn<ModelClient['turn']>()
      .mockResolvedValueOnce({ toolCalls: [{ id: 'tc1', name: 'agent.delegate', input: { agent: 'ghost', goal: 'x' } }] })
      .mockResolvedValueOnce({ toolCalls: [], text: 'gave up' });

    const result = await runAgent(
      { agent: 'spark', goal: 'x', brandId: 'brand_1', trigger: 'user', ctx: ctx(), brand },
      { model: { turn: model }, invoke: h.invoke, recorder: h.recorder },
    );

    expect(result.status).toBe('succeeded');
    expect(h.recorder.runs).toHaveLength(1); // no second run was ever started
    const seen = model.mock.calls[1]![0].messages.map((m) => m.content).join('\n');
    expect(seen).toContain('not a specialist');
  });

  it('a specialist cannot delegate even if it somehow emits the call — scope.ts, not just the exposed-tools list, is the real gate', async () => {
    const h = harness();
    const model = vi.fn<ModelClient['turn']>()
      .mockResolvedValueOnce({ toolCalls: [{ id: 'tc1', name: 'agent.delegate', input: { agent: 'field', goal: 'x' } }] })
      .mockResolvedValueOnce({ toolCalls: [], text: 'ok' });

    await runAgent(
      { agent: 'curator', goal: 'x', brandId: 'brand_1', trigger: 'user', ctx: ctx(), brand },
      { model: { turn: model }, invoke: h.invoke, recorder: h.recorder },
    );

    expect(h.recorder.runs).toHaveLength(1); // curator's own run only
    const seen = model.mock.calls[1]![0].messages.map((m) => m.content).join('\n');
    expect(seen).toContain('Delegation refused');
  });
});

describe('the loop terminates', () => {
  it('stops at maxTurns rather than looping forever on a model that never finishes', async () => {
    const h = harness();
    // A model that always asks for the same tool again.
    const model: ModelClient = {
      async turn() {
        return { toolCalls: [{ id: 'tc', name: 'asset.retrieve', input: { intent: 'again' } }] };
      },
    };

    const result = await runAgent(
      { agent: 'curator', goal: 'loop', brandId: 'brand_1', trigger: 'user', ctx: ctx(), brand, maxTurns: 3 },
      { model, invoke: h.invoke, recorder: h.recorder },
    );

    expect(result.status).toBe('succeeded');
    expect(h.rows).toHaveLength(3); // exactly maxTurns, not unbounded
  });
});
