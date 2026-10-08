import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import { ResolvedBeat, keepStructure } from './draft.js';
import type { VideoClient } from './types.js';

/**
 * `content.generate_broll` — the video counterpart to `content.generate_image`.
 * `docs/GAPS.md`'s "Content generation" gap named this `synthesize.video`;
 * built here under the `content.generate_*` family instead, matching every
 * sibling generation tool in this file's own package (`_image`,
 * `_avatar_video`, `_voiceover`) rather than introducing a new tool family
 * for one tool.
 *
 * Deliberately separate from `content.generate_avatar_video`: this is
 * generative footage from a text prompt — no likeness, no spoken script, no
 * `genome.consent` gate, because nobody's identity is being cloned. Writes a
 * `generated_broll` beat (`draft.ts`'s `ResolvedBeat` union), kept distinct
 * from `generated_video` (the avatar kind, which carries a `script`) for the
 * same reason `generated_image` is kept distinct from `asset`.
 *
 * Same "no dev fallback" posture `content.generate_image` documents: a fake
 * video clip is a lie a draft would ship with, so `apps/api/src/tools.ts`
 * only registers this when a real `FAL_API_KEY` is configured.
 */

export const ContentGenerateBrollInput = z.object({
  contentItemId: z.string().min(1),
  genomeId: z.string().min(1),
  beatId: z.string().min(1),
  prompt: z.string().min(1).max(1_000),
  aspectRatio: z.string().default('9:16'),
  /**
   * Target clip length.
   *
   * The ceiling is 60 rather than 10 because 10 was one vendor's limit written
   * into the contract of the tool. `apps/api`'s client is where a model's
   * allowed lengths actually live (`FAL_VIDEO_DURATIONS`, which snaps the
   * request to something the endpoint accepts) and where the caller's own
   * ceiling lives (`FAL_VIDEO_MAX_CLIP_SEC`). With 10 here, pointing the deploy
   * at Seedance — which takes four to thirty seconds — got the longest beat of
   * a post refused at the schema with `Number must be less than or equal to 10`
   * while the short beats around it generated fine: a post illustrated
   * everywhere except the scene it is actually about.
   *
   * A bound still belongs here, because an unbounded number is money. Sixty is
   * a sanity limit on a single clip, not a claim about any model.
   */
  durationSec: z.number().min(1).max(60).default(5),
});

export const ContentGenerateBrollOutput = z.object({
  contentItemId: z.string(),
  beatId: z.string(),
  url: z.string(),
  why: Explanation,
});

export function makeContentGenerateBroll(video: VideoClient) {
  return defineTool({
    name: 'content.generate_broll',
    version: 1,

    summary:
      'Generate one short b-roll video clip for a specific beat from a text prompt — no likeness, no spoken ' +
      'script. Spends real money — call once copy is approved, not speculatively.',

    input: ContentGenerateBrollInput,
    output: ContentGenerateBrollOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    // Each call is a new, non-deterministic generation — same reasoning as `content.generate_image`.
    idempotent: false,
    surfaces: ['CC-02', 'CC-03'],

    // fal's video models price well above their image models (longer
    // inference); this is a rough per-call ceiling for a short clip, same
    // approximation `content.generate_image` makes for its own model.
    // PRD §6's \"approval required for media generation\" permission —
    // see `producesMedia` in defineTool.ts on why this is declared, not inferred.
    producesMedia: true,
    estimateCents: () => 40,

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

      const { url } = await video.generate({ prompt: input.prompt, aspectRatio: input.aspectRatio, durationSec: input.durationSec });

      const nextBeats = [...beats];
      nextBeats[index] = { ...keepStructure(beats[index]!), kind: 'generated_broll', beatId: input.beatId, url, prompt: input.prompt };

      const why: Explanation = {
        summary: `Generated a ${input.durationSec}s b-roll clip for "${input.beatId}".`,
        factors: [
          { label: 'prompt', detail: input.prompt },
          { label: 'aspect ratio', detail: input.aspectRatio },
          { label: 'duration', detail: `${input.durationSec}s` },
        ],
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

      ctx.logger.info('broll video generated', { contentItemId: draft.id, beatId: input.beatId });

      return { contentItemId: draft.id, beatId: input.beatId, url, why };
    },
  });
}
