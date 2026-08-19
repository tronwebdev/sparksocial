import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { GenomeOffer } from '@sparksocial/shared/genome';

/**
 * `genome.offer.set` — the tool nothing in onboarding or the crawl ever calls.
 *
 * `offer.primary_cta` defaults to `''` (`GenomeOffer`'s own schema default)
 * and nothing sets it afterward: the five-question onboarding never asks for
 * a call-to-action, and `inferGenome`'s inference schema has no `offer` field
 * at all. Fourteen playbook beats (`packages/playbooks/src/records.ts`)
 * source their `cta` beat from `genome:offer.primary_cta` — not a guess,
 * a `source` beat, meaning "use the business's actual words, never invent
 * one" — so every one of them threw `NOT_FOUND` ("The genome has no value at
 * 'offer.primary_cta'") for every genome, always, with no way to fix it. This
 * is that way.
 */

export const GenomeOfferSetInput = z.object({
  genomeId: z.string(),
  offer: GenomeOffer.partial(),
});

export const GenomeOfferSetOutput = z.object({
  genomeId: z.string(),
  version: z.number().int(),
});

export const genomeOfferSet = defineTool({
  name: 'genome.offer.set',
  version: 1,

  summary:
    'Set what the brand is actually asking someone to do — the primary call-to-action ("Book now", ' +
    '"Try it free"), and optionally its products. Fills the "cta" beat every video/carousel playbook ' +
    'with one needs; without it, those playbooks cannot draft at all.',

  input: GenomeOfferSetInput,
  output: GenomeOfferSetOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,

  async handler(input, ctx) {
    const saved = await ctx.db.genomes.patchOffer({
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      offer: input.offer,
    });

    ctx.logger.info('genome offer patched', { genomeId: input.genomeId, offer: input.offer });

    return { genomeId: saved.id, version: saved.version };
  },
});
