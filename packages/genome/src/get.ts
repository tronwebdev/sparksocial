import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';

/**
 * `genome.get` — one brand's genome, by id.
 *
 * ── Why this did not exist, and why its absence was invisible ─────────────
 *
 * `genome.list` returns id, brand, name and timestamp: enough to choose a
 * brand, and nothing about what is configured on one. Everything else that
 * needed a genome read it through `ctx.db` inside its own handler, so no
 * caller ever wanted a read tool — until a screen did.
 *
 * `AgentStep` called `'genome.get'` anyway. There was no such tool, so every
 * call came back `NOT_FOUND`, the effect early-returned, and returning to the
 * last step of onboarding showed an empty avatar and voice state for a brand
 * that had both — which is precisely what the effect was written to prevent.
 * It failed silently because a non-`succeeded` result is a legitimate thing
 * for that effect to ignore. `scripts/check-tool-inputs.mjs` is what found it;
 * the type parameter on `invoke<T>` is hand-written, so the compiler had
 * nothing to say.
 *
 * ── Constraints are the point ────────────────────────────────────────────
 *
 * `heygen_avatar_id` and `elevenlabs_voice_id` are what the caller actually
 * needs, and they live on `constraints`. The identity and dimensions come too,
 * because a tool that returns a genome and omits most of it invites a second
 * near-identical tool later.
 *
 * It did exactly that anyway. `offer`, `voice` and `audience` were left off,
 * so the Command Center's hero — which has a slot labelled "Primary CTA",
 * because the design has one — could not read `offer.primary_cta` and printed
 * an em dash under a comment explaining that no such field existed. It did
 * exist: `genome.offer.set` writes it to its own column and fourteen playbook
 * `cta` beats read it. The omission, not the schema, was the missing field.
 *
 * `learned` stays off. It is accumulated rather than authored, it grows without
 * bound, and the things that read it (`learning.*`) query it directly. Every
 * other column is here now, so the next screen that needs one does not have to
 * find this out the same way.
 *
 * A label for this name already sat in `packages/shared/src/toolLabel.ts`
 * (`'genome.get': 'Read a brand'`) with no tool behind it — somebody expected
 * this to exist too. That label is kept; this does not add a second.
 *
 * The genome comes back in its PRD shape, so the keys are `genome_id` and
 * `workspace_id` rather than `id` and `brandId`. Mapped to the camelCase this
 * tool's callers use, which is the same translation `bootstrap.ts` documents
 * having got wrong once in the other direction.
 *
 * Read-only, and scoped like `genome.list`: the repository filters on the org,
 * and a genome belonging to another one reads as absent rather than forbidden
 * — the same "out of scope reads as not found" rule the store applies
 * everywhere, so probing ids leaks nothing.
 */

export const GenomeGetInput = z.object({ genomeId: z.string().min(1) });

export const GenomeGetOutput = z.object({
  genome: z.object({
    genomeId: z.string(),
    brandId: z.string(),
    version: z.number(),
    identity: z.record(z.unknown()),
    dimensions: z.record(z.unknown()),
    /**
     * Where `offer.primary_cta` lives — the words fourteen playbook `cta`
     * beats use verbatim, and the one field the Command Center's hero has a
     * labelled slot for.
     */
    offer: z.record(z.unknown()),
    voice: z.record(z.unknown()),
    audience: z.record(z.unknown()),
    /** Where `heygen_avatar_id` and `elevenlabs_voice_id` live. */
    constraints: z.record(z.unknown()),
  }),
});

export const genomeGet = defineTool({
  name: 'genome.get',
  version: 1,

  summary:
    "Read one brand's genome — its identity, routing dimensions, offer, voice, audience and constraints, " +
    'including the primary call-to-action and which avatar and voice are registered. Free.',

  input: GenomeGetInput,
  output: GenomeGetOutput,

  effect: 'read',
  autonomy: 'auto',
  // The same set as `genome.list`, for the same reason: reading what a brand
  // is configured as is a precondition for working on it.
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,
  surfaces: ['ONB-05'],

  async handler(input, ctx) {
    const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
    if (!genome) {
      throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });
    }

    return {
      genome: {
        genomeId: genome.genome_id,
        brandId: genome.workspace_id,
        version: genome.version,
        identity: genome.identity as Record<string, unknown>,
        dimensions: genome.dimensions as Record<string, unknown>,
        offer: genome.offer as unknown as Record<string, unknown>,
        voice: genome.voice as unknown as Record<string, unknown>,
        audience: genome.audience as unknown as Record<string, unknown>,
        constraints: genome.constraints as Record<string, unknown>,
      },
    };
  },
});
