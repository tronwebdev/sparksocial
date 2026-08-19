import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';
import type { DubClient } from '@sparksocial/publish';

/**
 * `analytics.cta_traffic` — click counts for a post's CTA link(s), the read
 * side of `link.shorten`'s optional `contentItemId` attribution
 * (`packages/publish/src/linkTool.ts`). Dub carries a live `clicks` count on
 * the link resource itself — confirmed against the real API while building
 * this — so this is a plain per-link read, summed across however many links
 * this post has (normally one).
 *
 * A post with no attributed link is not an error: most posts never call
 * `link.shorten` with a `contentItemId` at all (it's opt-in), so `links: []`
 * is the honest, common answer, not a failure.
 */

export const AnalyticsCtaTrafficInput = z.object({
  genomeId: z.string().min(1),
  contentItemId: z.string().min(1),
});

const LinkTraffic = z.object({
  shortUrl: z.string(),
  destinationUrl: z.string(),
  clicks: z.number(),
});

export const AnalyticsCtaTrafficOutput = z.object({
  contentItemId: z.string(),
  links: z.array(LinkTraffic),
  totalClicks: z.number(),
});

export function makeAnalyticsCtaTraffic(dub: DubClient) {
  return defineTool({
    name: 'analytics.cta_traffic',
    version: 1,

    summary:
      'Click counts for a post’s attributed CTA link(s) — the read side of link.shorten’s optional ' +
      'contentItemId. Empty when the post never had a link attributed, which is the common case.',

    input: AnalyticsCtaTrafficInput,
    output: AnalyticsCtaTrafficOutput,

    effect: 'read',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
    idempotent: true,

    async handler(input, ctx) {
      if (ctx.genomeId && input.genomeId !== ctx.genomeId) {
        throw new ToolError('ISOLATION_VIOLATION', 'That genome is not the one selected.', {
          claimed: input.genomeId,
          selected: ctx.genomeId,
        });
      }

      const item = await ctx.db.content.get(input.contentItemId, input.genomeId, ctx.orgId);
      if (!item) throw new ToolError('NOT_FOUND', 'No content item with that id in this genome.', { contentItemId: input.contentItemId });

      const attributed = await ctx.db.ctaLinks.listForItems([input.contentItemId], ctx.orgId, input.genomeId);

      const links = await Promise.all(
        attributed.map(async (l) => {
          const { clicks } = await dub.getClicks(l.dubLinkId);
          return { shortUrl: l.shortUrl, destinationUrl: l.destinationUrl, clicks };
        }),
      );

      return {
        contentItemId: input.contentItemId,
        links,
        totalClicks: links.reduce((s, l) => s + l.clicks, 0),
      };
    },
  });
}
