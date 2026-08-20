import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import { byId } from '@sparksocial/playbooks';
import type { ResolvedBeat } from '@sparksocial/generate';
import { dimensionsFor, zipTimeline, type TimedBeat } from './timeline.js';

/**
 * `compose.render` — the render step plan §6.5 names as `compose.render`
 * (Remotion, playbook beats), the gap `docs/STATUS.md` tracked as "Assemble
 * render": `assemble.plan`/`content.draft` resolve *what* to render and stop
 * there; this turns that into actual pixels.
 *
 * One tool serves every media type — video, image, carousel — because they
 * are the same composition rendered differently, not three renderers:
 *   - `video`: one full-length render per declared aspect ratio.
 *   - `image`: one single-frame still per aspect ratio, of the whole beat set
 *     (an image playbook's beats are typically one beat).
 *   - `carousel`: one still per aspect ratio *per beat* — a carousel's beats
 *     are its slides.
 *   - `text`: nothing to render; the copy beats already written by
 *     `content.draft` are the post. Returns immediately with no renders.
 */

export const ComposeRenderInput = z.object({
  genomeId: z.string().min(1),
  contentItemId: z.string().min(1),
});

const RenderOutput = z.object({
  aspect: z.string(),
  url: z.string(),
  beatId: z.string().optional(),
});

export const ComposeRenderOutput = z.object({
  contentItemId: z.string(),
  mediaType: z.enum(['video', 'image', 'carousel', 'text']),
  renders: z.array(RenderOutput),
  why: Explanation,
});

export interface RenderRunner {
  /** Renders the full beat sequence and returns a public URL to the finished file. */
  renderVideo(props: { beats: TimedBeat[]; width: number; height: number }): Promise<string>;
  /** Renders one frame (the first) of the given beats as a still image and returns a public URL. */
  renderStill(props: { beats: TimedBeat[]; width: number; height: number }): Promise<string>;
}

export interface ComposeDeps {
  runner: RenderRunner;
}

/** Self-hosted compute has a real cost even with no per-call vendor bill — CLAUDE.md's "no exceptions" on cost_cents. */
const COST_CENTS_PER_RENDER = 5;

export function makeComposeRender(deps: ComposeDeps) {
  return defineTool({
    name: 'compose.render',
    version: 1,

    summary:
      'Render a drafted post to actual pixels — video, image stills, or carousel slides — applying the brand’s ' +
      'own type and layout via Remotion. Text-only posts have nothing to render and return immediately.',

    input: ComposeRenderInput,
    output: ComposeRenderOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    /** A re-render is a new render (new footage, a fixed typo, another take) — not a safe replay. Same reasoning as `content.draft`. */
    idempotent: false,

    // PRD §6's \"approval required for media generation\" permission —

    // see `producesMedia` in defineTool.ts on why this is declared, not inferred.

    producesMedia: true,

    estimateCents: (raw) => {
      const parsed = ComposeRenderInput.safeParse(raw);
      if (!parsed.success) return COST_CENTS_PER_RENDER;
      return COST_CENTS_PER_RENDER; // refined per-aspect/per-beat once the draft is loaded; this is the pre-flight floor
    },

    async handler(input, ctx) {
      const item = await ctx.db.content.get(input.contentItemId, input.genomeId, ctx.orgId);
      if (!item) throw new ToolError('NOT_FOUND', 'That content item is not open.', { contentItemId: input.contentItemId });
      if (!item.copy) {
        throw new ToolError('INVALID_INPUT', 'This content item has no draft yet — call content.draft first.', {
          contentItemId: input.contentItemId,
        });
      }

      const playbook = byId(item.playbookId);
      if (!playbook) throw new ToolError('NOT_FOUND', `No playbook "${item.playbookId}".`, { playbookId: item.playbookId });

      const resolvedBeats = item.copy as ResolvedBeat[];
      const assetIds = resolvedBeats.filter((b): b is Extract<ResolvedBeat, { kind: 'asset' }> => b.kind === 'asset').map((b) => b.assetId);
      const assetInfo = assetIds.length ? await ctx.db.assets.info(assetIds, input.genomeId, ctx.orgId) : {};

      const timeline = zipTimeline({ resolvedBeats, playbookBeats: playbook.structure.beats, assetInfo });
      const mediaType = playbook.output.media_type;

      if (mediaType === 'text') {
        return {
          contentItemId: item.id,
          mediaType,
          renders: [],
          why: {
            summary: 'A text-only post has nothing to render — the drafted copy is the post.',
            factors: [{ label: 'media type', detail: 'text' }],
            evidence: [],
            alternatives: [],
          },
        };
      }

      const aspects = playbook.output.aspect_ratios;
      const renders: Array<{ aspect: string; url: string; beatId?: string }> = [];

      if (mediaType === 'video') {
        for (const aspect of aspects) {
          const { width, height } = dimensionsFor(aspect);
          const url = await deps.runner.renderVideo({ beats: timeline, width, height });
          renders.push({ aspect, url });
        }
      } else if (mediaType === 'image') {
        for (const aspect of aspects) {
          const { width, height } = dimensionsFor(aspect);
          const url = await deps.runner.renderStill({ beats: timeline, width, height });
          renders.push({ aspect, url });
        }
      } else {
        // carousel — each beat is a slide, rendered as its own still.
        for (const aspect of aspects) {
          const { width, height } = dimensionsFor(aspect);
          for (const beat of timeline) {
            const url = await deps.runner.renderStill({ beats: [beat], width, height });
            renders.push({ aspect, url, beatId: beat.beatId });
          }
        }
      }

      await Promise.all(
        renders.map((r) =>
          ctx.db.content.recordRender({
            contentItemId: item.id,
            genomeId: input.genomeId,
            orgId: ctx.orgId,
            aspect: r.aspect,
            storageUrl: r.url,
            engine: 'remotion',
            costCents: COST_CENTS_PER_RENDER,
          }),
        ),
      );

      ctx.logger.info('composed render', {
        genomeId: input.genomeId,
        contentItemId: item.id,
        mediaType,
        renders: renders.length,
      });

      return {
        contentItemId: item.id,
        mediaType,
        renders,
        why: explain(mediaType, timeline, renders, aspects, playbook.name),
      };
    },
  });
}

function explain(
  mediaType: 'video' | 'image' | 'carousel',
  timeline: TimedBeat[],
  renders: Array<{ aspect: string }>,
  aspects: readonly string[],
  playbookName: string,
): Explanation {
  const totalSec = Math.round(timeline.reduce((sum, b) => sum + b.durationSec, 0) * 10) / 10;
  return {
    summary:
      mediaType === 'video'
        ? `Rendered a ${totalSec}s ${playbookName} for ${aspects.length} aspect ratio${aspects.length === 1 ? '' : 's'}.`
        : `Rendered ${renders.length} ${mediaType === 'carousel' ? 'carousel slide' : 'image'}${renders.length === 1 ? '' : 's'} for ${playbookName}.`,
    factors: [
      { label: 'playbook', detail: playbookName },
      { label: 'beats', detail: `${timeline.length}` },
      { label: 'aspect ratios', detail: aspects.join(', ') },
      { label: 'engine', detail: 'remotion' },
    ],
    evidence: [],
    alternatives: [],
  };
}
