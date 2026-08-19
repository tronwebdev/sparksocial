import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';

/**
 * `genome.list` — every brand in the caller's organisation.
 *
 * This is what the brand switcher reads, and it is deliberately the *only* way a
 * client discovers which `genomeId` values it may use. The API's auth resolver
 * refuses any genome that doesn't belong to the verified org, so a client that
 * guessed an id would simply be rejected; this tool answers "what am I entitled
 * to ask for" so it never has to guess.
 *
 * Scoped by `ctx.orgId` — which comes from a verified Clerk session, never from
 * the request body. There is no `genomeId` input by design: gating the list of
 * genomes on an already-selected genome would be circular, and it is the one read
 * that must work *before* a genome is chosen.
 *
 * No `why`: CLAUDE.md invariant 4 covers decisions a user watches SPARK make —
 * a trend pick, a calendar placement, a mix ratio. An enumeration is not a
 * decision, and attaching a rationale to it would be noise.
 */

export const GenomeListInput = z.object({});

export const GenomeListOutput = z.object({
  genomes: z.array(
    z.object({
      genomeId: z.string(),
      brandId: z.string(),
      name: z.string(),
      updatedAt: z.string(),
    }),
  ),
});

export const genomeList = defineTool({
  name: 'genome.list',
  version: 1,

  summary: 'List every brand genome in the current organisation, most recently updated first. Free.',

  input: GenomeListInput,
  output: GenomeListOutput,

  effect: 'read',
  autonomy: 'auto',
  // Every role, including `client` and `viewer`: seeing which brands exist is
  // the precondition for using the product at all, and the rows are already
  // org-scoped by the query.
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,

  async handler(_input, ctx) {
    const rows = await ctx.db.genomes.listForOrg(ctx.orgId);
    return {
      genomes: rows.map((r) => ({
        genomeId: r.id,
        brandId: r.brandId,
        name: r.name,
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  },
});
