import { describe, expect, it } from 'vitest';
import { GOLDEN_SET } from '@sparksocial/playbooks';
import { createStubTrendSource } from '@sparksocial/trends';
import { runRecipe, type RecipeRunContext } from '../src/runners.js';

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
    expect(result.outputs).toEqual([{ title: 'New drop', intent: 'New from the feed: "New drop"', sourceUrl: 'https://example.com/a' }]);
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
    expect(result.outputs).toEqual([
      { title: 'Spring sale', intent: 'From the imported sheet: "Spring sale"' },
      { title: 'Summer sale', intent: 'From the imported sheet: "Summer sale"' },
    ]);
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
      expect(result.outputs).toEqual([
        { title: 'Spring promo.mp4', intent: 'From the connected Drive folder: "Spring promo.mp4"', sourceUrl: 'https://drive.google.com/file/d/f1/view' },
        { title: 'No link file', intent: 'From the connected Drive folder: "No link file"', sourceUrl: 'https://drive.google.com/file/d/f2/view' },
      ]);
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
      expect(result.outputs).toEqual([
        { title: 'Promo carousel', intent: 'From the connected Canva folder: "Promo carousel"', sourceUrl: 'https://canva.com/design/d1/view' },
      ]);
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
