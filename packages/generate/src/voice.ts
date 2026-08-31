import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import { ResolvedBeat, keepStructure } from './draft.js';
import { voiceLabel } from '@sparksocial/shared/voices';
import type { VoiceClient } from './types.js';

/**
 * `content.generate_voiceover` — narration audio for a beat, meant to sit
 * under b-roll (an `asset`/`generated_image` beat elsewhere in the same
 * draft), not a talking face.
 *
 * ── Stock voice by default; the owner's own voice is opt-in and gated ──────
 *
 * No playbook in the library today asks specifically for the *owner's*
 * cloned voice — `pb_voice_over_broll`, the only voice-over format, does not
 * set `requires_likeness_license`, meaning a generic ElevenLabs voice is the
 * right default and no consent is needed for it. `useClonedVoice` exists for
 * the case a future playbook (or a user editing a draft by hand) explicitly
 * wants the owner narrating in their own voice instead — at which point this
 * is the same `voice_clone` consent gate `content.generate_avatar_video`
 * applies to `avatar_clone`, checked before the vendor call, not after.
 */

export const ContentGenerateVoiceoverInput = z.object({
  contentItemId: z.string().min(1),
  genomeId: z.string().min(1),
  beatId: z.string().min(1),
  script: z.string().min(1).max(2_000),
  /**
   * Narrate in the owner's own cloned voice rather than a stock one.
   *
   * Optional, with no default, because absent now means something: since
   * `content.scene.voice` exists, the *scene* can hold that preference, and a
   * `false` default here silently overruled it on every call. Pass it to decide
   * per call; omit it to use whatever the scene was set to.
   */
  useClonedVoice: z.boolean().optional(),
});

export const ContentGenerateVoiceoverOutput = z.object({
  contentItemId: z.string(),
  beatId: z.string(),
  url: z.string(),
  why: Explanation,
});

/** ElevenLabs' well-known "Rachel" premade voice — a stable default with no per-genome setup required. */
const STOCK_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

export function makeContentGenerateVoiceover(voice: VoiceClient) {
  return defineTool({
    name: 'content.generate_voiceover',
    version: 1,

    summary:
      'Generate narration audio for a beat — a stock voice by default, or the genome\'s own cloned voice ' +
      'when the scene (or useClonedVoice) asks for it and consent is on file. Spends real money.',

    input: ContentGenerateVoiceoverInput,
    output: ContentGenerateVoiceoverOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: false,
    surfaces: ['CC-02', 'CC-03'],

    // ElevenLabs prices per character; this is a rough per-call ceiling for a
    // short beat, same approximation used elsewhere in this package.
    // PRD §6's \"approval required for media generation\" permission —
    // see `producesMedia` in defineTool.ts on why this is declared, not inferred.
    producesMedia: true,
    estimateCents: () => 3,

    async handler(input, ctx) {
      const draft = await ctx.db.content.get(input.contentItemId, input.genomeId, ctx.orgId);
      if (!draft) {
        throw new ToolError('NOT_FOUND', 'No such draft.', { contentItemId: input.contentItemId });
      }

      const parsed = z.array(ResolvedBeat).safeParse(draft.copy);
      const beats = parsed.success ? parsed.data : [];
      const index = beats.findIndex((b) => b.beatId === input.beatId);
      if (index === -1) {
        throw new ToolError('NOT_FOUND', `Draft has no beat "${input.beatId}".`, {
          contentItemId: input.contentItemId,
          beatId: input.beatId,
        });
      }

      /**
       * The per-call flag wins when it is given; otherwise the scene's own
       * setting decides, and a scene with no setting gets the stock voice —
       * the same default this tool always had.
       */
      const useCloned = input.useClonedVoice ?? beats[index]!.voice === 'brand';

      /**
       * The brand's chosen stock voice, when it has chosen one.
       *
       * Read here rather than defaulted in `STOCK_VOICE_ID` so the setting is
       * consulted at the moment it matters. Absent falls back to the same id this
       * tool has always used, so adding the picker changed the sound of nothing
       * until somebody picked something.
       *
       * `content.scene.voice` still decides *which kind* of voice — the brand's
       * own clone, or a stock one. This decides *which* stock one.
       */
      const brand = ctx.brandId ? await ctx.db.brands.get(ctx.brandId, ctx.orgId) : undefined;
      let voiceId = brand?.stockVoiceId ?? STOCK_VOICE_ID;
      if (useCloned) {
        const consented = await ctx.db.consent.hasActive(input.genomeId, ctx.orgId, 'voice_clone');
        if (!consented) {
          throw new ToolError(
            'FORBIDDEN',
            'No active voice-consent record for this genome. Grant one via genome.consent.grant before using its own voice.',
            { genomeId: input.genomeId },
          );
        }

        const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
        if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

        const registered = genome.constraints.elevenlabs_voice_id;
        if (!registered) {
          throw new ToolError(
            'INVALID_INPUT',
            'No cloned voice is registered for this genome — set one with genome.avatar_config.set first.',
            { genomeId: input.genomeId },
          );
        }
        voiceId = registered;
      }

      const { url } = await voice.generate({ voiceId, script: input.script });

      const nextBeats = [...beats];
      nextBeats[index] = { ...keepStructure(beats[index]!), kind: 'generated_audio', beatId: input.beatId, url, script: input.script };

      const why: Explanation = {
        summary: `Narrated "${input.beatId}" in ${
          useCloned ? "the genome's own voice" : voiceLabel(voiceId).split(' — ')[0] ?? 'a stock voice'
        }.`,
        factors: [{ label: 'script', detail: input.script }],
        evidence: [],
        alternatives: [],
      };

      const updated = await ctx.db.content.updateDraft({
        id: input.contentItemId,
        genomeId: input.genomeId,
        orgId: ctx.orgId,
        copy: nextBeats,
        why,
      });
      if (!updated) {
        throw new ToolError('NOT_FOUND', 'That draft is no longer open — it may already be published.', {
          contentItemId: input.contentItemId,
        });
      }

      ctx.logger.info('voiceover generated', { contentItemId: draft.id, beatId: input.beatId, useClonedVoice: useCloned });

      return { contentItemId: draft.id, beatId: input.beatId, url, why };
    },
  });
}
