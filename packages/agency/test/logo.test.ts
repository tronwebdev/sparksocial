import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools';
import { GOLDEN_SET } from '@sparksocial/playbooks';
import { makeBrandLogoGenerate } from '../src/logo.js';

/**
 * `brand.logo.generate` — the Brand Kits screen's "Generate logo".
 *
 * A placeholder mark, not identity work. The tests that matter are about the
 * prompt's constraints, because an image model given a free hand produces
 * something unusable at 12% of frame width — and about it being honest that this
 * is a stand-in.
 */

const genome = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_saas')!.genome;

function ctx(
  over: { setGovernance?: unknown; inventory?: Record<string, number>; createAsset?: unknown } = {},
): ToolCtx {
  return {
    orgId: 'org_1',
    brandId: 'brand_1',
    genomeId: 'gen_saas',
    userId: 'user_owner',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      genomes: { get: async () => genome },
      brands: {
        setGovernance: over.setGovernance ?? (async () => ({ brandId: 'brand_1' })),
      },
      // The logo is also the brand's `brand_kit` asset as of
      // `ensureBrandKitAsset`, so the tool now reads and writes this store.
      assets: {
        inventory: async () => over.inventory ?? {},
        create: over.createAsset ?? (async () => ({ id: 'asset_1' })),
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

interface GenArgs {
  prompt: string;
  aspectRatio: string;
}

/**
 * Typed explicitly. `vi.fn(async () => …)` infers a zero-argument mock, so
 * `mock.calls[0]` is the empty tuple and every `calls[0]![0].prompt` below is a
 * type error — which is exactly what slipped through when this file was written,
 * because the tests pass at runtime either way.
 */
function images() {
  return { generate: vi.fn<(args: GenArgs) => Promise<{ url: string }>>(async () => ({ url: 'https://fal.example/logo.png' })) };
}

describe('brand.logo.generate — the prompt', () => {
  it('forbids lettering, three times over', async () => {
    /**
     * The single most important constraint. An image model cannot reliably render
     * a word, and the letters come out almost-right — which is worse for a logo
     * than for anything else, because a wrong letter in a wordmark reads as a
     * typo rather than as art.
     */
    const img = images();
    await makeBrandLogoGenerate(img).handler({}, ctx());
    const prompt = img.generate.mock.calls[0]![0].prompt;
    expect(prompt).toContain('No text, no letters, no words, no typography.');
  });

  it('asks for a flat single-colour shape, because the mark renders tiny', async () => {
    const img = images();
    await makeBrandLogoGenerate(img).handler({}, ctx());
    const prompt = img.generate.mock.calls[0]![0].prompt;
    expect(prompt).toContain('flat vector logo mark');
    expect(prompt).toContain('one solid colour');
    expect(prompt).toContain('recognisable at very small sizes');
  });

  it('grounds in the brand rather than producing a generic icon', async () => {
    const img = images();
    await makeBrandLogoGenerate(img).handler({}, ctx());
    const prompt = img.generate.mock.calls[0]![0].prompt;
    expect(prompt).toContain(genome.identity.business_name);
    expect(prompt).toContain(genome.identity.one_liner);
  });

  it('passes the name as subject matter, never as text to draw', async () => {
    // Both are true at once and that is the point: the model is told what the
    // business is, and told not to write it.
    const img = images();
    await makeBrandLogoGenerate(img).handler({}, ctx());
    const prompt = img.generate.mock.calls[0]![0].prompt;
    expect(prompt.indexOf('No text')).toBeLessThan(prompt.indexOf(genome.identity.business_name));
  });

  it('includes the owner’s steer when there is one', async () => {
    const img = images();
    await makeBrandLogoGenerate(img).handler({ hint: 'something with a leaf' }, ctx());
    expect(img.generate.mock.calls[0]![0].prompt).toContain('something with a leaf');
  });

  it('requests a square, because both renderers place a square mark', async () => {
    const img = images();
    await makeBrandLogoGenerate(img).handler({}, ctx());
    expect(img.generate.mock.calls[0]![0].aspectRatio).toBe('1:1');
  });
});

describe('brand.logo.generate — the contract', () => {
  it('writes the logo and nothing else', async () => {
    // It fills one field that was blocking two renderers. Touching the palette or
    // the fonts would be making design decisions this tool has no business making.
    const setGovernance = vi.fn(async () => ({ brandId: 'brand_1' }));
    await makeBrandLogoGenerate(images()).handler({}, ctx({ setGovernance }));
    expect(setGovernance).toHaveBeenCalledWith(
      expect.objectContaining({ patch: { logoUrl: 'https://fal.example/logo.png' } }),
    );
  });

  it('is not idempotent — "try again" is the point', () => {
    const tool = makeBrandLogoGenerate(images());
    expect(tool.idempotent).toBe(false);
  });

  it('declares that it produces media, so the approval gate applies', () => {
    const tool = makeBrandLogoGenerate(images());
    expect(tool.producesMedia).toBe(true);
    expect(tool.estimateCents?.({})).toBeGreaterThan(0);
  });

  it('says in its own why that this is a placeholder', async () => {
    // The button could easily read as "make me a logo". The explanation is where
    // that expectation gets corrected.
    const out = await makeBrandLogoGenerate(images()).handler({}, ctx());
    expect(out.why.summary).toMatch(/placeholder/i);
    expect(out.why.factors.some((f) => /lettering/i.test(f.label))).toBe(true);
  });

  it('refuses with no brand rather than guessing one', async () => {
    const noBrand = { ...ctx(), brandId: undefined } as ToolCtx;
    await expect(makeBrandLogoGenerate(images()).handler({}, noBrand)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });
});

/**
 * The logo is the brand's `brand_kit` asset.
 *
 * Seven playbooks gate on that role existing, and generating a logo used to
 * write `logoUrl` onto governance and nothing else — so a brand that had just
 * generated one still resolved zero formats, with "a brand kit file" listed as
 * a blocker beside the logo on screen.
 */
describe('brand.logo.generate — the brand kit asset', () => {
  it('registers the logo as a cleared brand_kit asset', async () => {
    const created: Array<Record<string, unknown>> = [];
    await makeBrandLogoGenerate(images()).handler(
      {},
      ctx({ createAsset: async (a: Record<string, unknown>) => { created.push(a); return { id: 'a1' }; } }),
    );

    expect(created).toHaveLength(1);
    expect(created[0]!.assetRole).toBe('brand_kit');
    // Pending would leave it invisible: `assetInventory` counts only cleared
    // rows, so the brand would still build nothing, one layer further down.
    expect(created[0]!.rightsStatus).toBe('cleared');
  });

  it('does not add a second one when the brand already has one', async () => {
    const created: unknown[] = [];
    await makeBrandLogoGenerate(images()).handler(
      {},
      ctx({ inventory: { brand_kit: 1 }, createAsset: async () => { created.push(1); return { id: 'a1' }; } }),
    );
    expect(created).toHaveLength(0);
  });

  it('still returns the logo when the asset write fails', async () => {
    // The image cost a vendor call and is already saved on the brand. Losing
    // it to a bookkeeping failure would discard the expensive half.
    const out = await makeBrandLogoGenerate(images()).handler(
      {},
      ctx({ createAsset: async () => { throw new Error('db down'); } }),
    );
    expect(out.logoUrl).toBeTruthy();
  });
});
