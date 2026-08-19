import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import { ResolvedBeat } from './draft.js';
import type { AvatarClient } from './types.js';

/**
 * `content.generate_avatar_video` — renders a cloned-likeness beat that
 * `content.draft` could only write as a script.
 *
 * Mirrors `content.generate_image`'s split from `content.draft` exactly, for
 * the same reason: copy is cheap and always available, rendering spends real
 * money, so they are separate calls a caller makes once the script is
 * approved, not automatically.
 *
 * ── No avatar-training pipeline here ────────────────────────────────────
 *
 * HeyGen's actual flow is two steps: train a reusable avatar from a
 * `talent_likeness` reference (their side takes minutes to longer, sometimes
 * with manual review), then generate any number of videos from the resulting
 * `avatar_id`. This tool is only the second step. Training is out-of-band —
 * an operator does it once through HeyGen's own console after consent is on
 * file — and `genome.avatar_config.set` records the result. Building the
 * training pipeline itself is comparable in scope to the Assemble-render
 * (Remotion) gap already tracked in `docs/STATUS.md`, not something to fold
 * into this pass.
 *
 * ── The consent gate lives here, not only in the `rights` guardrail ────────
 *
 * `guard.evaluate_draft`'s `rights` check runs before a draft may be
 * scheduled — necessary, but it evaluates a *finished* draft. Engine spec
 * §10: *"Cloning a third party is blocked at the tool layer, not the prompt
 * layer"* — the tool that actually spends money rendering a face is the tool
 * layer that sentence means, so this checks `genome.consent` itself, before
 * calling the vendor, rather than trusting that some earlier step already did.
 */

export const ContentGenerateAvatarVideoInput = z.object({
  contentItemId: z.string().min(1),
  genomeId: z.string().min(1),
  beatId: z.string().min(1),
  /** Exactly what the avatar should say — the caller's current, edited script for this beat. */
  script: z.string().min(1).max(2_000),
  aspectRatio: z.string().default('9:16'),
});

export const ContentGenerateAvatarVideoOutput = z.object({
  contentItemId: z.string(),
  beatId: z.string(),
  url: z.string(),
  why: Explanation,
});

export function makeContentGenerateAvatarVideo(avatar: AvatarClient) {
  return defineTool({
    name: 'content.generate_avatar_video',
    version: 1,

    summary:
      'Render one beat as spoken by this genome\'s registered avatar. Requires an active avatar_clone ' +
      'consent record and a trained avatar registered via genome.avatar_config.set. Spends real money.',

    input: ContentGenerateAvatarVideoInput,
    output: ContentGenerateAvatarVideoOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: false,
    surfaces: ['CC-02', 'CC-03'],

    // HeyGen prices per rendered minute; this is the rough per-call ceiling
    // for a short-form beat, same approximation content.generate_image makes.
    estimateCents: () => 50,

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

      // The tool-layer block, ahead of the vendor call — see this module's
      // doc comment. `hasActive` with no `subject` asks "is anyone cleared",
      // matching `rights()`'s genome-wide `avatarEnabled` semantics.
      const consented = await ctx.db.consent.hasActive(input.genomeId, ctx.orgId, 'avatar_clone');
      if (!consented) {
        throw new ToolError(
          'FORBIDDEN',
          'No active likeness-consent record for this genome. Grant one via genome.consent.grant before generating avatar video.',
          { genomeId: input.genomeId },
        );
      }

      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

      const avatarId = genome.constraints.heygen_avatar_id;
      if (!avatarId) {
        throw new ToolError(
          'INVALID_INPUT',
          'No trained avatar is registered for this genome — set one with genome.avatar_config.set first.',
          { genomeId: input.genomeId },
        );
      }

      const { url } = await avatar.generate({ avatarId, script: input.script, aspectRatio: input.aspectRatio });

      const nextBeats = [...beats];
      nextBeats[index] = { kind: 'generated_video', beatId: input.beatId, url, script: input.script };

      const why: Explanation = {
        summary: `Rendered "${input.beatId}" from the genome's registered avatar.`,
        factors: [
          { label: 'script', detail: input.script },
          { label: 'consent', detail: 'Active avatar_clone consent record on file.' },
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

      ctx.logger.info('avatar video generated', { contentItemId: draft.id, beatId: input.beatId });

      return { contentItemId: draft.id, beatId: input.beatId, url, why };
    },
  });
}
