import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetReads, sharedRead } from '@/lib/readCache';
import { invoke } from '@/lib/tools';

/**
 * Reads shared between callers — `lib/readCache.ts`.
 *
 * The Command Center fired `genome.list` five times on one load. These pin the
 * sharing, and the three things that keep it from showing stale data: writes
 * clear it, failures are never kept, and each caller gets its own copy.
 */

type R = { status: string; output?: { items: number[] } };
const ok = (items: number[]): R => ({ status: 'succeeded', output: { items } });

beforeEach(() => forgetReads());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sharedRead', () => {
  it('sends one request for callers asking at once', async () => {
    const run = vi.fn(async () => ok([1]));
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => sharedRead('genome.list', {}, run)));
    expect(run).toHaveBeenCalledTimes(1);
    expect(a).toEqual(ok([1]));
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('reuses an answer for five seconds, then asks again', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => ok([1]));
    await sharedRead('agent.status', { genomeId: 'g' }, run);
    vi.advanceTimersByTime(4_000);
    await sharedRead('agent.status', { genomeId: 'g' }, run);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    await sharedRead('agent.status', { genomeId: 'g' }, run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keys on the input', async () => {
    const run = vi.fn(async () => ok([1]));
    await sharedRead('content.list', { genomeId: 'a' }, run);
    await sharedRead('content.list', { genomeId: 'b' }, run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('never keeps a failure', async () => {
    const run = vi.fn(async (): Promise<R> => ({ status: 'failed' }));
    await sharedRead('campaign.list', {}, run);
    await sharedRead('campaign.list', {}, run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('gives each caller its own copy', async () => {
    const run = vi.fn(async () => ok([3, 1, 2]));
    const a = await sharedRead('content.list', {}, run);
    a.output!.items.sort();
    const b = await sharedRead('content.list', {}, run);
    expect(b.output!.items).toEqual([3, 1, 2]);
  });
});

describe('invoke', () => {
  const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

  it('shares listed reads and lets a write clear them', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('content.list') ? reply(ok([1])) : reply({ status: 'succeeded', callId: 'w', output: {} }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await invoke('content.list', { genomeId: 'g' });
    await invoke('content.list', { genomeId: 'g' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await invoke('content.beat.update', { beatId: 'hook' });
    await invoke('content.list', { genomeId: 'g' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never shares a call made with an idempotency key', async () => {
    const fetchMock = vi.fn(async () => reply(ok([1])));
    vi.stubGlobal('fetch', fetchMock);
    await invoke('content.list', { genomeId: 'g' }, 'k1');
    await invoke('content.list', { genomeId: 'g' }, 'k2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
