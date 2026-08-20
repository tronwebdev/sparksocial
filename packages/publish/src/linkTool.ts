import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import type { DubClient } from './dub.js';

/**
 * `link.shorten` — wraps a destination URL in a tracked Dub link, tagged to
 * the genome so click data can eventually be attributed back to a brand and
 * a campaign (PRD line 936).
 *
 * Deliberately standalone rather than force-wired into every beat's CTA:
 * `genome.offer.primary_cta` is free text ("Book Now"), not a URL — the
 * actual link lives on `offer.products[].cta_url`, and no playbook beat
 * resolves that path today. Auto-shortening "every posted link" needs that
 * content-model gap closed first (which beat, on which playbook, carries the
 * URL through to `publish.now`), which is a real design decision this tool
 * doesn't make for the caller. What it gives instead: a genuine, callable
 * capability — the Draft Panel (or a future auto-wire) can call this for any
 * URL it already has in hand.
 *
 * `contentItemId` is optional for the same reason: a caller with no post to
 * attribute the link to yet can still call this — it still works, it just
 * isn't attributable. When given, the created Dub link id is persisted
 * against that content item so `analytics.cta_traffic` can read click counts
 * back for it later.
 */

export const LinkShortenInput = z.object({
  genomeId: z.string().min(1),
  url: z.string().url(),
  /** Extra tags beyond the genome id, e.g. a campaign or playbook name. */
  tags: z.array(z.string().min(1).max(40)).max(5).optional(),
  /** Attributes this link's future clicks to a post — see analytics.cta_traffic. */
  contentItemId: z.string().min(1).optional(),
});

export const LinkShortenOutput = z.object({
  shortUrl: z.string(),
  destinationUrl: z.string(),
});

export function makeLinkShorten(dub: DubClient) {
  return defineTool({
    name: 'link.shorten',
    version: 1,

    summary: 'Wrap a URL in a tracked short link with UTM params, tagged to this brand. Free.',

    input: LinkShortenInput,
    output: LinkShortenOutput,

    // `write`, not `external`: this stays inside our own attribution
    // infrastructure and reaches nobody the way a publish or a WhatsApp send
    // does — nothing about it is visible to the brand's audience yet.
    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    // Re-shortening the same URL twice creates two links pointing at the same
    // place, which is wasteful but not unsafe — no idempotency key needed.
    idempotent: true,
    // Dub bills per link. Small, and the point of recording it is that a brand
    // publishing 400 posts a month can see it at all.
    estimateCents: () => 1,
    surfaces: ['CC-02', 'CAL-04'],

    async handler(input, ctx) {
      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      const result = await dub.shorten({
        url: input.url,
        tags: [input.genomeId, ...(input.tags ?? [])],
        utm: {
          source: 'sparksocial',
          medium: 'social',
          campaign: genome?.identity.business_name ?? input.genomeId,
        },
      });

      if (input.contentItemId) {
        await ctx.db.ctaLinks.create({
          genomeId: input.genomeId,
          orgId: ctx.orgId,
          contentItemId: input.contentItemId,
          dubLinkId: result.linkId,
          shortUrl: result.shortUrl,
          destinationUrl: result.destinationUrl,
        });
      }

      ctx.logger.info('link shortened', { genomeId: input.genomeId, shortUrl: result.shortUrl, contentItemId: input.contentItemId });

      return { shortUrl: result.shortUrl, destinationUrl: result.destinationUrl };
    },
  });
}
