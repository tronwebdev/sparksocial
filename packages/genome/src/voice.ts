import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { GenomeVoice } from '@sparksocial/shared/genome';

/**
 * `genome.voice.set` — the sibling `genome.offer.set` had and `voice` did not.
 *
 * `voice` was writable exactly once, at `createDraft` time, and the only caller
 * that supplied anything real was `genome.bootstrap_from_url` filling it from
 * the crawl. Everything else — the four-question onboarding, `genome.create`'s
 * no-website path, and every screen after them — left it at the schema
 * defaults: an all-`0.5` `tone_vector` and empty `pov_statements`,
 * `banned_phrases` and `required_disclaimers`. There was no `patchVoice` on the
 * repository, so no tool could have fixed it and no screen could have called
 * one.
 *
 * What that costs is the copy. `text-writer.ts`'s prompt is built almost
 * entirely from this object, and its system prompt is explicit that "text that
 * would suit any business in the category is a failed beat" — but with a
 * neutral tone and no point of view there is nothing in the prompt to make a
 * beat specific. Measured on a real brand: a quote card came back as "Fresh
 * cuts, fresh perspectives — it's not just a style, it's a statement", and the
 * same beat with two POV statements supplied returned "We perfect every cut
 * because a great fade should keep you sharp for weeks."
 *
 * ── Why `pov_statements` is the field that matters most ────────────────────
 *
 * `tone_vector` moves register; a point of view supplies an *opinion*, which is
 * the only thing in the genome a competitor cannot also claim. It is also the
 * one thing a business owner can produce in thirty seconds and a crawl usually
 * cannot infer at all.
 */

export const GenomeVoiceSetInput = z.object({
  genomeId: z.string(),
  voice: GenomeVoice.partial(),
});

export const GenomeVoiceSetOutput = z.object({
  genomeId: z.string(),
  version: z.number().int(),
});

export const genomeVoiceSet = defineTool({
  name: 'genome.voice.set',
  version: 1,

  summary:
    'Set how the brand sounds — the opinions it holds ("a fade should last three weeks"), phrases it ' +
    'refuses to use, required disclaimers, reading level, and the four tone axes. Every drafted beat is ' +
    'written from this; without it the copy reads like any business in the category.',

  input: GenomeVoiceSetInput,
  output: GenomeVoiceSetOutput,

  effect: 'write',
  autonomy: 'auto',
  /**
   * Not `human_only`, matching `genome.offer.set` and `genome.identity.set`.
   * Correcting how a brand sounds is routine editing, not a governance
   * decision — and `guard.brand_voice` still checks generated copy against the
   * result, so a bad edit here is caught at publish time rather than trusted.
   *
   * `client` is excluded deliberately even though it can read the genome: a
   * client agreeing their brand sounds a certain way is a conversation, not a
   * write.
   */
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,
  surfaces: ['ONB-04', 'SET-01'],

  async handler(input, ctx) {
    const saved = await ctx.db.genomes.patchVoice({
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      voice: input.voice,
    });

    /**
     * The values are logged, unlike most write tools' inputs.
     *
     * A banned phrase or a disclaimer is a compliance instruction — "never say
     * guaranteed", "always include the FCA line" — and when a post later goes
     * out without one, the only useful question is when the rule was set and to
     * what. `tool_calls` records that a call happened; this records what it
     * said.
     */
    ctx.logger.info('genome voice patched', {
      genomeId: input.genomeId,
      fields: Object.keys(input.voice),
      povCount: input.voice.pov_statements?.length,
      bannedCount: input.voice.banned_phrases?.length,
    });

    return { genomeId: saved.id, version: saved.version };
  },
});
