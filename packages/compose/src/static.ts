import { z } from 'zod';
import { defineTool, type ScopedDb, type ToolCtx } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import { byId } from '@sparksocial/playbooks';
import type { ResolvedBeat } from '@sparksocial/generate';
import { dimensionsFor, zipTimeline, type BrandKit, type TimedBeat } from './timeline.js';

/**
 * `compose.static` — the second of the plan's three `compose.*` tools
 * (`docs/GAPS.md`: "compose.* is just compose.render, one of three planned
 * tools"). `compose.render` already handles every media type, `image` and
 * `carousel` included, but it does so through Remotion — a full headless-
 * Chrome bundle-and-render, empirically a ~14s round trip even cached
 * (`remotion-runner.ts`'s own comment) — for output that is, in the `image`/
 * `carousel` case, a single static frame with no motion at all. That is the
 * gap this closes: a Satori-based path (JSX → SVG → PNG, no browser) for
 * exactly the media types that never needed one.
 *
 * Deliberately narrower than `compose.render`, not a replacement for it:
 * refuses `video` outright (the caller needs `compose.render` for that) and
 * `text` the same way `compose.render` does (nothing to rasterize). Same
 * timeline-resolution and per-aspect-ratio loop as `compose.render` — the
 * beats and dimensions are identical inputs, only the renderer differs.
 */

export const ComposeStaticInput = z.object({
  genomeId: z.string().min(1),
  contentItemId: z.string().min(1),
});

const StaticRenderOutput = z.object({
  aspect: z.string(),
  url: z.string(),
  beatId: z.string().optional(),
});

export const ComposeStaticOutput = z.object({
  contentItemId: z.string(),
  mediaType: z.enum(['image', 'carousel']),
  renders: z.array(StaticRenderOutput),
  why: Explanation,
});

export interface StaticRunner {
  /** Renders one frame (Satori's whole job — it has no concept of a timeline) as a still image and returns a public URL. */
  renderStill(props: { beats: TimedBeat[]; width: number; height: number; brandKit?: BrandKit }): Promise<string>;
}

export interface ComposeStaticDeps {
  runner: StaticRunner;
}

/** No browser to spin up — a fraction of Remotion's per-render cost even before counting Chrome's own overhead. */
const COST_CENTS_PER_RENDER = 1;

export function makeComposeStatic(deps: ComposeStaticDeps) {
  return defineTool({
    name: 'compose.static',
    version: 1,

    summary:
      'Render an image or carousel post to pixels via Satori (JSX → SVG → PNG, no browser) — a fast, cheap ' +
      'path for static-only formats. Refuses video (use compose.render) and text (nothing to render).',

    input: ComposeStaticInput,
    output: ComposeStaticOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    // Same reasoning as `compose.render`: a re-render is a new render, not a safe replay.
    idempotent: false,

    // PRD §6's \"approval required for media generation\" permission —

    // see `producesMedia` in defineTool.ts on why this is declared, not inferred.

    producesMedia: true,

    estimateCents: () => COST_CENTS_PER_RENDER,

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

      const mediaType = playbook.output.media_type;
      if (mediaType === 'video') {
        throw new ToolError('INVALID_INPUT', 'This is a video post — call compose.render instead, Satori has no concept of motion.', {
          contentItemId: input.contentItemId,
          mediaType,
        });
      }
      if (mediaType === 'text') {
        throw new ToolError('INVALID_INPUT', 'A text-only post has nothing to render — the drafted copy is the post.', {
          contentItemId: input.contentItemId,
          mediaType,
        });
      }

      const resolvedBeats = item.copy as ResolvedBeat[];
      const assetIds = resolvedBeats.filter((b): b is Extract<ResolvedBeat, { kind: 'asset' }> => b.kind === 'asset').map((b) => b.assetId);
      const assetInfo = assetIds.length ? await ctx.db.assets.info(assetIds, input.genomeId, ctx.orgId) : {};

      const timeline = zipTimeline({ resolvedBeats, playbookBeats: playbook.structure.beats, assetInfo });
      const aspects = playbook.output.aspect_ratios;
      const renders: Array<{ aspect: string; url: string; beatId?: string }> = [];
      const brandKit = await brandKitFor(ctx);

      if (mediaType === 'image') {
        for (const aspect of aspects) {
          const { width, height } = dimensionsFor(aspect);
          const url = await deps.runner.renderStill({ beats: timeline, width, height, ...(brandKit ? { brandKit } : {}) });
          renders.push({ aspect, url });
        }
      } else {
        // carousel — each beat is its own slide, rendered independently.
        for (const aspect of aspects) {
          const { width, height } = dimensionsFor(aspect);
          for (const beat of timeline) {
            const url = await deps.runner.renderStill({ beats: [beat], width, height, ...(brandKit ? { brandKit } : {}) });
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
            engine: 'satori',
            costCents: COST_CENTS_PER_RENDER,
          }),
        ),
      );

      ctx.logger.info('composed static render', { genomeId: input.genomeId, contentItemId: item.id, mediaType, renders: renders.length });

      return {
        contentItemId: item.id,
        mediaType: mediaType as 'image' | 'carousel',
        renders,
        why: {
          summary:
            mediaType === 'carousel'
              ? `Rendered ${renders.length} carousel slide${renders.length === 1 ? '' : 's'} for ${playbook.name} via Satori.`
              : `Rendered ${renders.length} image${renders.length === 1 ? '' : 's'} for ${playbook.name} via Satori.`,
          factors: [
            { label: 'playbook', detail: playbook.name },
            { label: 'engine', detail: 'satori (no browser — faster and cheaper than compose.render for static formats)' },
            { label: 'aspect ratios', detail: aspects.join(', ') },
          ],
          evidence: [],
          alternatives: [],
        },
      };
    },
  });
}

/**
 * §8.6's "Apply Brand Kit", resolved from the brand rather than passed in.
 *
 * Not an input on either compose tool, deliberately: the kit is a property of
 * the brand, and a caller able to pass its own colours could render a post in a
 * palette nobody set on the brand — which is exactly the drift `brand.rules`
 * exists to prevent. A missing brand is not an error here; it means "no kit",
 * and the renderers fall back to their own defaults.
 */
async function brandKitFor(ctx: { brandId?: string; orgId: string; db: ScopedDb; logger: ToolCtx['logger'] }): Promise<BrandKit | undefined> {
  if (!ctx.brandId) return undefined;
  try {
    const brand = await ctx.db.brands.get(ctx.brandId, ctx.orgId);
    const colors = brand.brandColors ?? [];
    if (!brand.logoUrl && colors.length === 0) return undefined;
    return { ...(brand.logoUrl ? { logoUrl: brand.logoUrl } : {}), colors };
  } catch (e) {
    // A render is worth more than its styling. Losing the kit produces a
    // correct post in default colours; failing the call produces nothing.
    ctx.logger.warn('brand kit unavailable, rendering with defaults', {
      error: e instanceof Error ? e.message : String(e),
    });
    return undefined;
  }
}
