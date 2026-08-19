import { describe, expect, it, vi } from 'vitest';
import { broadcastingRecorder, memoryRunEventBus, memoryRunRecorder } from '../src/index.js';
import type { RunEvent } from '../src/index.js';

const step = (runId: string, idx: number) => ({
  runId,
  idx,
  type: 'think' as const,
  payload: { text: `t${idx}` },
  ms: 5,
  at: new Date('2026-08-08T10:00:00Z'),
});

const run = (id: string, brandId = 'brand_1') => ({
  id,
  brandId,
  agent: 'spark' as const,
  goal: 'do the thing',
  trigger: 'user' as const,
  startedAt: new Date('2026-08-08T10:00:00Z'),
});

describe('memoryRunEventBus', () => {
  it('delivers only to subscribers of that run', () => {
    const bus = memoryRunEventBus();
    const a: RunEvent[] = [];
    const b: RunEvent[] = [];
    bus.subscribe('run_a', (e) => a.push(e));
    bus.subscribe('run_b', (e) => b.push(e));

    bus.publish({ kind: 'finished', runId: 'run_a', status: 'succeeded' });

    expect(a).toHaveLength(1);
    // The isolation that matters here: a timeline open on one run must never
    // receive another run's events, since runs belong to different brands.
    expect(b).toHaveLength(0);
  });

  it('publishing to a run with no subscribers is a no-op, not a throw', () => {
    const bus = memoryRunEventBus();
    expect(() => bus.publish({ kind: 'finished', runId: 'nobody', status: 'failed' })).not.toThrow();
  });

  it('unsubscribe stops delivery and is idempotent', () => {
    const bus = memoryRunEventBus();
    const seen: RunEvent[] = [];
    const off = bus.subscribe('run_a', (e) => seen.push(e));

    bus.publish({ kind: 'finished', runId: 'run_a', status: 'succeeded' });
    off();
    off(); // SSE cleanup can fire twice; the second must not corrupt state
    bus.publish({ kind: 'finished', runId: 'run_a', status: 'succeeded' });

    expect(seen).toHaveLength(1);
    expect(bus.subscriberCount()).toBe(0);
  });

  it('releases the per-run entry once empty, so a long-lived server does not leak', () => {
    const bus = memoryRunEventBus();
    const offs = Array.from({ length: 50 }, (_, i) => bus.subscribe(`run_${i}`, () => {}));
    expect(bus.subscriberCount()).toBe(50);
    expect(bus.trackedRunCount()).toBe(50);

    offs.forEach((off) => off());

    expect(bus.subscriberCount()).toBe(0);
    // The assertion that actually catches the leak: an implementation that
    // removes the listener but keeps the empty Set reports zero subscribers
    // while its Map grows by one entry per run, forever.
    expect(bus.trackedRunCount()).toBe(0);
  });

  it('a listener subscribing during publish is not re-entered by that same publish', () => {
    const bus = memoryRunEventBus();
    const calls: string[] = [];
    let added = false;

    bus.subscribe('run_a', () => {
      calls.push('first');
      if (added) return;
      added = true;
      // Iterating the live Set would hand this new listener to the in-flight
      // loop, re-entering delivery within one publish.
      bus.subscribe('run_a', () => calls.push('late'));
    });

    bus.publish({ kind: 'finished', runId: 'run_a', status: 'succeeded' });

    expect(calls).toEqual(['first']);
    // It is subscribed for the *next* event, just not this one.
    bus.publish({ kind: 'finished', runId: 'run_a', status: 'succeeded' });
    expect(calls).toEqual(['first', 'first', 'late']);
  });

  it('one throwing subscriber does not stop the others', () => {
    const bus = memoryRunEventBus();
    const good = vi.fn();
    bus.subscribe('run_a', () => {
      throw new Error('subscriber blew up');
    });
    bus.subscribe('run_a', good);

    expect(() => bus.publish({ kind: 'finished', runId: 'run_a', status: 'succeeded' })).not.toThrow();
    expect(good).toHaveBeenCalledOnce();
  });

  it('a subscriber that unsubscribes itself mid-publish does not disturb delivery', () => {
    const bus = memoryRunEventBus();
    const seen: string[] = [];
    // This is exactly what the SSE handler does when it sees `finished`.
    const off = bus.subscribe('run_a', () => {
      seen.push('self');
      off();
    });
    bus.subscribe('run_a', () => seen.push('other'));

    expect(() => bus.publish({ kind: 'finished', runId: 'run_a', status: 'succeeded' })).not.toThrow();
    expect(seen).toEqual(['self', 'other']);
  });
});

describe('broadcastingRecorder', () => {
  it('writes through to the underlying recorder and publishes each write', async () => {
    const inner = memoryRunRecorder();
    const bus = memoryRunEventBus();
    const seen: RunEvent[] = [];
    bus.subscribe('run_1', (e) => seen.push(e));

    const rec = broadcastingRecorder(inner, bus);
    await rec.startRun(run('run_1'));
    await rec.appendStep(step('run_1', 0));
    await rec.finishRun('run_1', { status: 'succeeded', costCents: 42, endedAt: new Date('2026-08-08T10:01:00Z') });

    // Durable side is unchanged — the decorator must not swallow writes.
    expect(inner.runs).toHaveLength(1);
    expect(inner.runs[0]!.status).toBe('succeeded');
    expect(inner.steps).toHaveLength(1);

    expect(seen.map((e) => e.kind)).toEqual(['started', 'step', 'finished']);
    const finished = seen[2]!;
    expect(finished).toMatchObject({ kind: 'finished', status: 'succeeded', costCents: 42 });
  });

  it('publishes only after the durable write succeeds', async () => {
    const bus = memoryRunEventBus();
    const seen: RunEvent[] = [];
    bus.subscribe('run_1', (e) => seen.push(e));

    const failing = {
      ...memoryRunRecorder(),
      appendStep: async () => {
        throw new Error('postgres is down');
      },
    };
    const rec = broadcastingRecorder(failing, bus);

    await expect(rec.appendStep(step('run_1', 0))).rejects.toThrow('postgres is down');
    // A client must never be shown a step that was not persisted; on reconnect
    // the replay would not contain it and the timeline would contradict itself.
    expect(seen).toHaveLength(0);
  });
});
