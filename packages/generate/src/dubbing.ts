import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import { ResolvedBeat } from './draft.js';
import type { DubbingClient } from './types.js';

/**
 * `content.generate_dub` — `docs/GAPS.md`'s "Content generation" gap named
 * this `synthesize.dub`; built here under the `content.generate_*` family
 * instead, matching every sibling generation tool in this package rather than
 * introducing a new family for one tool. (`packages/publish/src/dub.ts` is a
 * completely different vendor — Dub.co, link shortening — this file is named
 * `dubbing.ts`, not `dub.ts`, specifically to avoid that collision.)
 *
 * ── Why the caller supplies `sourceUrl`, not a beatId to read from ────────
 * Every other `content.generate_*` tool writes ONE beat from a fresh prompt/
 * script; this one re-voices existing media, so its input is what to dub, not
 * what to say. Requiring the caller to already have the source URL in hand
 * (the same posture `content.generate_avatar_video` takes for `script`) means
 * this tool does not need to resolve an `asset`-kind beat's media type through
 * `ctx.db.assets.info()` just to figure out what it's dubbing — the caller,
 * looking at the Draft Panel, already knows.
 *
 * ── Replaces the beat in place — a dub is not a new sibling beat ──────────
 * See `draft.ts`'s own comment on the `dubbed_media` kind: `zipTimeline`
 * resolves every beat's duration by looking `beatId` up in the *playbook's*
 * fixed beat list, so this cannot invent a new beat id the playbook record
 * has never heard of. A dub REPLACES the named beat's media with the
 * target-language version — to get a full multi-language *variant* of a
 * whole post, clone the item with `draft.repurpose` first, then dub each
 * clone's beats.
 */

export const ContentGenerateDubInput = z.object({
  contentItemId: z.string().min(1),
  genomeId: z.string().min(1),
  beatId: z.string().min(1),
  sourceUrl: z.string().url(),
  mediaType: z.enum(['video', 'audio']),
  /** BCP-47 or ElevenLabs' own two-letter target language code (e.g. "es", "fr", "pt"). */
  targetLanguage: z.string().min(2).max(10),
});

export const ContentGenerateDubOutput = z.object({
  contentItemId: z.string(),
  beatId: z.string(),
  url: z.string(),
  why: Explanation,
});

export function makeContentGenerateDub(dubbing: DubbingClient) {
  return defineTool({
    name: 'content.generate_dub',
    version: 1,

    summary:
      'Re-voice an existing video or audio beat into another language, replacing that beat with the dubbed ' +
      'version. Spends real money — call once the source beat is approved, not speculatively.',

    input: ContentGenerateDubInput,
    output: ContentGenerateDubOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    // Each call is a new, non-deterministic generation — same reasoning as every sibling generation tool.
    idempotent: false,
    surfaces: ['CC-02', 'CC-03'],

    // ElevenLabs prices dubbing per minute of source media; this is a rough
    // per-call ceiling for a short beat, same honest-approximation posture
    // every vendor estimate in this package takes.
    // PRD §6's \"approval required for media generation\" permission —
    // see `producesMedia` in defineTool.ts on why this is declared, not inferred.
    producesMedia: true,
    estimateCents: () => 60,

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

      const { url } = await dubbing.dub({ sourceUrl: input.sourceUrl, targetLanguage: input.targetLanguage, mediaType: input.mediaType });

      const nextBeats = [...beats];
      nextBeats[index] = { kind: 'dubbed_media', beatId: input.beatId, url, targetLanguage: input.targetLanguage, mediaType: input.mediaType };

      const why: Explanation = {
        summary: `Dubbed "${input.beatId}" into ${input.targetLanguage}.`,
        factors: [
          { label: 'source', detail: input.sourceUrl },
          { label: 'target language', detail: input.targetLanguage },
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

      ctx.logger.info('dub generated', { contentItemId: draft.id, beatId: input.beatId, targetLanguage: input.targetLanguage });

      return { contentItemId: draft.id, beatId: input.beatId, url, why };
    },
  });
}
