import { describe, expect, it, vi } from 'vitest';
import { createHackerNewsTrendSource } from '../../src/sources/hackernews.js';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, statusText: ok ? 'OK' : 'Error', json: async () => body } as Response;
}

function story(over: Partial<{ id: number; title: string; score: number; time: number; url: string; type: string; dead: boolean; deleted: boolean; descendants: number }> = {}) {
  return {
    id: 1, type: 'story', title: 'A real story', score: 100, time: Date.now() / 1000 - 3600, url: 'https://example.com/a', descendants: 20,
    ...over,
  };
}

describe('createHackerNewsTrendSource', () => {
  it('fetches top story ids then maps each item to a trend, no auth required', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('topstories')) return jsonResponse([1, 2]);
      if (u.includes('item/1')) return jsonResponse(story({ id: 1, title: 'First' }));
      if (u.includes('item/2')) return jsonResponse(story({ id: 2, title: 'Second' }));
      throw new Error('unexpected url ' + u);
    });
    const source = createHackerNewsTrendSource({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await source.fetch({ limit: 10 });
    expect(out.map((t) => t.topic).sort()).toEqual(['First', 'Second']);
    expect(out[0]!.source).toBe('hackernews');
  });

  it('filters out non-story items, dead, and deleted posts', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('topstories')) return jsonResponse([1, 2, 3]);
      if (u.includes('item/1')) return jsonResponse(story({ id: 1, type: 'job' }));
      if (u.includes('item/2')) return jsonResponse(story({ id: 2, dead: true }));
      if (u.includes('item/3')) return jsonResponse(story({ id: 3, title: 'Survives' }));
      throw new Error('unexpected');
    });
    const source = createHackerNewsTrendSource({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await source.fetch({ limit: 10 });
    expect(out.map((t) => t.topic)).toEqual(['Survives']);
  });

  it('one bad item does not take down the rest of the batch', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('topstories')) return jsonResponse([1, 2]);
      if (u.includes('item/1')) return jsonResponse({}, false, 500);
      if (u.includes('item/2')) return jsonResponse(story({ id: 2, title: 'Fine' }));
      throw new Error('unexpected');
    });
    const source = createHackerNewsTrendSource({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await source.fetch({ limit: 10 });
    expect(out.map((t) => t.topic)).toEqual(['Fine']);
  });

  it('tags "Ask HN"-style posts (no url) distinctly', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('topstories')) return jsonResponse([1]);
      return jsonResponse(story({ id: 1, url: undefined, title: 'Ask HN: something' }));
    });
    const source = createHackerNewsTrendSource({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await source.fetch({ limit: 10 });
    expect(out[0]!.tags).toEqual(['ask_hn']);
    expect(out[0]!.samples[0]!.url).toContain('news.ycombinator.com');
  });
});
