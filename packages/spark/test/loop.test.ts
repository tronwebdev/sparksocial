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
        get: async () => undefined,
        listForOrg: async () => [],
      },
      assets: {
        inventory: async () => ({}),
        retrieve: async () => [],
        create: async () => ({ id: 'a' }),
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
          brandId, name: '', approvalMode: 'autopublish' as const,
          createdAt: new Date('2026-01-01T00:00:00Z'), agentPaused: false,
        }),
        setApprovalMode: async (brandId: string) => ({
          brandId, name: '', approvalMode: 'autopublish' as const,
          createdAt: new Date('2026-01-01T00:00:00Z'), agentPaused: false,
        }),
        setAgentPaused: async ({ brandId }: { brandId: string }) => ({
          brandId, name: '', approvalMode: 'autopublish' as const,
          createdAt: new Date('2026-01-01T00:00:00Z'), agentPaused: false,
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
