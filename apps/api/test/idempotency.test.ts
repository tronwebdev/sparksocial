import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, invokeTool, register, __resetRegistry, type ToolCtx } from '@sparksocial/tools';
import { memoryInvokeDeps } from '../src/app.js';

/**
 * Regression test for a bug that unit tests structurally could not catch.
 *
 * `direct.session.send` declares `idempotent: false`, and `invokeTool` requires
 * a key for it — so every tool-level test passed. But the replay itself is
 * conditional on the *dependency* being present
 * (`invoke.ts`: `if (req.idempotencyKey && deps.lookupIdempotent)`), and the
 * in-memory deps did not implement it. The key was demanded and then ignored:
 * two identical sends produced two real deliveries.
 *
 * It only showed up by running the whole chain against a live server. These
 * tests assert the guarantee at the level where it actually lives — the deps
 * plus `invokeTool` — rather than at the level where it merely looks true.
 */

const ctx = (): ToolCtx =>
  ({
    orgId: 'org_1',
    brandId: 'brand_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {} as ToolCtx['db'],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  }) as unknown as ToolCtx;

const brand = { createdAt: new Date('2026-01-01T00:00:00Z'), approvalMode: 'autopublish' as const };

/** Stands in for any external-effect tool; counts how often the effect ran. */
function countingTool() {
  let calls = 0;
  const tool = defineTool({
    name: 'test.send_once',
    version: 1,
    summary: 'Test tool with a real side effect.',
    input: z.object({ to: z.string() }),
    output: z.object({ messageId: z.string() }),
    effect: 'external',
    autonomy: 'auto',
    scopes: ['owner'],
    idempotent: false,
    async handler() {
      calls += 1;
      return { messageId: `msg_${calls}` };
    },
  });
  return { tool, calls: () => calls };
}

describe('memoryInvokeDeps', () => {
  it('implements lookupIdempotent, without which invokeTool never replays', async () => {
    // Asserted directly: its absence is invisible at every other level.
    expect(typeof memoryInvokeDeps().lookupIdempotent).toBe('function');
  });
});

describe('idempotent replay through invokeTool', () => {
  beforeEach(() => __resetRegistry());

  it('runs the side effect once for a repeated key', async () => {
    const { tool, calls } = countingTool();
    register(tool);
    const deps = memoryInvokeDeps();
    const req = {
      tool: tool.name,
      input: { to: '+2348012345678' },
      caller: 'user' as const,
      ctx: ctx(),
      brand,
      idempotencyKey: 'week-32',
    };

    const first = await invokeTool(req, deps);
    const second = await invokeTool(req, deps);

    expect(calls()).toBe(1);
    expect(first.status).toBe('succeeded');
    expect(second.status).toBe('succeeded');
    // The replay returns the *original* result, so the caller cannot tell
    // whether it was the first attempt — which is the point.
    if (first.status === 'succeeded' && second.status === 'succeeded') {
      expect(second.output).toEqual(first.output);
      expect(second.call.id).toBe(first.call.id);
    }
  });

  it('runs again for a different key', async () => {
    const { tool, calls } = countingTool();
    register(tool);
    const deps = memoryInvokeDeps();
    const base = { tool: tool.name, input: { to: '+234' }, caller: 'user' as const, ctx: ctx(), brand };

    await invokeTool({ ...base, idempotencyKey: 'week-32' }, deps);
    await invokeTool({ ...base, idempotencyKey: 'week-33' }, deps);

    // Next week's session is a different session; the guard must not swallow it.
    expect(calls()).toBe(2);
  });

  it('does not replay a prior failure, so a genuine retry still works', async () => {
    let attempt = 0;
    const tool = defineTool({
      name: 'test.flaky',
      version: 1,
      summary: 'Fails once, then succeeds.',
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      effect: 'external',
      autonomy: 'auto',
      scopes: ['owner'],
      idempotent: false,
      async handler() {
        attempt += 1;
        if (attempt === 1) throw new Error('transport down');
        return { ok: true };
      },
    });

    register(tool);
    const deps = memoryInvokeDeps();
    const req = { tool: tool.name, input: {}, caller: 'user' as const, ctx: ctx(), brand, idempotencyKey: 'k' };

    const failed = await invokeTool(req, deps);
    const retried = await invokeTool(req, deps);

    expect(failed.status).toBe('failed');
    // Only a `succeeded` row counts as a replay — otherwise one network blip
    // would permanently block that week's session from ever being sent.
    expect(retried.status).toBe('succeeded');
    expect(attempt).toBe(2);
  });

  it('still refuses a non-idempotent tool with no key at all', async () => {
    const { tool, calls } = countingTool();
    register(tool);
    const result = await invokeTool(
      { tool: tool.name, input: { to: '+234' }, caller: 'user', ctx: ctx(), brand },
      memoryInvokeDeps(),
    );

    expect(result.status).toBe('failed');
    expect(calls()).toBe(0);
  });
});
