import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared/types';
import type { RunDetail, RunSummary, ToolCtx } from '@sparksocial/tools';
import { agentRunGet, agentRunList } from '../src/index.js';

/**
 * The Timeline is the surface a user consults to decide whether the agent can be
 * trusted to publish unattended. Two properties matter more than the rest, and
 * both are asserted here: it must render in the agent's real order, and it must
 * never render another brand's runs.
 */

const startedAt = new Date('2026-08-08T10:00:00Z');

const summary = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 'run_1',
  agent: 'spark',
  goal: 'plan the week',
  trigger: 'user',
  status: 'succeeded',
  costCents: 12,
  startedAt,
  endedAt: new Date('2026-08-08T10:00:30Z'),
  ...over,
});

const detail = (over: Partial<RunDetail> = {}): RunDetail => ({
  ...summary(),
  tokens: { input: 100, output: 40 },
  steps: [],
  ...over,
});

function ctx(runs: Partial<ToolCtx['db']['runs']>, over: Partial<ToolCtx> = {}): ToolCtx {
  return {
    orgId: 'org_1',
    brandId: 'brand_1',
    role: 'owner',
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
      content: {
        recent: async () => [],
        createDraft: async () => { throw new Error('content.createDraft not stubbed in this test'); },
        get: async () => undefined,
        updateDraft: async () => undefined,
      },
      runs: { list: async () => [], get: async () => undefined, ...runs },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n, fn) => fn(), event: () => {} },
    ...over,
  } as ToolCtx;
}

describe('agent.run.list', () => {
  it('passes the caller-verified brand to the store, never a caller-supplied one', async () => {
    const seen: Array<{ brandId: string; limit: number }> = [];
    const out = await agentRunList.handler(
      { limit: 25 },
      ctx({
        list: async (brandId, limit) => {
          seen.push({ brandId, limit });
          return [summary()];
        },
      }),
    );

    // `brand_1` comes from ToolCtx (the verified session), and there is no input
    // field that could override it — that is the whole isolation story here.
    expect(seen).toEqual([{ brandId: 'brand_1', limit: 25 }]);
    expect(out.runs).toHaveLength(1);
    expect(out.runs[0]).toMatchObject({ runId: 'run_1', agent: 'spark', status: 'succeeded' });
  });

  it('computes duration from the run, and leaves it null while still running', async () => {
    const out = await agentRunList.handler(
      { limit: 10 },
      ctx({
        list: async () => [
          summary({ id: 'done', endedAt: new Date('2026-08-08T10:00:30Z') }),
          summary({ id: 'live', status: 'running', endedAt: undefined }),
        ],
      }),
    );

    expect(out.runs[0]!.durationMs).toBe(30_000);
    expect(out.runs[1]!.durationMs).toBeNull();
  });

  it('refuses when no brand is selected rather than falling back to one', async () => {
    await expect(
      agentRunList.handler({ limit: 25 }, ctx({}, { brandId: undefined })),
    ).rejects.toThrow(ToolError);
  });

  it('rejects a limit above the cap at the schema, before any query runs', () => {
    expect(agentRunList.input.safeParse({ limit: 5_000 }).success).toBe(false);
    expect(agentRunList.input.safeParse({ limit: 0 }).success).toBe(false);
    expect(agentRunList.input.parse({}).limit).toBe(25);
  });
});

describe('agent.run.get', () => {
  it('renders steps in `idx` order even when the store returns them shuffled', async () => {
    const at = new Date('2026-08-08T10:00:00Z');
    const step = (idx: number, type: 'think' | 'tool') => ({ idx, type, payload: { n: idx }, ms: 1, at });

    const out = await agentRunGet.handler(
      { runId: 'run_1' },
      ctx({
        get: async () =>
          detail({ steps: [step(2, 'tool'), step(0, 'think'), step(1, 'tool')] }),
      }),
    );

    // Ordering by `idx` rather than `at` is the point: these three steps share a
    // timestamp, so a time-sorted timeline would present them arbitrarily and
    // misrepresent what the agent actually did first.
    expect(out.steps.map((s) => s.idx)).toEqual([0, 1, 2]);
  });

  it('reports a run belonging to another brand as NOT_FOUND, not FORBIDDEN', async () => {
    // The store returns undefined for out-of-scope runs; the tool must not
    // distinguish "exists elsewhere" from "does not exist", or run ids become
    // an oracle for probing another brand's activity.
    const err = await agentRunGet
      .handler({ runId: 'someone_elses_run' }, ctx({ get: async () => undefined }))
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe('NOT_FOUND');
  });

  it('surfaces a failed run with its error instead of hiding the failure', async () => {
    const out = await agentRunGet.handler(
      { runId: 'run_1' },
      ctx({
        get: async () =>
          detail({ status: 'failed', error: { code: 'UPSTREAM_FAILED', message: 'model timed out' } }),
      }),
    );

    expect(out.status).toBe('failed');
    expect(out.error).toEqual({ code: 'UPSTREAM_FAILED', message: 'model timed out' });
  });
});

describe('registry contract', () => {
  it('both tools are read-effect and idempotent — the Timeline can never mutate history', () => {
    for (const tool of [agentRunList, agentRunGet]) {
      expect(tool.effect).toBe('read');
      expect(tool.idempotent).toBe(true);
      // Visible to every role including client/viewer: an accountability surface
      // only the owner can see is not accountability.
      expect(tool.scopes).toContain('viewer');
      expect(tool.scopes).toContain('client');
    }
  });
});
