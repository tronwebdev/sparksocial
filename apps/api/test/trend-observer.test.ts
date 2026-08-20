import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, register, __resetRegistry, type ScopedDb } from '@sparksocial/tools';
import { runOnce } from '../src/trend-observer.js';
import { createDevStore } from '../src/dev-store.js';
import { memoryInvokeDeps } from '../src/app.js';

/**
 * THE TREND OBSERVER — PRD §8.9's time series, sampled on a clock.
 *
 * Same interception trick as `scheduler.test.ts`: `runOnce` hardcodes
 * `tool: 'trend.observe'`, so registering a fake under that exact name proves
 * the observer goes through `invokeTool`'s real middleware chain — policy,
 * idempotency, `tool_calls` recording — rather than calling a handler directly.
 * That is the property worth testing here; the sampling itself is covered in
 * `packages/trends/test/tool.test.ts`.
 */
function fakeObserve(opts: { throws?: boolean } = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const tool = defineTool({
    name: 'trend.observe',
    version: 1,
    summary: 'fake trend.observe for observer tests',
    input: z.object({ limit: z.number() }),
    output: z.object({ observed: z.number() }),
    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin'],
    idempotent: true,
    async handler(input) {
      calls.push(input);
      if (opts.throws) throw new Error('trend source down');
      return { observed: 3 };
    },
  });
  return { tool, calls };
}

const deps = (db: ScopedDb, invoke: ReturnType<typeof memoryInvokeDeps>, now: Date) => ({
  db,
  invoke,
  now: () => now,
});

describe('trend observer', () => {
  beforeEach(() => __resetRegistry());

  it('samples through the registry, so the row looks like any other tool call', async () => {
    const { tool, calls } = fakeObserve();
    register(tool);
    const invoke = memoryInvokeDeps();

    await runOnce(deps(createDevStore() as unknown as ScopedDb, invoke, new Date('2026-08-20T14:20:00Z')));

    expect(calls).toHaveLength(1);
    expect(invoke.rows).toHaveLength(1);
    expect(invoke.rows[0]!.tool).toBe('trend.observe');
    expect(invoke.rows[0]!.caller).toBe('agent');
  });

  it('does not run as a customer', async () => {
    // The rows `trend.observe` writes are shared by every brand. Booking them
    // against whichever tenant happened to be first would put one brand's
    // audit log in charge of everyone's chart.
    const { tool } = fakeObserve();
    register(tool);
    const invoke = memoryInvokeDeps();

    await runOnce(deps(createDevStore() as unknown as ScopedDb, invoke, new Date('2026-08-20T14:20:00Z')));

    expect(invoke.rows[0]!.orgId).toBe('system');
    expect(invoke.rows[0]!.genomeId).toBeUndefined();
  });

  it('treats two ticks inside one hour as the same call', async () => {
    // The store buckets to the hour, so a second tick genuinely does no new
    // work — and should not leave a `tool_calls` row that says it did.
    const { tool, calls } = fakeObserve();
    register(tool);
    const invoke = memoryInvokeDeps();
    const db = createDevStore() as unknown as ScopedDb;

    await runOnce(deps(db, invoke, new Date('2026-08-20T14:05:00Z')));
    await runOnce(deps(db, invoke, new Date('2026-08-20T14:55:00Z')));

    expect(calls).toHaveLength(1);
  });

  it('samples again in the next hour', async () => {
    const { tool, calls } = fakeObserve();
    register(tool);
    const invoke = memoryInvokeDeps();
    const db = createDevStore() as unknown as ScopedDb;

    await runOnce(deps(db, invoke, new Date('2026-08-20T14:55:00Z')));
    await runOnce(deps(db, invoke, new Date('2026-08-20T15:05:00Z')));

    expect(calls).toHaveLength(2);
  });

  it('logs a failed sample rather than throwing out of the tick', async () => {
    // A trend source being down must not take the API process with it — the
    // same contract the publish and recipe schedulers hold to.
    const { tool } = fakeObserve({ throws: true });
    register(tool);
    const invoke = memoryInvokeDeps();

    await expect(
      runOnce(deps(createDevStore() as unknown as ScopedDb, invoke, new Date('2026-08-20T14:20:00Z'))),
    ).resolves.toBeUndefined();
    expect(invoke.rows[0]!.status).toBe('failed');
  });
});
