import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation } from '@sparksocial/shared';

/**
 * `agency.roster` — every brand in the org, with how each is doing.
 *
 * ── The one question the genome scope cannot answer ───────────────────────
 *
 * An agency running forty clients needs to know which of them are quiet. Every
 * other read in this product is genome-scoped, deliberately: a client's assets,
 * knowledge and inbox must never surface in another client's work. So the roster
 * screen could list brands (`genome.list` has always been org-scoped) and could
 * say nothing at all about any of them — a directory with no signal, which is
 * exactly the shape the agency panel had.
 *
 * ── Why this is a roll-up and not a bypass ────────────────────────────────
 *
 * It returns **aggregates keyed by brand**: how many posts went out, what they
 * reached, how much came back. No caption, no post id, no message. A brand's
 * content stays behind the genome predicate; what crosses to the org level is its
 * volume and its outcome. `orgPublishingRollup` in `scoped.ts` holds that line
 * with two assertions — `orgId` is mandatory, and the return shape is aggregates
 * only — and `assertScope` was deliberately not softened to make this possible.
 *
 * ── Owner and admin only ──────────────────────────────────────────────────
 *
 * The narrowest roles that administer every brand in an org by construction,
 * matching `org.*` and `team.permission.set`. An `editor` assigned to two of forty
 * brands has no business reading the other thirty-eight's numbers, and
 * `brand_members` is what says which two — a check this tool would have to
 * duplicate to be safe at a wider scope. Restricting instead is the honest
 * version: an agency roster is an administrator's screen.
 */

const RosterBrand = z.object({
  genomeId: z.string(),
  brandId: z.string(),
  name: z.string(),
  /** When the brand itself was last touched — the roster's "is anyone working on this". */
  updatedAt: z.string(),
  publishedCount: z.number().int(),
  impressions: z.number().int(),
  /** Likes, comments, shares and saves. Views are excluded — see the store. */
  engagements: z.number().int(),
  /**
   * True when nothing published in the window.
   *
   * Called out rather than left to be inferred from a zero, because a zero is the
   * single most important cell on this screen and the reason an agency opens it:
   * a client paying every month whose account has gone quiet.
   */
  quiet: z.boolean(),
});

export const AgencyRosterInput = z.object({
  /** Trailing days. 30 matches the campaign window the rest of the product plans in. */
  windowDays: z.number().int().min(7).max(90).default(30),
});

export const AgencyRosterOutput = z.object({
  windowDays: z.number().int(),
  brands: z.array(RosterBrand),
  /** Totals across the org, so the header does not have to sum the rows itself. */
  totals: z.object({
    brands: z.number().int(),
    quiet: z.number().int(),
    publishedCount: z.number().int(),
    impressions: z.number().int(),
    engagements: z.number().int(),
  }),
  why: Explanation,
});

export const agencyRoster = defineTool({
  name: 'agency.roster',
  version: 1,

  summary:
    'Every brand in this workspace with its publishing volume and engagement over a trailing window, and ' +
    'which ones have gone quiet. Aggregates only — no brand content crosses between brands. Read-only, free.',

  input: AgencyRosterInput,
  output: AgencyRosterOutput,

  effect: 'read',
  autonomy: 'auto',
  // See the header: the two roles that administer every brand in an org.
  scopes: ['owner', 'admin'],
  idempotent: true,
  surfaces: ['SET-ORG-01'],

  async handler(input, ctx) {
    /**
     * Two reads, in parallel, and neither is per-brand.
     *
     * `listForOrg` is the brand switcher's own source — org-scoped since P2 — and
     * the roll-up is one `GROUP BY`. The alternative a screen would have written
     * for itself is one metrics read per brand, which is forty round trips on a
     * page load *and* forty slightly different window boundaries, so brands
     * rendered later would be compared against a later cutoff.
     */
    const [brands, rollup] = await Promise.all([
      ctx.db.genomes.listForOrg(ctx.orgId),
      ctx.db.analytics.orgRollup(ctx.orgId, input.windowDays),
    ]);

    const byGenome = new Map(rollup.map((r) => [r.genomeId, r]));

    const rows = brands
      .map((b) => {
        const m = byGenome.get(b.id);
        const publishedCount = m?.publishedCount ?? 0;
        return {
          genomeId: b.id,
          brandId: b.brandId,
          name: b.name,
          updatedAt: b.updatedAt.toISOString(),
          publishedCount,
          impressions: m?.impressions ?? 0,
          engagements: m?.engagements ?? 0,
          quiet: publishedCount === 0,
        };
      })
      /**
       * Quiet brands first, then least-published.
       *
       * A roster sorted by name is a directory; sorted this way it is a worklist.
       * The screen exists to find the client nobody has posted for, and putting
       * that client on page three of an alphabetical list is how a roster stops
       * being read.
       */
      .sort((a, b) => Number(b.quiet) - Number(a.quiet) || a.publishedCount - b.publishedCount);

    const totals = {
      brands: rows.length,
      quiet: rows.filter((r) => r.quiet).length,
      publishedCount: rows.reduce((s, r) => s + r.publishedCount, 0),
      impressions: rows.reduce((s, r) => s + r.impressions, 0),
      engagements: rows.reduce((s, r) => s + r.engagements, 0),
    };

    return {
      windowDays: input.windowDays,
      brands: rows,
      totals,
      why: {
        summary:
          totals.brands === 0
            ? 'No brands in this workspace yet.'
            : totals.quiet === 0
              ? `All ${totals.brands} brands published something in the last ${input.windowDays} days.`
              : `${totals.quiet} of ${totals.brands} brands published nothing in the last ${input.windowDays} days.`,
        factors: [
          { label: 'window', detail: `${input.windowDays} days` },
          { label: 'brands', detail: String(totals.brands) },
          {
            /**
             * Named because a reader comparing brands has to know what is and is
             * not measured. A brand with no connected account cannot publish and
             * will read as quiet — which is true, and a different problem from a
             * brand that could publish and did not.
             */
            label: 'counts published posts only',
            detail: 'A brand with no connected account reads as quiet because nothing can go out.',
          },
        ],
        evidence: [],
        alternatives: [
          {
            option: 'Rank by engagement',
            rejectedBecause:
              'Engagement compares brands with different audience sizes. Volume answers "is anyone working on this", which is what a roster is for.',
          },
        ],
      },
    };
  },
});
