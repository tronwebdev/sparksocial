import { describe, expect, it } from 'vitest';
import { GOLDEN_SET } from '@sparksocial/playbooks';
import { createStubTrendSource } from '@sparksocial/trends';
import { outputKeys, runRecipe, type RecipeRunContext } from '../src/runners.js';

const barber = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_barber')!.genome;
const trendSource = createStubTrendSource();

function ctx(over: Partial<RecipeRunContext> = {}): RecipeRunContext {
  return {
    genome: barber,
    assets: {},
    trendSource,
    fetchText: async () => {
      throw new Error('fetchText not stubbed in this test');
    },
    ...over,
  };
}

describe('runRecipe — auto_trend', () => {
  it('proposes output for trends that clear the score floor and have a repurpose suggestion', async () => {
    const result = await runRecipe('auto_trend', { minScore: 0.1, maxOutputs: 5 }, ctx());
    expect(result.error).toBeUndefined();
    expect(result.outputs.length).toBeGreaterThan(0);
    expect(result.outputs[0]).toMatchObject({ title: expect.any(String), intent: expect.any(String) });
    // The trend's id, not its title — `content_items.source_trend_id` joins on it.
    expect(result.outputs[0]!.trendId).toEqual(expect.any(String));
    expect(result.outputs[0]!.trendId).not.toBe(result.outputs[0]!.title);
  });

  it('skips trends this recipe already proposed and takes the next ones', async () => {
    // The stub has two trends this genome finds relevant: one per run, then none.
    const first = await runRecipe('auto_trend', { minScore: 0, maxOutputs: 1 }, ctx());
    const seen = new Set(first.outputs.flatMap(outputKeys));
    const second = await runRecipe('auto_trend', { minScore: 0, maxOutputs: 1 }, ctx({ seen }));
    expect(second.outputs).toHaveLength(1);
    expect(second.outputs[0]!.trendId).not.toBe(first.outputs[0]!.trendId);

    for (const k of second.outputs.flatMap(outputKeys)) seen.add(k);
    const third = await runRecipe('auto_trend', { minScore: 0, maxOutputs: 1 }, ctx({ seen }));
    // Not an error: everything that qualifies has already been proposed.
    expect(third).toEqual({ outputs: [] });
  });

  it('applies the post-age filter to dated trends and keeps undated ones', async () => {
    const now = Date.now();
    /* Clones of a trend the barber genome already finds relevant, differing only in age. */
    const [relevant] = (await trendSource.fetch({ limit: 20 })).filter((t) => t.id === 'tr_rising');
    const dated = (id: string, hoursAgo?: number) => ({
      ...relevant!,
      id,
      topic: `${relevant!.topic} ${id}`,
      ...(hoursAgo !== undefined ? { startedAt: new Date(now - hoursAgo * 3_600_000).toISOString() } : {}),
    });
    const source = { name: 'stub', keywordSupport: 'filter' as const, fetch: async () => [dated('new', 2), dated('old', 200), dated('undated')] };
    const result = await runRecipe('auto_trend', { minScore: 0, maxOutputs: 5, maxAgeHours: 48 }, ctx({ trendSource: source as never }));
    expect(result.outputs.map((o) => o.trendId).sort()).toEqual(['new', 'undated']);
  });

  it('produces nothing when the score floor is unreachable', async () => {
    const result = await runRecipe('auto_trend', { minScore: 0.99, maxOutputs: 5 }, ctx());
    expect(result.outputs).toEqual([]);
  });

  it('reports an error for an invalid config instead of throwing', async () => {
    const result = await runRecipe('auto_trend', { minScore: 5 }, ctx());
    expect(result.outputs).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});

describe('runRecipe — rss', () => {
  const feed = `<rss><channel><item><title>New drop</title><link>https://example.com/a</link></item></channel></rss>`;

  it('parses a fetched feed into proposed output', async () => {
    const result = await runRecipe('rss', { feedUrl: 'https://example.com/feed.xml' }, ctx({ fetchText: async () => feed }));
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]).toMatchObject({ title: 'New drop', sourceUrl: 'https://example.com/a' });
    expect(result.outputs[0]!.intent).toMatch(/^New from the feed: "New drop"/);
  });

  it('picks a format for every feed item, so it can be approved or scheduled', async () => {
    // Only `auto_trend` used to pick one, so feed items reached the queue with
    // nothing to draft from and could never become posts.
    const result = await runRecipe('rss', { feedUrl: 'https://example.com/feed.xml' }, ctx({ fetchText: async () => feed }));
    expect(result.outputs[0]!.playbookId).toEqual(expect.any(String));
    expect(result.outputs[0]!.intent).toContain(result.outputs[0]!.playbookName!.toLowerCase());
  });

  it('skips items it already produced and fills the run from the next ones', async () => {
    const three = `<rss><channel>${['a', 'b', 'c']
      .map((x) => `<item><title>Story ${x}</title><link>https://example.com/${x}</link></item>`)
      .join('')}</channel></rss>`;
    const seen = new Set(outputKeys({ title: 'Story a', sourceUrl: 'https://example.com/a' }));
    const result = await runRecipe(
      'rss',
      { feedUrl: 'https://example.com/feed.xml', maxItems: 2 },
      ctx({ fetchText: async () => three, seen }),
    );
    expect(result.outputs.map((o) => o.title)).toEqual(['Story b', 'Story c']);
  });

  it('refuses a private/unsafe feed URL rather than fetching it', async () => {
    const result = await runRecipe('rss', { feedUrl: 'http://169.254.169.254/feed.xml' }, ctx());
    expect(result.outputs).toEqual([]);
    expect(result.error).toMatch(/refused/i);
  });

  it('surfaces a fetch failure as a run error, not a throw', async () => {
    const result = await runRecipe(
      'rss',
      { feedUrl: 'https://example.com/feed.xml' },
      ctx({
        fetchText: async () => {
          throw new Error('502 Bad Gateway');
        },
      }),
    );
    expect(result.outputs).toEqual([]);
    expect(result.error).toMatch(/502/);
  });
});

describe('runRecipe — bulk_connector', () => {
  it('parses inline CSV text into proposed output', async () => {
    const result = await runRecipe(
      'bulk_connector',
      { source: 'csv', csvText: 'topic\nSpring sale\nSummer sale\n' },
      ctx(),
    );
    expect(result.outputs.map((o) => o.title)).toEqual(['Spring sale', 'Summer sale']);
    expect(result.outputs[0]!.intent).toMatch(/^From the imported sheet: "Spring sale"/);
    expect(result.outputs.every((o) => o.playbookId)).toBe(true);
  });

  it('works through a sheet a batch per run instead of re-proposing every row', async () => {
    const csvText = ['title', 'One', 'Two', 'Three', 'Four', 'Five', ''].join('\n');
    const first = await runRecipe('bulk_connector', { source: 'csv', csvText, perRun: 2 }, ctx());
    expect(first.outputs.map((o) => o.title)).toEqual(['One', 'Two']);
    const seen = new Set(first.outputs.flatMap(outputKeys));
    const second = await runRecipe('bulk_connector', { source: 'csv', csvText, perRun: 2 }, ctx({ seen }));
    expect(second.outputs.map((o) => o.title)).toEqual(['Three', 'Four']);
  });

  it('reports folder as unbuildable in a hosted app rather than fabricating output', async () => {
    const result = await runRecipe('bulk_connector', { source: 'folder' }, ctx());
    expect(result.outputs).toEqual([]);
    expect(result.error).toMatch(/not a connectable source/i);
  });

  describe('drive source', () => {
    it('reports not connected when GOOGLE_DRIVE_API_KEY is unconfigured', async () => {
      const result = await runRecipe('bulk_connector', { source: 'drive', driveFolderId: 'abc123' }, ctx());
      expect(result.outputs).toEqual([]);
      expect(result.error).toMatch(/not connected/i);
    });

    it('requires a driveFolderId even when a key is configured', async () => {
      const result = await runRecipe('bulk_connector', { source: 'drive' }, ctx({ driveApiKey: 'key123' }));
      expect(result.outputs).toEqual([]);
      expect(result.error).toMatch(/driveFolderId is required/i);
    });

    it('lists a public Drive folder into proposed output', async () => {
      const body = JSON.stringify({
        files: [
          { id: 'f1', name: 'Spring promo.mp4', mimeType: 'video/mp4', webViewLink: 'https://drive.google.com/file/d/f1/view' },
          { id: 'f2', name: 'No link file', mimeType: 'image/png' },
        ],
      });
      const result = await runRecipe(
        'bulk_connector',
        { source: 'drive', driveFolderId: 'abc123' },
        ctx({ driveApiKey: 'key123', fetchText: async (url) => (url.includes('googleapis.com') ? body : (() => { throw new Error('unexpected url'); })()) }),
      );
      expect(result.outputs).toMatchObject([
        { title: 'Spring promo.mp4', sourceUrl: 'https://drive.google.com/file/d/f1/view' },
        { title: 'No link file', sourceUrl: 'https://drive.google.com/file/d/f2/view' },
      ]);
      expect(result.outputs[0]!.intent).toMatch(/^From the connected Drive folder: "Spring promo.mp4"/);
    });

    it('surfaces a Drive fetch failure as a run error, not a throw', async () => {
      const result = await runRecipe(
        'bulk_connector',
        { source: 'drive', driveFolderId: 'abc123' },
        ctx({
          driveApiKey: 'key123',
          fetchText: async () => {
            throw new Error('404 Not Found');
          },
        }),
      );
      expect(result.outputs).toEqual([]);
      expect(result.error).toMatch(/404/);
    });
  });

  describe('canva source', () => {
    it('reports not connected when no OAuth integration is wired into the run context', async () => {
      const result = await runRecipe('bulk_connector', { source: 'canva', canvaFolderId: 'f1' }, ctx());
      expect(result.outputs).toEqual([]);
      expect(result.error).toMatch(/not connected/i);
    });

    it('reports not connected when the brand has never connected Canva', async () => {
      const result = await runRecipe(
        'bulk_connector',
        { source: 'canva', canvaFolderId: 'f1' },
        ctx({ getOAuthAccessToken: async () => undefined, fetchWithAuth: async () => '{}' }),
      );
      expect(result.outputs).toEqual([]);
      expect(result.error).toMatch(/not connected for this brand/i);
    });

    it('lists designs from a connected Canva folder into proposed output', async () => {
      const body = JSON.stringify({
        items: [{ design: { id: 'd1', title: 'Promo carousel', urls: { view_url: 'https://canva.com/design/d1/view' } } }],
      });
      const result = await runRecipe(
        'bulk_connector',
        { source: 'canva', canvaFolderId: 'f1' },
        ctx({
          getOAuthAccessToken: async (provider) => (provider === 'canva' ? 'tok_abc' : undefined),
          fetchWithAuth: async (url, token) => {
            expect(url).toContain('api.canva.com/rest/v1/folders/f1/items');
            expect(token).toBe('tok_abc');
            return body;
          },
        }),
      );
      expect(result.outputs).toMatchObject([{ title: 'Promo carousel', sourceUrl: 'https://canva.com/design/d1/view' }]);
      expect(result.outputs[0]!.intent).toMatch(/^From the connected Canva folder: "Promo carousel"/);
    });

    it('surfaces a Canva fetch failure as a run error, not a throw', async () => {
      const result = await runRecipe(
        'bulk_connector',
        { source: 'canva', canvaFolderId: 'f1' },
        ctx({
          getOAuthAccessToken: async () => 'tok_abc',
          fetchWithAuth: async () => {
            throw new Error('403 Forbidden');
          },
        }),
      );
      expect(result.outputs).toEqual([]);
      expect(result.error).toMatch(/403/);
    });
  });
});

describe('runRecipe — unknown kind', () => {
  it('reports an error rather than throwing', async () => {
    const result = await runRecipe('made_up_kind', {}, ctx());
    expect(result.outputs).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});
