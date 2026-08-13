import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';

/**
 * `genome.create` — a genome without a website.
 *
 * `genome.bootstrap_from_url` was the only way to make one, which made a
 * crawlable website a hard prerequisite for using the product. Two very
 * ordinary cases could not get past the first screen:
 *
 * 1. **The site blocks us.** Cloudflare and similar sit in front of a large
 *    share of small-business sites and return 403 to anything automated. The
 *    owner has done nothing wrong and can do nothing about it in the moment.
 * 2. **There is no site.** For the Nigerian SMB motion this product is aimed
 *    at (CLAUDE.md § scope), a business is as likely to live on Instagram or
 *    WhatsApp as on a domain. Requiring a URL excludes the core customer.
 *
 * ── What is lost, and why that is acceptable ───────────────────────────────
 *
 * The crawl exists to answer questions so the owner does not have to. Without
 * it every routing dimension is `unresolved`, so onboarding asks all four
 * rather than one or two. That is a longer form, not a worse genome: the
 * answers come from the person who actually knows, instead of being inferred
 * from marketing copy. The inferred path is faster, not more accurate.
 *
 * The draft is deliberately *thin* — a name, a category, a one-liner. It does
 * not invent a voice, an audience or a price tier, because there is no evidence
 * for any of them and a plausible guess is the thing this codebase keeps
 * refusing to make. Those fill in from the answers and from what the brand
 * actually publishes.
 */

export const GenomeCreateInput = z.object({
  brandId: z.string().min(1),
  businessName: z.string().min(1).max(120),
  /**
   * Free text, not an enum. Invariant 5: nothing branches on it — it is display
   * only, and a fixed list would be the first step toward code that does.
   */
  category: z.string().min(1).max(80),
  /** What they do, in their words. Optional: it can be learned later. */
  oneLiner: z.string().max(280).optional(),
  /** BCP-47. Defaults to the locale the browser reported. */
  locale: z.string().min(2).max(12).default('en-US'),
});

export const GenomeCreateOutput = z.object({
  draftGenomeId: z.string(),
  identity: z.object({
    businessName: z.string(),
    category: z.string(),
    oneLiner: z.string(),
  }),
  /** Always all four — nothing was inferred, so everything must be asked. */
  unresolved: z.array(z.string()),
  why: Explanation,
});

/** The four §1.2 dimensions. None can be evidenced without a site. */
const ROUTING_DIMENSIONS = ['proof_asset', 'capture_capability', 'objective', 'talent_availability'];

export const genomeCreate = defineTool({
  name: 'genome.create',
  version: 1,

  summary:
    'Start a brand genome from a name and category, with no website. Use when the site blocks ' +
    'automated readers, when there is no site, or when the owner would rather just answer the ' +
    'questions. Free — nothing is crawled and no model runs.',

  input: GenomeCreateInput,
  output: GenomeCreateOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  /**
   * `true`. Onboarding retries are common — a dropped connection, a double tap
   * on Continue — and a second draft genome for one brand is a workspace with
   * two half-configured brands and no way to tell which one is live.
   */
  idempotent: true,
  surfaces: ['ONB-01'],
  // No crawl, no inference pass. Deliberately free: a business whose site
  // blocked us should not pay more to get started than one whose did not.
  estimateCents: () => 0,

  async handler(input, ctx) {
    const draft = await ctx.db.genomes.createDraft({
      brandId: input.brandId,
      orgId: ctx.orgId,
      identity: {
        business_name: input.businessName,
        category: input.category,
        one_liner: input.oneLiner ?? '',
        geography: { scope: 'local', locale: input.locale, radius_km: null },
        languages: [input.locale.split('-')[0] ?? 'en'],
        // The schema requires a tier and nothing evidences one. `mid` is the
        // least consequential choice — it neither promises premium positioning
        // nor implies discounting — and onboarding can correct it.
        price_tier: 'mid',
      },
      // Empty, not guessed. Every dimension routes the engine, and the whole
      // argument of `inferGenome` is that an absent answer beats a confident
      // wrong one.
      dimensions: {},
      voice: {},
      source: 'user',
    });

    ctx.logger.info('genome created without a crawl', {
      brandId: input.brandId,
      genomeId: draft.id,
    });

    return {
      draftGenomeId: draft.id,
      identity: {
        businessName: input.businessName,
        category: input.category,
        oneLiner: input.oneLiner ?? '',
      },
      unresolved: ROUTING_DIMENSIONS,
      why: {
        summary: `Started ${input.businessName} from what you told us. Nothing was inferred, so the next questions cover everything that matters.`,
        factors: [
          { label: 'source', detail: 'your answers' },
          { label: 'still to ask', detail: ROUTING_DIMENSIONS.join(', ') },
        ],
        evidence: [],
        // Naming the path not taken, because the owner may not know it exists
        // — and if their site becomes readable later, it is the better one.
        alternatives: [
          {
            option: 'Read your website instead',
            rejectedBecause: 'no readable site was available, so the questions come from you rather than from your pages',
          },
        ],
      },
    };
  },
});

/** Kept for symmetry with `bootstrap.ts`, which throws the same way. */
export function requireBrand(brandId: string | undefined): string {
  if (!brandId) throw new ToolError('INVALID_INPUT', 'A brand must be selected.');
  return brandId;
}
