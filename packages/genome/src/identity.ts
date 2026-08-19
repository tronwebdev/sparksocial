import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { GenomeIdentity } from '@sparksocial/shared/genome';

/**
 * `genome.identity.set` — the tool ONB-02's chip review was missing.
 *
 * `genome.bootstrap_from_url` infers `identity.*` and saves a draft; the chip
 * review screen exists specifically so a person can correct what it got
 * wrong ("SPARK is saying 'here is what I read about you, correct me'" —
 * `ChipReview.tsx`'s own comment). Until this tool, there was nothing for
 * that correction to call: the chip editor updated local React state and
 * nothing else, so "Looks right" saved silently-wrong inferred data forever,
 * including the one field a person is guaranteed to notice — their own
 * business's name.
 *
 * Partial and field-by-field on purpose, matching the chip shape
 * (`{field: 'identity.price_tier', value, confidence}` — an arbitrary dotted
 * path per `inferGenome`'s own tool description). A caller sends only the
 * fields a person actually touched; everything else on the genome is
 * untouched.
 */

export const GenomeIdentitySetInput = z.object({
  genomeId: z.string(),
  identity: GenomeIdentity.partial(),
});

export const GenomeIdentitySetOutput = z.object({
  genomeId: z.string(),
  version: z.number().int(),
});

export const genomeIdentitySet = defineTool({
  name: 'genome.identity.set',
  version: 1,

  summary:
    'Correct one or more fields the crawl inferred about a brand’s identity (business name, ' +
    'category, one-liner, price tier, geography, languages) — what the ONB-02 chip review screen ' +
    'saves. Only the fields supplied are changed.',

  input: GenomeIdentitySetInput,
  output: GenomeIdentitySetOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,
  surfaces: ['ONB-02'],

  async handler(input, ctx) {
    const saved = await ctx.db.genomes.patchIdentity({
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      identity: input.identity,
    });

    ctx.logger.info('genome identity patched', {
      genomeId: input.genomeId,
      // The values, not just which fields changed — this is the one place
      // that would show a chip getting "confirmed" without actually being
      // corrected first.
      identity: input.identity,
    });

    return { genomeId: saved.id, version: saved.version };
  },
});
