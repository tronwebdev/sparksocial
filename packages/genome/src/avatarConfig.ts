import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';

/**
 * `genome.avatar_config.set` — registers which trained HeyGen avatar and/or
 * ElevenLabs voice this genome generates from.
 *
 * Deliberately separate from `genome.dimensions.set`: dimensions are answered
 * once during onboarding from a fixed question set (§3.1); an avatar/voice id
 * is vendor account state that gets set (or rotated) after an out-of-band
 * training step this tool does not perform — see
 * `packages/generate/src/avatar.ts`'s comment on why there is no
 * `content.avatar.train` tool here yet.
 *
 * `human_only`, same reasoning as `genome.consent.grant`: pointing a genome at
 * *which* trained likeness it clones is exactly the kind of decision an agent
 * proposing it well or badly is not the point — a person on the account
 * confirms this happened after checking the vendor dashboard themselves.
 */

export const AvatarConfigSetInput = z
  .object({
    genomeId: z.string().min(1),
    heygenAvatarId: z.string().min(1).optional(),
    elevenlabsVoiceId: z.string().min(1).optional(),
  })
  .refine((v) => v.heygenAvatarId !== undefined || v.elevenlabsVoiceId !== undefined, {
    message: 'Provide at least one of heygenAvatarId or elevenlabsVoiceId.',
  });

export const AvatarConfigSetOutput = z.object({
  genomeId: z.string(),
  version: z.number().int(),
  heygenAvatarId: z.string().optional(),
  elevenlabsVoiceId: z.string().optional(),
});

export const avatarConfigSet = defineTool({
  name: 'genome.avatar_config.set',
  version: 1,

  summary:
    'Record which trained HeyGen avatar and/or ElevenLabs voice this genome generates from. Set after ' +
    'training completes on the vendor side — this tool does not train one.',

  input: AvatarConfigSetInput,
  output: AvatarConfigSetOutput,

  effect: 'write',
  autonomy: 'human_only',
  scopes: ['owner', 'admin'],
  idempotent: true,
  surfaces: ['CC-01'],

  async handler(input, ctx) {
    const patch: { heygenAvatarId?: string; elevenlabsVoiceId?: string } = {
      ...(input.heygenAvatarId !== undefined ? { heygenAvatarId: input.heygenAvatarId } : {}),
      ...(input.elevenlabsVoiceId !== undefined ? { elevenlabsVoiceId: input.elevenlabsVoiceId } : {}),
    };

    const saved = await ctx.db.genomes.patchConstraints({ genomeId: input.genomeId, orgId: ctx.orgId, patch });

    ctx.logger.info('avatar config set', { genomeId: input.genomeId, ...patch });

    return {
      genomeId: saved.id,
      version: saved.version,
      ...(input.heygenAvatarId !== undefined ? { heygenAvatarId: input.heygenAvatarId } : {}),
      ...(input.elevenlabsVoiceId !== undefined ? { elevenlabsVoiceId: input.elevenlabsVoiceId } : {}),
    };
  },
});
