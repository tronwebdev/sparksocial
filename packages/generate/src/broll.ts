import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import { ResolvedBeat } from './draft.js';
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
  /** fal's video models take a target duration; short b-roll clips only — see the client's own ceiling. */
  durationSec: z.number().min(1).max(10).default(5),
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
      nextBeats[index] = { kind: 'generated_broll', beatId: input.beatId, url, prompt: input.prompt };

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
