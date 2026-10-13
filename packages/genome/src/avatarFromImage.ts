import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import type { AvatarClient } from '@sparksocial/generate';

/**
 * `genome.avatar.from_image` — turn an uploaded photo into a HeyGen character
 * this genome can generate video from, and register it in one call.
 *
 * The visual counterpart to `genome.voice.clone_from_sample`, and it exists for
 * the same reason: the onboarding agent screen shows a photo drop zone with an
 * avatar preview, and nothing behind it could accept a photo. What shipped
 * instead was a disabled zone and a raw "HeyGen avatar id" field.
 *
 * ── The id it writes is not the same kind as the one you paste ────────────
 *
 * `genome.avatar_config.set` records an id a person copied from the HeyGen
 * dashboard — a *trained avatar*. This produces a *talking photo*, which HeyGen
 * addresses through a different field in a different character shape. Storing
 * one as the other is not rejected anywhere: `/v2/video/generate` accepts the
 * request and the render fails minutes later. So this writes
 * `heygen_avatar_kind` alongside the id, and `content.generate_avatar_video`
 * reads it.
 *
 * `human_only`, like every other tool that points a brand at a likeness.
 */

export const AvatarFromImageInput = z.object({
  genomeId: z.string().min(1),
  /** A storage URL from `asset.upload_url`. */
  imageUrl: z.string().url(),
  contentType: z.enum(['image/jpeg', 'image/png']),
});

export const AvatarFromImageOutput = z.object({
  genomeId: z.string(),
  version: z.number().int(),
  heygenAvatarId: z.string(),
  heygenAvatarKind: z.literal('talking_photo'),
  why: Explanation,
});

/** An `AvatarClient` that can actually do this — see the factory's comment. */
type PhotoCapableAvatarClient = AvatarClient & { fromImage: NonNullable<AvatarClient['fromImage']> };

/**
 * Takes a client narrowed to one that implements `fromImage`.
 *
 * Deliberately not a runtime `if (!avatar.fromImage) throw`: there is no
 * `ToolErrorCode` that means "this build cannot do that", and inventing one
 * would be the wrong shape anyway. The codebase already has the right answer
 * for an unconfigured capability — `apps/api/src/tools.ts` does not register
 * the tool, the agent never sees it in the manifest, and the UI simply has no
 * button. The type makes that the only way to construct this.
 */
export function makeAvatarFromImage(avatar: PhotoCapableAvatarClient) {
  return defineTool({
    name: 'genome.avatar.from_image',
    version: 1,

    summary:
      "Turn an uploaded photo into this brand's video avatar. Needs one clearly visible face. Requires the " +
      'consent of the person photographed.',

    input: AvatarFromImageInput,
    output: AvatarFromImageOutput,

    effect: 'write',
    autonomy: 'human_only',
    scopes: ['owner', 'admin'],
    /**
     * Each call uploads the photo again and gets a new id back, so no. Re-running
     * is wasteful rather than harmful — unlike a voice clone it consumes no
     * finite slot — but it is still a second thing in the vendor account.
     */
    idempotent: false,
    surfaces: ['CC-01'],

    // Creating a talking photo is not metered; rendering with it is, and that
    // cost belongs to `content.generate_avatar_video` where it is incurred.
    estimateCents: () => 0,

    async handler(input, ctx) {
      if (input.genomeId !== ctx.genomeId) {
        throw new ToolError('ISOLATION_VIOLATION', 'genomeId does not match the active genome.', {
          requested: input.genomeId,
          active: ctx.genomeId,
        });
      }

      const { talkingPhotoId } = await avatar.fromImage({
        imageUrl: input.imageUrl,
        contentType: input.contentType,
      });

      const saved = await ctx.db.genomes.patchConstraints({
        genomeId: input.genomeId,
        orgId: ctx.orgId,
        patch: { heygenAvatarId: talkingPhotoId, heygenAvatarKind: 'talking_photo' },
      });

      const why: Explanation = {
        summary: 'Created a video avatar from the uploaded photo and set it as this brand’s avatar.',
        factors: [
          { label: 'avatar id', detail: talkingPhotoId },
          { label: 'kind', detail: 'talking photo — generated from an image, not a trained avatar' },
        ],
        evidence: [],
        alternatives: [
          {
            option: 'Paste a trained HeyGen avatar id',
            rejectedBecause: 'Better quality and motion, but it has to be trained on the HeyGen account first; genome.avatar_config.set still does this.',
          },
        ],
      };

      ctx.logger.info('avatar created from image', { genomeId: input.genomeId, talkingPhotoId });

      return {
        genomeId: saved.id,
        version: saved.version,
        heygenAvatarId: talkingPhotoId,
        heygenAvatarKind: 'talking_photo' as const,
        why,
      };
    },
  });
}
