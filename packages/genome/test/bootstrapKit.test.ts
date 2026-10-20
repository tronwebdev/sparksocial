import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools';
import { makeGenomeBootstrap } from '../src/bootstrap.js';

/**
 * The brand kit a crawl proposes, and the one it must not overwrite.
 *
 * `genome.bootstrap_from_url` now writes the site's palette, fonts and logo
 * onto brand governance. The hazard that creates is re-crawling: the Brand
 * Details step lets an owner pick a palette by hand two screens earlier, and a
 * second crawl silently repainting it would undo a decision they watched
 * themselves make.
 */

const PAGES = [{ url: 'https://x.test/', title: 'Home', text: 'We build wheels by hand.' }];

const INFERRED = {
  identity: {
    businessName: 'Rowan & Vale',
    category: 'trades',
    oneLiner: 'An independent bicycle workshop.',
    geography: { scope: 'local' as const, locale: 'en-GB', radiusKm: 10 },
    languages: ['en'],
    priceTier: 'mid' as const,
  },
  dimensions: { objective: 'bookings' as const },
  voice: {},
  chips: [],
  unresolved: [],
  factors: [],
  alternatives: [],
};

const KIT = {
  colors: ['#146b33', '#d9edf2'],
  fonts: { display: 'Schibsted Grotesk', body: 'IBM Plex Sans' },
  logoUrl: 'https://x.test/assets/logo-dark.svg',
};

/**
 * The governance write, typed explicitly.
 *
 * `vi.fn(async () => ({}))` infers a *zero-argument* mock, so `mock.calls[0]`
 * is the empty tuple and reading `[0]` off it is a type error — the same trap
 * `packages/agency/test/logo.test.ts` documents having fallen into, and it
 * passes at runtime either way.
 */
type SetGovernance = (args: { brandId: string; orgId: string; patch: Record<string, unknown> }) => Promise<unknown>;

/** `ensureBrandKitAsset`'s two reads, typed for the same reason as above. */
type CreateAsset = (args: Record<string, unknown>) => Promise<{ id: string }>;

