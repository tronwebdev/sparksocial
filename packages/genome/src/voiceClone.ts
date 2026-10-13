import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import type { VoiceClient } from '@sparksocial/generate';

/**
 * `genome.voice.clone_from_sample` — turn an uploaded or recorded audio sample
 * into an ElevenLabs voice, and register it on the genome in one call.
 *
 * ── Why this exists, and what it replaces ─────────────────────────────────
 *
 * `genome.avatar_config.set` records an `elevenlabsVoiceId` that somebody
 * obtained *elsewhere* — its own comment says so: "set after training completes
 * on the vendor side — this tool does not train one". That left the onboarding
 * agent screen with a voice-upload zone it could not honour, so the zone was
 * drawn and disabled and a raw "ElevenLabs voice id" text field sat underneath
 * it. Asking a small-business owner for a vendor id is asking them to go and be
 * a developer for ten minutes.
 *
 * This performs the training step, so the screen can mean what it shows.
 *
 * ── Why it also writes the genome ─────────────────────────────────────────
 *
 * It would be tidier as two tools — clone, then `genome.avatar_config.set`. It
 * would also be wrong. A clone consumes one of a finite number of voice slots
 * on the ElevenLabs account; if the second call never happens (a closed tab, a
 * failed request) the slot is spent on a voice nothing references and nobody can
 * name. One call, one durable outcome.
 *
 * ── Distinct from `genome.voice.set` ──────────────────────────────────────
 *
 * `genome.voice.set` is the brand's *tone* of voice — words. This is a vocal
 * likeness — sound. They share a noun and nothing else.
 *
 * `human_only`, the same posture as `genome.consent.grant` and
 * `genome.avatar_config.set`: cloning a person's voice is a rights decision. The
 * guardrail that enforces consent at generation time lives where it always did;
 * this is about who may *start* it.
 */

const SampleSource = z.object({
  /** A storage URL from `asset.upload_url` — the recorder and the file picker both go through it. */
  url: z.string().url(),
  contentType: z.string().min(1).max(100),
});

export const VoiceCloneInput = z.object({
  genomeId: z.string().min(1),
  /**
   * What the voice is called in the ElevenLabs dashboard. Cosmetic to us and
   * load-bearing for whoever has to administer that account later, which is why
   * it is required rather than defaulted to a uuid.
   */
  name: z.string().min(1).max(100),
  /**
   * More than one sample improves the clone. Capped at five because ElevenLabs'
   * own guidance stops recommending more, and each one is a server-side fetch
   * plus an upload inside a single request.
   */
  samples: z.array(SampleSource).min(1).max(5),
});

export const VoiceCloneOutput = z.object({
  genomeId: z.string(),
  version: z.number().int(),
  elevenlabsVoiceId: z.string(),
  /**
   * ElevenLabs set this because the account has not verified it may clone this
   * voice. The id is real; narration may still be refused later. Surfaced rather
   * than swallowed — see `voice-client.ts`.
   */
  requiresVerification: z.boolean(),
  why: Explanation,
});

/** A `VoiceClient` that can actually do this — see the factory's comment. */
type CloneCapableVoiceClient = VoiceClient & { clone: NonNullable<VoiceClient['clone']> };

/**
 * Takes a client narrowed to one that implements `clone`.
 *
 * Deliberately not a runtime `if (!voice.clone) throw`: no `ToolErrorCode` means
 * "this build cannot do that", and the codebase already has the right answer for
 * an unconfigured capability — `apps/api/src/tools.ts` does not register the
 * tool, so the agent never sees it and the UI has no button. The type makes that
 * the only way to construct this.
 */
export function makeVoiceCloneFromSample(voice: CloneCapableVoiceClient) {
  return defineTool({
    name: 'genome.voice.clone_from_sample',
    version: 1,

    summary:
      "Clone a voice from uploaded or recorded audio and register it as this brand's voice for generated " +
      'media. Consumes an ElevenLabs voice slot. Requires the consent of the person speaking.',

    input: VoiceCloneInput,
    output: VoiceCloneOutput,

    effect: 'write',
    autonomy: 'human_only',
    scopes: ['owner', 'admin'],
    /**
     * Calling twice produces a second voice and a second consumed slot, so this
     * cannot claim idempotency. It is `human_only`, so the retry risk is a
     * person double-clicking rather than an agent looping.
     */
    idempotent: false,
    surfaces: ['CC-01'],

    /**
     * Cloning itself is not metered per call on ElevenLabs' plans — the cost is
     * the slot, which is a subscription property rather than usage. Declared at
     * zero rather than omitted so the row exists from day one, per CLAUDE.md.
     */
    estimateCents: () => 0,

    async handler(input, ctx) {
      if (input.genomeId !== ctx.genomeId) {
        throw new ToolError('ISOLATION_VIOLATION', 'genomeId does not match the active genome.', {
          requested: input.genomeId,
          active: ctx.genomeId,
        });
      }

      const { voiceId, requiresVerification } = await voice.clone({
        name: input.name,
        samples: input.samples,
      });

      const saved = await ctx.db.genomes.patchConstraints({
        genomeId: input.genomeId,
        orgId: ctx.orgId,
        patch: { elevenlabsVoiceId: voiceId },
      });

      const why: Explanation = {
        summary: `Cloned "${input.name}" from ${input.samples.length} sample${input.samples.length === 1 ? '' : 's'} and set it as this brand's voice.`,
        factors: [
          { label: 'samples', detail: `${input.samples.length} audio file${input.samples.length === 1 ? '' : 's'}` },
          { label: 'voice id', detail: voiceId },
          ...(requiresVerification
            ? [
                {
                  label: 'verification',
                  detail:
                    'ElevenLabs needs this voice verified before it will narrate with it. Complete that in the ElevenLabs dashboard.',
                },
              ]
            : []),
        ],
        evidence: [],
        alternatives: [
          {
            option: 'Paste an existing ElevenLabs voice id',
            rejectedBecause: 'Only useful if a voice was already trained on that account; genome.avatar_config.set still does this.',
          },
        ],
      };

      ctx.logger.info('voice cloned', { genomeId: input.genomeId, voiceId, requiresVerification });

      return {
        genomeId: saved.id,
        version: saved.version,
        elevenlabsVoiceId: voiceId,
        requiresVerification,
        why,
      };
    },
  });
}
