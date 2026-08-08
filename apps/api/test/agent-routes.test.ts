import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared/types';
import type { ToolCtx } from '@sparksocial/tools';
import { memoryRunEventBus, type RunAgentArgs, type RunEventBus } from '@sparksocial/spark';
import { createApp, memoryInvokeDeps } from '../src/app.js';
import { createDevRunStore } from '../src/dev-runs.js';

/**
 * The agent routes carry two things the tool door does not: they start something
 * long-running, and they hold a connection open. Both are authorisation
 * surfaces, and both are tested here against real HTTP requests through Hono
 * rather than by calling the handlers directly — a route that forgets to call
 * `resolveCtx` would still pass a handler-level test.
 */

const startedAt = new Date('2026-08-08T10:00:00Z');

function baseCtx(over: Partial<ToolCtx> = {}): ToolCtx & { caller: 'user' | 'agent' } {
  return {
    orgId: 'org_1',
    brandId: 'brand_1',
    role: 'owner',
    caller: 'user',
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
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n, fn) => fn(), event: () => {} },
    ...over,
  } as ToolCtx & { caller: 'user' | 'agent' };
}

function app(over: {
  ctx?: ToolCtx & { caller: 'user' | 'agent' };
  resolveThrows?: boolean;
  agent?: { run: ReturnType<typeof vi.fn>; bus: RunEventBus };
} = {}) {
  return createApp({
    resolveCtx: async () => {
      if (over.resolveThrows) throw new ToolError('FORBIDDEN', 'bad token');
      return over.ctx ?? baseCtx();
    },
    loadBrandGovernance: async () => ({ createdAt: startedAt, approvalMode: 'autopublish' as const }),
    invokeDeps: memoryInvokeDeps(),
    ...(over.agent ? { agent: over.agent } : {}),
  });
}

/**
 * Typed against `RunAgentArgs` rather than a bare `vi.fn(async () => …)`: the
 * zero-arg form makes `mock.calls[0]` an empty tuple, so the assertions that
 * matter most here — what `brandId` and `caller` the route passed through —
 * would not typecheck.
 */
const runner = () =>
  vi.fn(async (_args: RunAgentArgs) => ({
    runId: 'run_1',
    status: 'succeeded' as const,
    text: 'done',
    toolCallIds: [],
  }));

