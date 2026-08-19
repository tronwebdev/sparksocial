import { describe, expect, it } from 'vitest';
import { createCompositeTrendSource } from '../src/composite.js';
import type { Trend, TrendSource } from '../src/trend.js';

/**
 * The two properties this file exists to enforce: a disabled source is
 * excluded entirely (never even called), and an enabled source that throws
 * degrades the merge to "everyone else" rather than failing the whole call.
 */

function fakeSource(name: string, trends: Trend[], opts: { throws?: boolean } = {}): TrendSource {
  return {
    name,
    async fetch() {
      if (opts.throws) throw new Error(`${name} is down`);
      return trends;
    },
    async get(id) {
      return trends.find((t) => t.id === id);
    },
  };
}

const trendOf = (id: string, topic: string): Trend => ({
  id,
  source: 'manual',
  topic,
  tags: [],
  metrics: { volume: 100, velocity: 0.5, saturation: 0.2, growth: 0 },
  samples: [],
  language: 'en',
});

describe('createCompositeTrendSource', () => {
  it('merges results from every enabled source', async () => {
    const a = fakeSource('a', [trendOf('1', 'from a')]);
    const b = fakeSource('b', [trendOf('1', 'from b')]); // deliberately colliding raw id
    const composite = createCompositeTrendSource([{ source: a }, { source: b }]);

    const out = await composite.fetch({ limit: 10 });
    expect(out).toHaveLength(2);
    expect(out.map((t) => t.topic).sort()).toEqual(['from a', 'from b']);
  });

  it('never calls a disabled source', async () => {
    let called = false;
    const off: TrendSource = {
      name: 'off',
      async fetch() {
        called = true;
        return [];
      },
    };
    const composite = createCompositeTrendSource([{ source: off, enabled: false }]);
    await composite.fetch({ limit: 10 });
    expect(called).toBe(false);
  });

  it('a throwing source degrades the merge instead of failing the call', async () => {
    const good = fakeSource('good', [trendOf('1', 'still here')]);
    const bad = fakeSource('bad', [], { throws: true });
    const errors: string[] = [];
    const composite = createCompositeTrendSource(
      [{ source: good }, { source: bad }],
      { onSourceError: (name) => errors.push(name) },
    );

    const out = await composite.fetch({ limit: 10 });
    expect(out.map((t) => t.topic)).toEqual(['still here']);
    expect(errors).toEqual(['bad']);
  });

  it('returns an empty feed, not an error, when nothing is enabled', async () => {
    const composite = createCompositeTrendSource([]);
    await expect(composite.fetch({ limit: 10 })).resolves.toEqual([]);
  });

  it('prefixes ids so two sources using the same raw id never collide', async () => {
    const a = fakeSource('a', [trendOf('1', 'from a')]);
    const b = fakeSource('b', [trendOf('1', 'from b')]);
    const composite = createCompositeTrendSource([{ source: a }, { source: b }]);

    const out = await composite.fetch({ limit: 10 });
    const ids = out.map((t) => t.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => id.includes('::'))).toBe(true);
  });

  it('get() routes a prefixed id back to the source that minted it', async () => {
    const a = fakeSource('a', [trendOf('1', 'from a')]);
    const b = fakeSource('b', [trendOf('1', 'from b')]);
    const composite = createCompositeTrendSource([{ source: a }, { source: b }]);

    const fetched = await composite.fetch({ limit: 10 });
    const bTrend = fetched.find((t) => t.topic === 'from b')!;
    const resolved = await composite.get!(bTrend.id);
    expect(resolved?.topic).toBe('from b');
  });

  it('get() returns undefined for a disabled source\'s id rather than throwing', async () => {
    const a = fakeSource('a', [trendOf('1', 'from a')]);
    const composite = createCompositeTrendSource([{ source: a, enabled: false }]);
    await expect(composite.get!('a::1')).resolves.toBeUndefined();
  });
});
