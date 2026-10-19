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

function harness(existingGovernance: Record<string, unknown> = {}) {
  const setGovernance = vi.fn<SetGovernance>(async () => ({}));
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
      runs: { list: async () => [], get: async () => undefined },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;

  const tool = makeGenomeBootstrap({
    crawl: async () => ({ pages: PAGES, kit: KIT, failure: undefined, reason: undefined }),
    infer: { async infer() { return INFERRED; } },
  } as never);

  return { tool, ctx, setGovernance };
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