describe('POST /v1/agent/runs', () => {
  it('answers 501 when no runtime is configured, rather than pretending to run', async () => {
    const res = await app().request('/v1/agent/runs', {
      method: 'POST',
      body: JSON.stringify({ goal: 'hello' }),
    });
    expect(res.status).toBe(501);
  });

  it('answers 401 before 501, so configuration is not probeable anonymously', async () => {
    // No runtime *and* no valid session: the caller must learn only that they
    // are not authenticated, never how this deployment is wired.
    const res = await app({ resolveThrows: true }).request('/v1/agent/runs', {
      method: 'POST',
      body: JSON.stringify({ goal: 'hello' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects an unauthenticated caller before touching the runtime', async () => {
    const run = runner();
    const res = await app({ resolveThrows: true, agent: { run, bus: memoryRunEventBus() } }).request(
      '/v1/agent/runs',
      { method: 'POST', body: JSON.stringify({ goal: 'hello' }) },
    );

    expect(res.status).toBe(401);
    // The point of the assertion: an agent run costs money and takes real
    // actions, so it must not start and then fail auth.
    expect(run).not.toHaveBeenCalled();
  });

  it('requires a goal', async () => {
    const res = await app({ agent: { run: runner(), bus: memoryRunEventBus() } }).request('/v1/agent/runs', {
      method: 'POST',
      body: JSON.stringify({ goal: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('takes brandId from the session, never from the request body', async () => {
    const run = runner();
    await app({ agent: { run, bus: memoryRunEventBus() } }).request('/v1/agent/runs', {
      method: 'POST',
      body: JSON.stringify({ goal: 'plan the week', brandId: 'brand_someone_else' }),
    });

    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]![0]).toMatchObject({ brandId: 'brand_1' });
  });

  it('forwards the authenticated identity to the runtime unaltered', async () => {
    const run = runner();
    await app({ agent: { run, bus: memoryRunEventBus() } }).request('/v1/agent/runs', {
      method: 'POST',
      body: JSON.stringify({ goal: 'plan the week' }),
    });

    // Attribution of the *tool calls* is `runAgent`'s job — it stamps
    // `caller: 'agent'` on each one (loop.ts), which is what the P1 exit
    // criterion compares against a UI click. The route's contract is narrower
    // and is what's asserted here: the org/role reaching the runtime are the
    // ones the session proved, not anything from the body.
    const forwarded = run.mock.calls[0]![0];
    expect(forwarded.ctx.orgId).toBe('org_1');
    expect(forwarded.ctx.role).toBe('owner');
    expect(forwarded.trigger).toBe('user');
  });

  it('refuses when no brand is selected', async () => {
    const res = await app({
      ctx: baseCtx({ brandId: undefined }),
      agent: { run: runner(), bus: memoryRunEventBus() },
    }).request('/v1/agent/runs', { method: 'POST', body: JSON.stringify({ goal: 'go' }) });

    expect(res.status).toBe(400);
  });
});

describe('GET /v1/agent/runs/:runId/events', () => {
  const withRun = async () => {
    const store = createDevRunStore();
    await store.recorder.startRun({
      id: 'run_1', brandId: 'brand_1', agent: 'spark', goal: 'plan', trigger: 'user', startedAt,
    });
    await store.recorder.appendStep({
      runId: 'run_1', idx: 0, type: 'think', payload: { text: 'considering' }, ms: 5, at: startedAt,
    });
    await store.recorder.finishRun('run_1', { status: 'succeeded', endedAt: startedAt });
    return store;
  };

  it('rejects an unauthenticated caller', async () => {
    const res = await app({ resolveThrows: true, agent: { run: runner(), bus: memoryRunEventBus() } }).request(
      '/v1/agent/runs/run_1/events',
    );
    expect(res.status).toBe(401);
  });

  it('answers 401 before 501, so configuration is not probeable anonymously', async () => {
    const res = await app({ resolveThrows: true }).request('/v1/agent/runs/run_1/events');
    expect(res.status).toBe(401);
  });

  it("404s a run belonging to another brand, and never opens a stream", async () => {
    const store = await withRun();
    const res = await app({
      // Authenticated, but for a different brand than the run.
      ctx: baseCtx({ brandId: 'brand_2', db: { ...baseCtx().db, runs: store.reader } as ToolCtx['db'] }),
      agent: { run: runner(), bus: memoryRunEventBus() },
    }).request('/v1/agent/runs/run_1/events');

    expect(res.status).toBe(404);
    // A stream that opened and then emitted nothing would leak the run's
    // existence through timing and would hold a connection for a caller with no
    // right to it.
    expect(res.headers.get('content-type')).not.toContain('text/event-stream');
  });

  it('replays the recorded steps for an in-scope finished run and closes', async () => {
    const store = await withRun();
    const res = await app({
      ctx: baseCtx({ db: { ...baseCtx().db, runs: store.reader } as ToolCtx['db'] }),
      agent: { run: runner(), bus: memoryRunEventBus() },
    }).request('/v1/agent/runs/run_1/events');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const body = await res.text();
    // Replaying from the database rather than only forwarding live events is
    // what lets a client attach mid-run — or after a reconnect — without a hole
    // in the timeline.
    expect(body).toContain('event: step');
    expect(body).toContain('considering');
    expect(body).toContain('event: finished');
  });

  it('streams live steps to a subscriber while the run is still going', async () => {
    const store = createDevRunStore();
    await store.recorder.startRun({
      id: 'run_live', brandId: 'brand_1', agent: 'spark', goal: 'plan', trigger: 'user', startedAt,
    });
    const bus = memoryRunEventBus();

    const res = await app({
      ctx: baseCtx({ db: { ...baseCtx().db, runs: store.reader } as ToolCtx['db'] }),
      agent: { run: runner(), bus },
    }).request('/v1/agent/runs/run_live/events');

    expect(res.status).toBe(200);

    // The handler is parked waiting on the bus; publishing releases it.
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    bus.publish({
      kind: 'step', runId: 'run_live', idx: 0, type: 'tool',
      payload: { tool: 'genome.list' }, ms: 3, at: startedAt.toISOString(),
    });
    bus.publish({ kind: 'finished', runId: 'run_live', status: 'succeeded' });

    // Read to close, not merely to the `finished` frame: the handler releases
    // its subscription in a `finally` that runs after the last write, so
    // asserting on cleanup the moment those bytes arrive races the handler.
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }

    expect(text).toContain('genome.list');
    expect(text).toContain('event: finished');
    // The subscription must be released when the stream ends, or a busy server
    // accumulates one dead listener per closed timeline.
    expect(bus.subscriberCount()).toBe(0);
    expect(bus.trackedRunCount()).toBe(0);
  });
});
