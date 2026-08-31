import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';

/**
 * `brand.logo.generate` — the Brand Kits screen's "Generate logo".
 *
 * ── What this is and is not ───────────────────────────────────────────────
 *
 * It is a placeholder mark for a brand that has none, so the renderers have
 * something to put in the corner and the brand kit stops being 20% complete
 * forever. It is **not** brand identity work, and the tool says so in its own
 * summary rather than letting the button imply otherwise — a generated wordmark
 * is a stand-in, and a brand that has a real logo should upload it.
 *
 * That distinction is the reason this writes to `logo_url` and nothing else. It
 * does not touch the palette, the fonts, or anything else a designer would
 * decide; it fills one field that was blocking two renderers.
 *
 * ── Why the prompt is narrow ──────────────────────────────────────────────
 *
 * Flat, single-colour, no text. Three reasons, all practical: an image model
 * cannot reliably render a word (the letters come out almost-right, which is
 * worse for a logo than for anything else), the mark is drawn at 12% of frame
 * width where detail disappears, and a transparent-looking flat shape composites
 * over arbitrary footage while a photographic one does not.
 *
 * The brand's own words ground it — name, category, one-liner — so the result is
 * about this business rather than a generic icon. The name is passed as *subject
 * matter*, not as text to draw.
 */

/** Injected, matching every other vendor seam in the codebase. Same shape as `generate`'s own `ImageClient`. */
export interface LogoImageClient {
  generate(args: { prompt: string; aspectRatio: string }): Promise<{ url: string }>;
}

export const BrandLogoGenerateInput = z.object({
  /** Omit to use the session's brand. Named explicitly by the agency portal. */
  brandId: z.string().min(1).optional(),
  /**
   * A steer, when the owner has one — "something to do with tools", "a leaf".
   * Optional because the brand's own genome is usually a better prompt than a
   * sentence somebody types under pressure.
   */
  hint: z.string().max(200).optional(),
});

export const BrandLogoGenerateOutput = z.object({
  brandId: z.string(),
  logoUrl: z.string(),
  why: Explanation,
});

export function makeBrandLogoGenerate(images: LogoImageClient) {
  return defineTool({
    name: 'brand.logo.generate',
    version: 1,

    summary:
      'Generate a simple placeholder logo mark for a brand that has none, and set it as the brand logo. ' +
      'A stand-in, not identity work — upload a real logo if you have one. Spends real money.',

    input: BrandLogoGenerateInput,
    output: BrandLogoGenerateOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin'],
    /**
     * `false`. Each call is a new mark, which is the point — "try again" is the
     * only sensible response to a logo you do not like, and an idempotent replay
     * would return the one you just rejected.
     */
    idempotent: false,
    surfaces: ['SET-WS-BRAND-KITS'],
    /** PRD §6's media-approval permission applies: this spends money on an image. */
    producesMedia: true,
    estimateCents: () => 4,

    async handler(input, ctx) {
      const brandId = input.brandId ?? ctx.brandId;
      if (!brandId) {
        throw new ToolError('INVALID_INPUT', 'No brand selected.', {});
      }

      const genome = ctx.genomeId ? await ctx.db.genomes.get(ctx.genomeId, ctx.orgId) : undefined;
      const name = genome?.identity.business_name ?? 'the business';
      const category = genome?.identity.category ?? '';
      const oneLiner = genome?.identity.one_liner ?? '';

      /**
       * `1:1`, because a logo is placed as a square mark by both renderers and a
       * non-square one would be letterboxed into the same box with less of it
       * visible.
       */
      const prompt = [
        'A single flat vector logo mark on a plain white background.',
        'Simple geometric shape, one solid colour, thick strokes, high contrast, centred, generous margin.',
        'No text, no letters, no words, no typography.',
        `The business: ${name}${category ? `, a ${category}` : ''}.`,
        oneLiner ? `What they do: ${oneLiner}.` : '',
        input.hint ? `The owner suggests: ${input.hint}.` : '',
        'It must stay recognisable at very small sizes.',
      ]
        .filter(Boolean)
        .join(' ');

      const { url } = await images.generate({ prompt, aspectRatio: '1:1' });

      const after = await ctx.db.brands.setGovernance({
        brandId,
        orgId: ctx.orgId,
        patch: { logoUrl: url },
      });

      const why: Explanation = {
        summary: `Generated a placeholder mark for ${name}. Replace it with a real logo when you have one.`,
        factors: [
          { label: 'grounded in', detail: [name, category].filter(Boolean).join(', ') },
          ...(input.hint ? [{ label: 'your steer', detail: input.hint }] : []),
          // Stated because it is the constraint most likely to surprise: people
          // expect a logo to carry the name.
          { label: 'no lettering', detail: 'Image models cannot render words reliably at logo sizes.' },
        ],
        evidence: [],
        alternatives: [],
      };

      ctx.logger.info('brand logo generated', { brandId, by: ctx.userId ?? 'unknown' });
      return { brandId: after?.brandId ?? brandId, logoUrl: url, why };
    },
  });
}