function harness(
  existingGovernance: Record<string, unknown> = {},
  opts: {
    heldBrandKit?: number;
    heldKnowledge?: unknown[];
    embed?: (t: string) => Promise<number[]>;
  } = {},
) {
  const setGovernance = vi.fn<SetGovernance>(async () => ({}));
  const createAsset = vi.fn<CreateAsset>(async () => ({ id: 'asset_1' }));
  const attachKnowledge = vi.fn<(args: Record<string, unknown>) => Promise<{ id: string; docId: string }>>(
    async (args) => ({ id: 'kc_1', docId: String(args['docId']) }),
  );
  const ctx = {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: {
        createDraft: async () => ({ id: 'gen_new' }),
        patchIdentity: async () => ({ id: 'g', version: 2 }),
        patchDimensions: async () => ({ id: 'g', version: 3 }),
        mergeDimensions: async () => ({ id: 'g', version: 3 }),
        patchVoice: async () => ({ id: 'g', version: 4 }),
        patchConstraints: async () => ({ id: 'g', version: 1 }),
        get: async () => undefined,
        listForOrg: async () => [],
      },
      brands: {
        get: async (brandId: string) => ({ brandId, name: 'Rowan', ...existingGovernance }),
        setGovernance,
      },
      assets: {
        inventory: async () => ({ brand_kit: opts.heldBrandKit ?? 0 }),
        create: createAsset,
      },
      knowledge: {
        listAll: async () => opts.heldKnowledge ?? [],
        attach: attachKnowledge,
      },
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;

  const tool = makeGenomeBootstrap({
    crawl: async () => ({ pages: PAGES, kit: KIT, failure: undefined, reason: undefined }),
    infer: { async infer() { return INFERRED; } },
    ...(opts.embed ? { embed: opts.embed } : {}),
  } as never);

  return { tool, ctx, setGovernance, createAsset, attachKnowledge };
}

const input = { url: 'https://x.test/', brandId: 'brand_1', maxPages: 5 };

describe('the crawl proposes a brand kit', () => {
  it('returns it, so the step can say the preset came from the URL', async () => {
    const { tool, ctx } = harness();
    const out = await tool.handler(input, ctx);
    expect(out.kit).toEqual(KIT);
  });

  it('writes it onto governance when the brand has none', async () => {
    const { tool, ctx, setGovernance } = harness();
    await tool.handler(input, ctx);

    expect(setGovernance).toHaveBeenCalledWith(
      expect.objectContaining({
        brandId: 'brand_1',
        patch: { brandColors: KIT.colors, logoUrl: KIT.logoUrl, brandFonts: KIT.fonts },
      }),
    );
  });
});

describe('it does not overwrite a human', () => {
  it('leaves a palette the owner already chose', async () => {
    const { tool, ctx, setGovernance } = harness({ brandColors: ['#ff0000'] });
    await tool.handler(input, ctx);

    const patch = setGovernance.mock.calls[0]?.[0];
    expect(patch?.patch).not.toHaveProperty('brandColors');
    // The fields they had not set are still filled in.
    expect(patch?.patch).toHaveProperty('logoUrl');
  });

  it('leaves a logo they uploaded', async () => {
    const { tool, ctx, setGovernance } = harness({ logoUrl: 'https://theirs.test/logo.png' });
    await tool.handler(input, ctx);

    const patch = setGovernance.mock.calls[0]?.[0];
    expect(patch?.patch).not.toHaveProperty('logoUrl');
  });

  it('writes nothing at all when every field is already theirs', async () => {
    const { tool, ctx, setGovernance } = harness({
      brandColors: ['#ff0000'],
      logoUrl: 'https://theirs.test/logo.png',
      brandFonts: { display: 'Theirs' },
    });
    await tool.handler(input, ctx);

    expect(setGovernance).not.toHaveBeenCalled();
  });
});

/**
 * THE CRAWLED LOGO IS ALSO THE BRAND'S `brand_kit` ASSET.
 *
 * Seven playbooks list `brand_kit` in `required_asset_roles`, and
 * `resolver.ts` gates on `(assets[role] ?? 0) < Math.max(1, min_assets)` — so a
 * required role needs at least one *asset* even where `min_assets` is 0.
 * Governance fields are not assets and do not count.
 *
 * Writing `logoUrl` and stopping is therefore how a successful crawl produced a
 * brand that could build nothing. Measured on the deployed build against a real
 * jewellery retailer: the crawl found a logo, a palette and a typeface,
 * `asset.list` returned `count: 0`, and the calendar reported "13 posts are
 * planned, and none of them can be built yet" with "brand kit — 7 of 14
 * resolvable posts" filed under *files you probably already have*.
 *
 * `brand.governance.set` already did this, but only `if (patch.logoUrl)` —
 * false here, because the crawl writes governance through the repository
 * directly, and false again on the Brand Kit step's save, which sends colours
 * and fonts and never re-sends a `logoUrl` that is already set.
 */
describe('the crawled logo becomes the brand_kit asset', () => {
  it('creates one, with the role and rights the resolver actually counts', async () => {
    const { tool, ctx, createAsset } = harness();
    await tool.handler(input, ctx);

    expect(createAsset).toHaveBeenCalledTimes(1);
    const asset = createAsset.mock.calls[0]?.[0];

    expect(asset).toMatchObject({
      genomeId: 'gen_new',
      url: KIT.logoUrl,
      assetRole: 'brand_kit',
      mediaType: 'image',
      // `assetInventory` counts only `cleared`, so `pending` would leave the
      // brand building nothing one layer further down.
      rightsStatus: 'cleared',
      source: 'genome.bootstrap_from_url',
    });
  });

  /*
   * The palette half of the fix. For a crawled brand this one row *is* the
   * brand kit — nothing else carries the colours into the Assets Library, and
   * the caption is what gets embedded, so a bare "<name> logo" is both the
   * library's only description of the brand's identity and the only thing a
   * search can match on.
   */
  it('carries the palette and typeface in its caption', async () => {
    const { tool, ctx, createAsset } = harness();
    await tool.handler(input, ctx);

    const caption = createAsset.mock.calls[0]?.[0]?.['caption'];
    expect(caption).toContain('Rowan & Vale logo');
    expect(caption).toContain('#146b33');
    expect(caption).toContain('#d9edf2');
    expect(caption).toContain('Schibsted Grotesk');
    expect(caption).toContain('IBM Plex Sans');
  });

  it('embeds that caption, so the mark is findable rather than merely counted', async () => {
    const embed = vi.fn(async () => [0.1, 0.2]);
    const { tool, ctx, createAsset } = harness({}, { embed });
    await tool.handler(input, ctx);

    expect(embed).toHaveBeenCalledWith(expect.stringContaining('#146b33'));
    expect(createAsset.mock.calls[0]?.[0]?.['embedding']).toEqual([0.1, 0.2]);
  });

  it('writes no asset when the logo was already theirs', async () => {
    // Nothing was patched, so this call did not set the logo — whatever did
    // registered its own asset.
    const { tool, ctx, createAsset } = harness({ logoUrl: 'https://theirs.test/logo.png' });
    await tool.handler(input, ctx);

    expect(createAsset).not.toHaveBeenCalled();
  });

  it('writes no second one when the brand already holds a brand_kit asset', async () => {
    const { tool, ctx, createAsset } = harness({}, { heldBrandKit: 1 });
    await tool.handler(input, ctx);

    expect(createAsset).not.toHaveBeenCalled();
  });

  /*
   * Bookkeeping must not fail the crawl. A brand missing the asset row builds
   * nothing until something else writes one; a brand whose entire onboarding
   * crawl was discarded because an embedding call failed recovers less well.
   */
  it('still returns the genome when the asset write fails', async () => {
    const { tool, ctx, createAsset } = harness();
    createAsset.mockRejectedValueOnce(new Error('assets table unavailable'));

    const out = await tool.handler(input, ctx);
    expect(out.draftGenomeId).toBe('gen_new');
    expect(out.identity.businessName).toBe('Rowan & Vale');
  });
});

/**
 * THE CRAWL'S PAGES ARE STORED, not read and thrown away.
 *
 * `bootstrapOutput` reports them as evidence of kind `knowledge_chunk` with
 * their URLs as ids, and nothing wrote them. Measured on the deployed build
 * against a brand crawled minutes earlier: `knowledge.list` returned
 * `docs: []`, `totalChunks: 0` for a genome whose own `why` named five pages it
 * had read, and the campaign step said "0 source documents".
 */
describe('the crawl stores what it read', () => {
  const embed = async () => [0.1, 0.2];

  it('attaches a chunk per page, keyed by url and labelled by title', async () => {
    const { tool, ctx, attachKnowledge } = harness({}, { embed });
    await tool.handler(input, ctx);

    expect(attachKnowledge).toHaveBeenCalledTimes(PAGES.length);
    expect(attachKnowledge.mock.calls[0]?.[0]).toMatchObject({
      genomeId: 'gen_new',
      docId: PAGES[0]!.url,
      text: PAGES[0]!.text,
      citation: { label: PAGES[0]!.title, url: PAGES[0]!.url },
    });
  });

  it('registers one knowledge asset for the site, not one per page', async () => {
    const { tool, ctx, createAsset } = harness({}, { embed });
    await tool.handler(input, ctx);

    const knowledgeAssets = createAsset.mock.calls.filter((c) => c[0]?.['assetRole'] === 'knowledge');
    expect(knowledgeAssets).toHaveLength(1);
    expect(knowledgeAssets[0]?.[0]).toMatchObject({ assetRole: 'knowledge', mediaType: 'document' });
  });

  /*
   * `attach` appends. Without the guard a re-crawl stacks a second copy of
   * every page on the first and quietly doubles the corpus — and an owner who
   * attached their own documents would get five pages of marketing copy pushed
   * in beside them.
   */
  it('writes nothing when the genome already has knowledge', async () => {
    const { tool, ctx, attachKnowledge } = harness({}, { embed, heldKnowledge: [{ id: 'kc_existing' }] });
    await tool.handler(input, ctx);

    expect(attachKnowledge).not.toHaveBeenCalled();
  });

  /*
   * A chunk exists to be retrieved, and retrieval ranks by similarity. Zero
   * vectors would fill the corpus with chunks that match no query ever — worse
   * than an empty corpus, because it looks full.
   */
  it('stores nothing rather than zero vectors when there is no embedder', async () => {
    const { tool, ctx, attachKnowledge } = harness();
    await tool.handler(input, ctx);

    expect(attachKnowledge).not.toHaveBeenCalled();
  });

  it('still returns the genome when the knowledge write fails', async () => {
    const { tool, ctx, attachKnowledge } = harness({}, { embed });
    attachKnowledge.mockRejectedValueOnce(new Error('knowledge_chunks unavailable'));

    const out = await tool.handler(input, ctx);
    expect(out.draftGenomeId).toBe('gen_new');
    expect(out.identity.businessName).toBe('Rowan & Vale');
  });
});

describe('a palette is a bonus; the genome is the promise', () => {
  it('still returns the genome when the governance write fails', async () => {
    const { tool, ctx } = harness();
    (ctx.db as unknown as { brands: { setGovernance: unknown } }).brands.setGovernance = async () => {
      throw new Error('governance is down');
    };

    const out = await tool.handler(input, ctx);
    expect(out.draftGenomeId).toBe('gen_new');
  });

  it('does nothing when the crawl could not read a kit', async () => {
    const setGovernance = vi.fn<SetGovernance>(async () => ({}));
    const { ctx } = harness();
    (ctx.db as unknown as { brands: { setGovernance: unknown } }).brands.setGovernance = setGovernance;

    const tool = makeGenomeBootstrap({
      crawl: async () => ({ pages: PAGES, failure: undefined, reason: undefined }),
      infer: { async infer() { return INFERRED; } },
    } as never);

    const out = await tool.handler(input, ctx);
    expect(out.kit).toBeUndefined();
    expect(setGovernance).not.toHaveBeenCalled();
  });
});
