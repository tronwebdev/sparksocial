import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';
import { ResolvedBeat } from './draft.js';

/**
 * `content.beat.update` — the save the Draft Panel's editor never had.
 *
 * `BeatRow.tsx` lets you edit a beat's text in a textarea, but nothing ever
 * called back through the tool layer for a plain edit — only the three
 * `content.generate_*` buttons wrote anything back, and only for beats they
 * generated media for. Hand-editing a `text`-kind beat (a hook, a CTA, a
 * caption with no media) updated local component state and nothing else;
 * the edit was silently gone the moment the panel closed, and `publish.now`
 * would have sent the *original* wording.
 *
 * Scoped to `text`-kind beats only, deliberately. For a `generated_image`/
 * `generated_video`/`generated_audio` beat, the textarea holds the prompt or
 * script that *produced* the media — editing it is an input to regeneration
 * (`content.generate_image` etc.), not a value with its own meaning to save.
 * Saving it here without regenerating would silently desync the displayed
 * prompt from the media it no longer describes.
 */

export const ContentBeatUpdateInput = z.object({
  contentItemId: z.string().min(1),
  genomeId: z.string().min(1),
  beatId: z.string().min(1),
  text: z.string().min(1).max(2000),
});

export const ContentBeatUpdateOutput = z.object({
  contentItemId: z.string(),
  beats: z.array(ResolvedBeat),
});

export const contentBeatUpdate = defineTool({
  name: 'content.beat.update',
  version: 1,

  summary:
    'Save a hand-edited text beat (a hook, CTA, or caption) on an existing draft — the plain edit path, ' +
    'not a regeneration. Only works on `text`-kind beats; a generated beat\'s prompt/script edits through ' +
    'its own content.generate_* call instead. Free.',

  input: ContentBeatUpdateInput,
  output: ContentBeatUpdateOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  // Setting a beat to a given value is a safe replay of the same value —
  // unlike a regenerate call, there is no "another take" to lose by retrying.
  idempotent: true,

  async handler(input, ctx) {
    const draft = await ctx.db.content.get(input.contentItemId, input.genomeId, ctx.orgId);
    if (!draft) throw new ToolError('NOT_FOUND', 'That draft slot is not open.', { contentItemId: input.contentItemId });

    // A freshly-created calendar slot has no copy yet — an empty beat list is
    // the honest answer, same as `content.get`'s own read, not a parse error.
    const parsed = z.array(ResolvedBeat).safeParse(draft.copy);
    const beats = parsed.success ? parsed.data : [];
    const idx = beats.findIndex((b) => b.beatId === input.beatId);
    if (idx === -1) {
      throw new ToolError('NOT_FOUND', `No beat "${input.beatId}" on this draft.`, { beatId: input.beatId });
    }
    if (beats[idx]!.kind !== 'text') {
      throw new ToolError(
        'INVALID_INPUT',
        `Beat "${input.beatId}" is a "${beats[idx]!.kind}" beat, not text — edit its prompt/script and regenerate instead of saving directly.`,
        { beatId: input.beatId, kind: beats[idx]!.kind },
      );
    }

    const updated = beats.map((b, i) => (i === idx && b.kind === 'text' ? { ...b, text: input.text } : b));

    const saved = await ctx.db.content.updateDraft({
      id: input.contentItemId,
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      copy: updated,
      why: draft.why ?? {
        summary: 'Hand-edited by the owner.',
        factors: [{ label: 'beat', detail: input.beatId }],
        evidence: [],
        alternatives: [],
      },
    });
    if (!saved) {
      throw new ToolError('NOT_FOUND', 'That draft slot is not open.', { contentItemId: input.contentItemId });
    }

    ctx.logger.info('beat text edited', { contentItemId: input.contentItemId, beatId: input.beatId });

    return { contentItemId: input.contentItemId, beats: updated };
  },
});
