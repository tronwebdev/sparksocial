import { describe, expect, it, vi } from 'vitest';
import { createYouTubeTrendSource } from '../../src/sources/youtube.js';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, statusText: ok ? 'OK' : 'Error', json: async () => body } as Response;
}

describe('createYouTubeTrendSource', () => {
  it('maps the mostPopular chart into trends', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            id: 'vid1',
            snippet: { title: 'A trending video', tags: ['a', 'b'], publishedAt: new Date(Date.now() - 3_600_000).toISOString() },
            statistics: { viewCount: '50000', likeCount: '2000' },
          },
        ],
      }),
    );
    const source = createYouTubeTrendSource({ apiKey: 'key', fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await source.fetch({ limit: 10 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'vid1', source: 'youtube', topic: 'A trending video', tags: ['a', 'b'] });
    expect(out[0]!.metrics.volume).toBe(50000);
    expect(out[0]!.samples[0]!.url).toBe('https://youtube.com/watch?v=vid1');
  });

  it('clamps maxResults at the API\'s real ceiling of 50', async () => {
    let requestedUrl = '';
    const fetchImpl = vi.fn(async (url: string | URL) => {
      requestedUrl = String(url);
      return jsonResponse({ items: [] });
    });
    const source = createYouTubeTrendSource({ apiKey: 'key', fetchImpl: fetchImpl as unknown as typeof fetch });
    await source.fetch({ limit: 200 });
    expect(requestedUrl).toContain('maxResults=50');
  });

  it('throws on a non-ok response — the composite source is what catches it, not this one', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 403));
    const source = createYouTubeTrendSource({ apiKey: 'key', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(source.fetch({ limit: 10 })).rejects.toThrow(/403/);
  });

  it('falls back to a category tag when the video has no tags', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            id: 'vid2',
            snippet: { title: 'No tags here', categoryId: '28', publishedAt: new Date().toISOString() },
            statistics: { viewCount: '100' },
          },
        ],
      }),
    );
    const source = createYouTubeTrendSource({ apiKey: 'key', fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await source.fetch({ limit: 10 });
    expect(out[0]!.tags).toEqual(['category_28']);
  });
});
