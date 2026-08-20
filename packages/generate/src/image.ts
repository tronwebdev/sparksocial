import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import { ResolvedBeat } from './draft.js';
import type { ImageClient } from './types.js';

/**
 * `content.generate_image` — the second, deliberately separate half of
 * turning a draft into something postable.
 *
 * `content.draft` always works and never spends on pixels: it writes copy
 * (cheap, always available) and leaves any beat that needs a generated image
 * as plain text so the Draft Panel's "editor" step has something to show and
 * edit *before* money is spent on media. This tool is the deliberate,
 * separate step that spends it — called once the copy is approved, one beat
 * at a time, so regenerating "just the image" never re-writes copy the user
 * already liked.
 *
 * No dev fallback. `EmbedClient`/`BriefWriter` degrade to a usable-but-fake
 * stand-in when unconfigured because the fake preserves *some* real property
 * (embeddings still rank consistently; templates still pass validation) —
 * there is no equivalent for pixels. A fabricated image is not a degraded
 * image, it is a lie a draft would ship with. So there is no dev image
 * client: `apps/api/src/tools.ts` only registers this tool when a real
 * `FAL_API_KEY` is configured, the same "unset → not registered" rule
 * `WHATSAPP_APP_SECRET` already sets for the inbound webhook — a tool that
 * cannot do its job honestly is better absent than present and fake.
 */

export const ContentGenerateImageInput = z.object({
  contentItemId: z.string().min(1),
  genomeId: z.string().min(1),
  /** Which beat this fills — must already exist on the draft `content.draft` produced. */
  beatId: z.string().min(1),
  prompt: z.string().min(1).max(1_000),
  aspectRatio: z.string().default('1:1'),
});

export const ContentGenerateImageOutput = z.object({
  contentItemId: z.string(),
  beatId: z.string(),
  url: z.string(),
  why: Explanation,
});

export function makeContentGenerateImage(image: ImageClient) {
  return defineTool({
    name: 'content.generate_image',
    version: 1,

    summary:
      'Generate one image for a specific beat of an existing draft (a quote card, a data-insight chart, a ' +
      'carousel slide) and save it into that beat. Spends real money — call once copy is approved, not speculatively.',

    input: ContentGenerateImageInput,
    output: ContentGenerateImageOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    // Each call is a new, non-deterministic generation — same reasoning as
    // `content.draft`: a replay would silently return a stale image rather
    // than the retry the caller actually asked for.
    idempotent: false,
    surfaces: ['CC-02', 'CC-03'],

    // fal.ai's per-image price varies by model; this is the rough per-call
    // ceiling, not a metered readout — same approximation `direct.media.ingest`
    // makes for ffmpeg time.
    // PRD §6's \"approval required for media generation\" permission —
    // see `producesMedia` in defineTool.ts on why this is declared, not inferred.
    producesMedia: true,
    estimateCents: () => 5,

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

      const { url } = await image.generate({ prompt: input.prompt, aspectRatio: input.aspectRatio });

      const nextBeats = [...beats];
      nextBeats[index] = { kind: 'generated_image', beatId: input.beatId, url, prompt: input.prompt };

      const why: Explanation = {
        summary: `Generated an image for "${input.beatId}".`,
        factors: [{ label: 'prompt', detail: input.prompt }, { label: 'aspect ratio', detail: input.aspectRatio }],
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

      ctx.logger.info('image generated', { contentItemId: draft.id, beatId: input.beatId });

      return { contentItemId: draft.id, beatId: input.beatId, url, why };
    },
  });
}
