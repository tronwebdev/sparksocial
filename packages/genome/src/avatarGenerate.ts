import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import type { AvatarClient, ImageClient } from '@sparksocial/generate';

/**
 * `genome.avatar.generate` — the agent screen's "Generate Avatar" button:
 * synthesise a portrait, then turn it into a usable HeyGen character.
 *
 * ── Why this is two vendors in one tool ───────────────────────────────────
 *
 * The prototype's button promises one thing ("I have no photo; make me a
 * presenter"), and delivering it needs an image model to produce a face and
 * HeyGen to accept that face as a character. Splitting it would leave a
 * generated portrait sitting in storage that the caller must then hand to
 * `genome.avatar.from_image` — and if that second call never happens, the spend
 * already happened for nothing. Same argument as
 * `genome.voice.clone_from_sample` doing its own genome write.
 *
 * ── What it deliberately is not ───────────────────────────────────────────
 *
 * Not a likeness of anybody. It generates a synthetic presenter from the brand's
 * own description, which is the one avatar case that needs no consent record —
 * there is no person to consent. That is also why this is `auto` while
 * `genome.avatar.from_image` and `genome.voice.clone_from_sample` are
 * `human_only`: those point a brand at a real human being, and this does not.
 *
 * The honest limitation, stated because it will surface at the first render: an
 * image model asked for a face produces a *photograph-like* face, and HeyGen
 * then animates it. It is not a trained avatar and does not move like one.
 */

export const AvatarGenerateInput = z.object({
  genomeId: z.string().min(1),
  /** Free-text steer — "woman in her 30s, warm, studio lighting". Optional. */
  hint: z.string().max(300).optional(),
});

export const AvatarGenerateOutput = z.object({
  genomeId: z.string(),
  version: z.number().int(),
  heygenAvatarId: z.string(),
  heygenAvatarKind: z.literal('talking_photo'),
  /** The generated portrait, so the screen can show what it made. */
  imageUrl: z.string(),
  why: Explanation,
});

type PhotoCapableAvatarClient = AvatarClient & { fromImage: NonNullable<AvatarClient['fromImage']> };

export function makeAvatarGenerate(images: ImageClient, avatar: PhotoCapableAvatarClient) {
  return defineTool({
    name: 'genome.avatar.generate',
    version: 1,

    summary:
      'Generate a synthetic presenter portrait for this brand and make it the video avatar. No real person ' +
      'is involved, so no consent record is needed. Spends real money.',

    input: AvatarGenerateInput,
    output: AvatarGenerateOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: false,
    surfaces: ['CC-01'],

    producesMedia: true,
    // One image generation, same order as `brand.logo.generate`'s estimate; the
    // HeyGen upload that follows is not metered.
    estimateCents: () => 4,

    async handler(input, ctx) {
      if (input.genomeId !== ctx.genomeId) {
        throw new ToolError('ISOLATION_VIOLATION', 'genomeId does not match the active genome.', {
          requested: input.genomeId,
          active: ctx.genomeId,
        });
      }

      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      const category = genome?.identity.category ?? '';
      const oneLiner = genome?.identity.one_liner ?? '';

      /**
       * `1:1` and framed tight, because HeyGen rejects a photo whose face is
       * smaller than 200x200 or that contains more than one. A wide
       * environmental shot is the reliable way to fail both at once.
       */
      const prompt = [
        'A photorealistic head-and-shoulders portrait of one person looking directly at the camera.',
        'Neutral friendly expression, mouth closed, even studio lighting, plain uncluttered background.',
        'Exactly one face, centred, filling most of the frame. Sharp focus. No text, no logos, no hands.',
        category ? `They present for a ${category}.` : '',
        oneLiner ? `The business: ${oneLiner}.` : '',
        input.hint ? `The owner suggests: ${input.hint}.` : '',
      ]
        .filter(Boolean)
        .join(' ');

      const { url: imageUrl } = await images.generate({ prompt, aspectRatio: '1:1' });

      const { talkingPhotoId } = await avatar.fromImage({ imageUrl, contentType: 'image/jpeg' });

      const saved = await ctx.db.genomes.patchConstraints({
        genomeId: input.genomeId,
        orgId: ctx.orgId,
        patch: { heygenAvatarId: talkingPhotoId, heygenAvatarKind: 'talking_photo' },
      });

      const why: Explanation = {
        summary: 'Generated a synthetic presenter and made it this brand’s video avatar.',
        factors: [
          { label: 'avatar id', detail: talkingPhotoId },
          { label: 'kind', detail: 'talking photo — animated from a generated image' },
          ...(input.hint ? [{ label: 'steer', detail: input.hint }] : []),
        ],
        evidence: [],
        alternatives: [
          {
            option: 'Upload a real photo',
            rejectedBecause: 'Better if the brand has a face it wants associated with it — genome.avatar.from_image does this, and it needs that person’s consent.',
          },
        ],
      };

      ctx.logger.info('avatar generated', { genomeId: input.genomeId, talkingPhotoId });

      return {
        genomeId: saved.id,
        version: saved.version,
        heygenAvatarId: talkingPhotoId,
        heygenAvatarKind: 'talking_photo' as const,
        imageUrl,
        why,
      };
    },
  });
}
