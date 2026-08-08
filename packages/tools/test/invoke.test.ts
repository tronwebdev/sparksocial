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
        get: async () => undefined,
        listForOrg: async () => [],
      },
      assets: {
        inventory: async () => ({}),
        retrieve: async () => [],
        create: async () => ({ id: 'asset_1' }),
        captionsByRole: async () => [],
        info: async () => ({}),
      },
      content: { recent: async () => [] },
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
