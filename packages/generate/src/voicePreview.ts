import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import type { VoiceClient } from './types.js';

/**
 * `voice.preview` — speak a short line of text in this genome's registered
 * voice, so somebody can hear it before committing to it.
 *
 * ── Why `content.generate_voiceover` could not do this ────────────────────
 *
 * That tool narrates a *beat of a draft*: it takes a `contentItemId` and a
 * `beatId`, writes the resulting audio onto the draft, and is priced and
 * audited as content production. The agent screen's test box has none of those
 * things — there is no draft during onboarding, and inventing a throwaway one to
 * hear two seconds of speech would put a phantom row in `content_items` and a
 * phantom cost against the content budget.
 *
 * So this is a sibling, not a wrapper: same vendor call, no draft, nothing
 * persisted but the audio file.
 *
 * ── Bounded hard, because it is the one generation tool a stranger can loop ──
 *
 * It is reachable from onboarding, before a brand has done anything, and it
 * spends money per call. `MAX_CHARS` is the guard that matters: ElevenLabs bills
 * by character, so a 280-character ceiling bounds the worst case per call to
 * roughly a tenth of a cent rather than leaving it open to a pasted novel.
 */

/**
 * Two sentences is enough to judge a voice, and it is the only thing standing
 * between an onboarding screen and an unbounded per-character bill.
 */
const MAX_CHARS = 280;

export const VoicePreviewInput = z.object({
  genomeId: z.string().min(1),
  text: z.string().min(1).max(MAX_CHARS),
});

export const VoicePreviewOutput = z.object({
  url: z.string(),
  voiceId: z.string(),
  why: Explanation,
});

export function makeVoicePreview(voice: VoiceClient) {
  return defineTool({
    name: 'voice.preview',
    version: 1,

    summary:
      "Speak a short line in this brand's registered voice so it can be heard before use. Spends a small " +
      'amount per call. Not for content — content.generate_voiceover narrates a draft.',

    input: VoicePreviewInput,
    output: VoicePreviewOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    // Every call is a fresh synthesis at a fresh URL.
    idempotent: false,
    surfaces: ['CC-01'],

    producesMedia: true,
    /**
     * ElevenLabs bills per character. At their published rates a 280-character
     * ceiling lands under a tenth of a cent, which rounds to zero in whole
     * cents — declared as 1 rather than 0 so the budget sees a non-zero number
     * and a runaway loop registers as spend rather than as free.
     */
    estimateCents: () => 1,

    async handler(input, ctx) {
      if (input.genomeId !== ctx.genomeId) {
        throw new ToolError('ISOLATION_VIOLATION', 'genomeId does not match the active genome.', {
          requested: input.genomeId,
          active: ctx.genomeId,
        });
      }

      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      if (!genome) {
        throw new ToolError('NOT_FOUND', 'No such brand.', { genomeId: input.genomeId });
      }

      const voiceId = genome.constraints.elevenlabs_voice_id;
      if (!voiceId) {
        throw new ToolError(
          'INVALID_INPUT',
          'This brand has no voice yet. Record or upload a sample first, or paste an existing voice id.',
          { genomeId: input.genomeId },
        );
      }

      const { url } = await voice.generate({ voiceId, script: input.text });

      const why: Explanation = {
        summary: `Spoke ${input.text.length} characters in this brand's registered voice.`,
        factors: [
          { label: 'voice id', detail: voiceId },
          { label: 'characters', detail: String(input.text.length) },
        ],
        evidence: [],
        alternatives: [],
      };

      ctx.logger.info('voice preview generated', { genomeId: input.genomeId, voiceId, chars: input.text.length });

      return { url, voiceId, why };
    },
  });
}
