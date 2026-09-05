import { z } from 'zod';
import { defineTool, type ToolCtx } from '@sparksocial/tools/defineTool';
import { AssetRole, Explanation, ToolError } from '@sparksocial/shared';
import { MAX_LOWER_THIRD } from '@sparksocial/shared/brandKit';
import type { Genome } from '@sparksocial/shared/genome';
import { byId, type Playbook } from '@sparksocial/playbooks';
import {
  buildRenderPlan,
  requiredRoles,
  type EmbedClient,
  type PlannedBeat,
  type RenderPlan,
  type RetrievedAsset,
} from '@sparksocial/assemble';
import { buildSynthesizePlan } from './plan.js';
import type { BeatOutlineEntry, TextWriter } from './types.js';

/**
 * `content.draft` — the tool `assemble.plan` was always half of (plan §6.5,
 * §6.8's Draft Panel).
 *
 * `assemble.plan` resolves a playbook's beats into *what to render* and stops
 * there, by design — it is read-only and never calls a model. This is the
 * other half: for every beat that still needs writing (`kind: 'copy'`, a
 * `prompt_ref` with no text behind it), it calls a real writer, grounded in
 * the genome and the playbook, and persists the result as a draft. Assemble
 * mode reuses `assemble.plan`'s own retrieval + `buildRenderPlan`; synthesize
 * mode has no assets to retrieve, so it goes through `buildSynthesizePlan`
 * instead — the same beat-resolution job, minus the retrieval step
 * `buildRenderPlan` explicitly refuses to do for a non-assemble playbook.
 *
 * ── What this tool does not do ──────────────────────────────────────────
 * It does not render pixels. An `asset`-kind beat stays a reference to an
 * existing Asset Graph asset; a video playbook's beats resolve to a written
 * script with no video file — that render step is the Assemble-render gap
 * `docs/STATUS.md` already tracks (Remotion), not something faked here. What
 * ships real is the writing: every playbook's hook, caption, CTA and script
 * beats, voice-matched to the genome, which is what the Draft Panel's
 * "editor" step needs before generation of the actual media is even asked
 * for.
 *
 * `direct_finish` playbooks are out of scope entirely — that pipeline is
 * `direct.brief.generate` → WhatsApp → `direct.media.ingest`, already built,
 * and planning it here would produce a "draft" for a post nobody has filmed.
 */

/**
 * THE DRAFT OWNS ITS OWN STRUCTURE — decided 24 August, for `M5`'s storyboard.
 *
 * Every beat used to carry an id and nothing else about its shape: duration came
 * from the *playbook* record, joined by `beatId` at render time. That made the
 * playbook the source of truth for structure and the draft the source of truth
 * only for content, which is why `Add scene` was impossible — `zipTimeline`
 * throws for any beat id the playbook does not declare, and a user-added scene
 * has no playbook entry by construction.
 *
 * These two fields move that boundary. A beat now states how long it runs and
 * what it is, and the playbook becomes the *seed* rather than the authority.
 *
 * ── Optional, and that is deliberate ─────────────────────────────────────
 *
 * `content_items.copy` is untyped jsonb, so this needs no migration — but every
 * draft written before today has no `durationSec`, and making it required would
 * fail to parse all of them. So it is optional in the schema, stamped on every
 * new draft, and `zipTimeline` prefers it and falls back to the playbook join.
 * The *tools* that insert or retime a scene require it, which is where the
 * invariant belongs: a beat nobody can date is a legacy row, and a beat somebody
 * just created without a duration is a bug.
 *
 * ── The consequence worth stating ────────────────────────────────────────
 *
 * A draft whose playbook changes underneath it now renders as it was drafted,
 * rather than throwing. That is the point — a post somebody approved should
 * render as approved — but it does mean the drift guard `zipTimeline` carried
 * stops covering these drafts, so the duration-band check has to run against the
 * draft's own totals instead. See `assertDraftDuration`.
 */
const beatShape = {
  beatId: z.string(),
  /**
   * How long this beat runs, in seconds. Absent only on drafts written before
   * the draft owned its structure.
   */
  durationSec: z.number().min(0).optional(),
  /**
   * What this beat *is*, for the storyboard's badge — "Hook", "CTA", "B-roll +
   * text overlay". Seeded from the playbook's beat id and editable, because a
   * scene somebody added has no playbook id to derive a label from.
   */
  label: z.string().min(1).max(40).optional(),
  /**
   * Which voice this scene narrates in, when it overrides the post's default —
   * `M5`'s per-scene "Audio override". Absent is the common case and means "the
   * default", which is what `content.generate_voiceover` picks on its own.
   *
   * An enum rather than a voice id deliberately; see the comment on
   * `content.scene.voice` in `scenes.ts` for why, and for what has to exist
   * before it can widen.
   */
  voice: z.enum(['brand', 'stock']).optional(),
  /**
   * A superimposed line in the lower third of the frame — the Brand Kits
   * screen's `Lower-Thirds` templates, applied to one scene.
   *
   * On the beat rather than on the post because the design applies a preset per
   * scene ("Use This Brand Preset" sits inside the storyboard), and because a
   * name plate that ran for the whole video would be wrong for every video: it
   * names who is speaking *now*.
   *
   * Distinct from an asset's `caption`, which describes what is shown and is
   * what retrieval matched on. The renderers stack them rather than sharing a
   * slot — see `lowerThirdOverlay`.
   */
  lowerThird: z.string().min(1).max(MAX_LOWER_THIRD).optional(),
};

export const ResolvedBeat = z.discriminatedUnion('kind', [
  z.object({
    ...beatShape,
    kind: z.literal('asset'),
    assetId: z.string(),
    role: AssetRole,
    caption: z.string().nullable(),
  }),
  z.object({
    ...beatShape,
    kind: z.literal('text'),
    text: z.string(),
  }),
  /**
   * A `content.generate_image`-produced image — kept distinct from `asset`
   * on purpose. `asset` beats point at the brand's own library
   * (`packages/assetgraph`'s domain: source material, typed roles, reuse
   * cooldowns); a generated image is SPARK's synthetic output for this one
   * post, not raw material another draft would retrieve. Forcing it into
   * `AssetRole`'s taxonomy would misdescribe it as something the brand shot.
   */
  z.object({
    ...beatShape,
    kind: z.literal('generated_image'),
    url: z.string(),
    prompt: z.string(),
  }),
  /** A `content.generate_avatar_video`-produced clip — the cloned likeness speaking `script`. */
  z.object({
    ...beatShape,
    kind: z.literal('generated_video'),
    url: z.string(),
    script: z.string(),
  }),
  /**
   * A `content.generate_broll`-produced clip — generative b-roll from a text
   * prompt, no likeness and no spoken script. Kept distinct from
   * `generated_video` for the same reason `generated_image` is kept distinct
   * from `asset`: this is synthetic footage for one post, not a person
   * speaking, so it carries a `prompt` (like `generated_image`) rather than a
   * `script`. No consent gate applies — nobody's likeness is being cloned.
   */
  z.object({
    ...beatShape,
    kind: z.literal('generated_broll'),
    url: z.string(),
    prompt: z.string(),
  }),
  /**
   * A `content.generate_dub`-produced clip — an existing beat's own media
   * (video or audio) re-voiced into `targetLanguage` and written back into
   * the SAME `beatId`, replacing the original-language version.
   *
   * Not a new sibling beat. The original reason was mechanical — an ad-hoc beat
   * id had no playbook entry to draw a duration from, so it broke every render
   * — and that reason is gone as of the note at the top of this file; the scene
   * tools below now add beat ids the playbook never declared. The *semantic*
   * reason it was really relying on stands, and is the one to keep: a dub is a
   * beat becoming its target-language self, the same way `content.generate_image`
   * replacing a beat makes it become a specific image. Emitting a sibling would
   * put both languages in one cut, back to back. A multi-language *variant* of a
   * whole post is `draft.repurpose` (clone the item) followed by dubbing each
   * clone's beats — not a job for this beat-level tool.
   */
  z.object({
    ...beatShape,
    kind: z.literal('dubbed_media'),
    url: z.string(),
    targetLanguage: z.string(),
    mediaType: z.enum(['video', 'audio']),
  }),
  /** A `content.generate_voiceover`-produced narration track, meant to sit under an `asset`/`generated_image` b-roll beat. */
  z.object({
    ...beatShape,
    kind: z.literal('generated_audio'),
    url: z.string(),
    script: z.string(),
  }),
]);
export type ResolvedBeat = z.infer<typeof ResolvedBeat>;

export const ContentDraftInput = z.object({
  genomeId: z.string().min(1),
  playbookId: z.string().min(1),
  /** Fills an existing slot (from `calendar.generate`, or a prior `content.draft` call) instead of creating a new one. */
  contentItemId: z.string().optional(),
  /** What this specific post is about — grounds both retrieval (assemble mode) and copy (every mode). */
  intent: z.string().max(500).default(''),
  /**
   * The trend this post came out of, when it came out of one.
   *
   * PRD §5's Discovery group asks for a "Trend-to-post conversion rate", and
   * there was no link to compute it from: `trend.repurpose` returns a
   * *suggestion*, the caller then calls this tool, and the two were connected
   * only in the mind of whoever clicked. Passing the trend id here records the
   * connection, which is what makes the metric a count rather than a guess.
   */
  fromTrendId: z.string().max(200).optional(),
  /**
   * Regenerate over hand-edited scene structure.
   *
   * Redrafting an existing slot rebuilds the beat list from the playbook, which
   * is the point — "another take" is the most-used button in the Draft Panel.
   * But since the draft owns its structure, that rebuild also discards anything
   * `content.scene.*` did: an added scene, a retimed one, a per-scene voice. The
   * work is invisible in the response (the new beats simply look like a normal
   * draft), so without a gate the first regenerate after a storyboard edit
   * silently throws the edit away.
   *
   * So a draft that has been edited refuses to regenerate unless this says to.
   * A draft nobody has touched — every beat still exactly as drafted — is
   * unaffected, which is nearly every call.
   */
  // Optional rather than `.default(false)`: a Zod default makes the field
  // *required* on the parsed type, which would force every internal caller of
  // `resolvePlan` to pass a flag that means nothing to it.
  discardSceneEdits: z.boolean().optional(),
});

/**
 * Has somebody edited this draft's structure by hand?
 *
 * Two signals, both cheap and both certain: a beat id the playbook never
 * declared can only have been inserted, and a duration that differs from the
 * playbook's can only have been retimed. A per-scene voice is the third.
 *
 * Deliberately *not* a "modified" flag on the row. A flag has to be maintained
 * by every writer and is wrong the moment one forgets; comparing against the
 * playbook is derived from the data itself and cannot go stale.
 *
 * Reordering alone is not detected, and that is a considered omission rather
 * than an oversight: playbook beat order is not something the beat list records
 * independently, so telling a reorder apart from a fresh draft would need the
 * very stored flag this avoids. A reorder with no other edit loses least — the
 * scenes all still exist, in the playbook's order.
 */
export function hasSceneEdits(playbook: Playbook, beats: ResolvedBeat[]): boolean {
  const seeded = new Map(playbook.structure.beats.map((b) => [b.id, b.duration_sec]));
  return beats.some((b) => {
    if (!seeded.has(b.beatId)) return true;
    if (b.voice !== undefined) return true;
    return b.durationSec !== undefined && b.durationSec !== seeded.get(b.beatId);
  });
}

export const ContentDraftOutput = z.object({
  contentItemId: z.string(),
  playbookId: z.string(),
  mode: z.enum(['synthesize', 'assemble']),
  mediaType: z.enum(['video', 'image', 'carousel', 'text']),
  beats: z.array(ResolvedBeat),
  why: Explanation,
});

/** Retrieval breadth per role — same value `assemble.plan` uses, for the same reason. */
const CANDIDATES_PER_ROLE = 4;

/**
 * The draft-time guardrail pass — PRD §8.6.
 *
 *   *"Governance checks set status to Needs Review or Blocked."*
 *
 * Guardrails ran at `publish.now` and only there, which is the strongest place
 * to enforce them and the worst place to *learn* about them: a whole month of
 * drafts could sit on a calendar looking fine and then fail one at a time on the
 * way out, each an hour before it was due, with nobody watching. §8.6 asks for
 * the verdict at draft time, on the item, where somebody can act on it.
 *
 * Injected rather than imported because `@sparksocial/guardrails` sits after
 * `generate` in the build order — the same seam `ReplyGuard` uses in
 * `packages/engage`, for the same reason. Optional: without it a draft is simply
 * not pre-checked, and `publish.now` still refuses anything that should not go
 * out. Nothing becomes *less* safe when this is absent, only later-diagnosed.
 */
export interface DraftGuard {
  check(
    args: { genomeId: string; playbookId: string; platform: string; text: string; referencedAssetIds: string[] },
    ctx: ToolCtx,
  ): Promise<{ verdict: 'pass' | 'flag' | 'block'; guard?: string; rule?: string; fixAction?: string }>;
}

export interface ContentDraftDeps {
  text: TextWriter;
  embed: EmbedClient;
  guard?: DraftGuard;
}

export function makeContentDraft(deps: ContentDraftDeps) {
  return defineTool({
    name: 'content.draft',
    version: 1,

    summary:
      'Turn a chosen playbook into an actual draft: real, brand-voiced copy for every written beat, plus the ' +
      'brand\'s own assets for every beat that uses one. Does not render video/image pixels — see ' +
      '`content.generate_image` for that. Pass `contentItemId` to fill or regenerate an existing slot.',

    input: ContentDraftInput,
    output: ContentDraftOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    /**
     * `false`. A second call is a second generation, not a safe replay — same
     * reasoning as `human.ask`. Regeneration is the point (a user asking for
     * another take), and idempotent replay would silently return the first
     * take forever.
     */
    idempotent: false,
    surfaces: ['CC-02', 'CC-03'],

    /** One LLM call per copy beat — the only spend this tool incurs. */
    estimateCents: (raw) => {
      const parsed = ContentDraftInput.safeParse(raw);
      const playbook = parsed.success ? byId(parsed.data.playbookId) : undefined;
      if (!playbook) return 1;
      return Math.max(1, playbook.structure.beats.filter((b) => !b.source).length);
    },

    async handler(input, ctx) {
      const playbook = byId(input.playbookId);
      if (!playbook) {
        throw new ToolError('NOT_FOUND', `No playbook "${input.playbookId}".`, { playbookId: input.playbookId });
      }
      if (playbook.mode === 'direct_finish') {
        /**
         * Named in the words of the thing, not of the tool.
         *
         * This message reached a calendar screen verbatim:
         * *"pb_craft_capture is filmed, not drafted — use direct.brief.generate."*
         * Every noun in it is ours — a playbook id and a tool name — and the one
         * actionable fact (somebody has to film something) is the part it does not
         * say. `playbook.name` is what the calendar already shows for this format,
         * so quoting that is what makes the two agree.
         *
         * The tool name moves into `meta`, which `app.ts` never serialises to a
         * client but the audit row keeps.
         */
        throw new ToolError(
          'INVALID_INPUT',
          `"${playbook.name}" is filmed rather than written — SPARK sends a short shot list and builds the ` +
            'post from what you send back, so there is nothing to draft here. Start it from the capture loop ' +
            'instead.',
          { playbookId: playbook.playbook_id, use: 'direct.brief.generate' },
        );
      }

      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

      if (input.contentItemId && !input.discardSceneEdits) {
        const existing = await ctx.db.content.get(input.contentItemId, input.genomeId, ctx.orgId);
        const parsed = z.array(ResolvedBeat).safeParse(existing?.copy);
        if (parsed.success && parsed.data.length > 0 && hasSceneEdits(playbook, parsed.data)) {
          throw new ToolError(
            'INVALID_INPUT',
            'This draft’s storyboard has been edited by hand. Regenerating replaces it — pass discardSceneEdits to confirm.',
            { contentItemId: input.contentItemId },
          );
        }
      }

      const plan = await resolvePlan(playbook, genome, input, ctx, deps.embed);

      /**
       * What the campaign this post belongs to is trying to achieve.
       *
       * The writer used to get the brand, its offer and a call to action, and
       * nothing about the campaign — so a post in a hiring campaign read exactly
       * like a post in a sales one. The objective picked the playbooks and then
       * stopped at the door.
       *
       * Read from the campaign when the slot has one. `content.draft`'s ad-hoc
       * path (CC-02) creates posts with no `campaignId` at all, and those fall
       * back to the genome's standing objective — which is the honest answer for
       * a post that belongs to no campaign, rather than no answer.
       */
      const campaignId = input.contentItemId
        ? (await ctx.db.content.get(input.contentItemId, input.genomeId, ctx.orgId))?.campaignId
        : undefined;
      const campaign = campaignId ? await ctx.db.campaigns.get(campaignId, ctx.orgId) : undefined;
      const objective = campaign?.objective ?? genome.dimensions.objective;

      const outline = buildOutline(plan.beats);

      const beats: ResolvedBeat[] = await Promise.all(
        plan.beats.map((beat) =>
          resolveBeat(beat, { genome, playbook, intent: input.intent, outline, objective }, deps.text),
        ),
      );

      const why = explain(plan, playbook.name, beats);

      const draft = input.contentItemId
        ? await ctx.db.content.updateDraft({
            id: input.contentItemId,
            genomeId: input.genomeId,
            orgId: ctx.orgId,
            copy: beats,
            why,
          })
        : await ctx.db.content.createDraft({
            genomeId: input.genomeId,
            orgId: ctx.orgId,
            playbookId: playbook.playbook_id,
            mode: playbook.mode,
            ...(playbook.content_pillar ? { pillar: playbook.content_pillar } : {}),
            copy: beats,
            why,
            ...(input.intent ? { intent: input.intent } : {}),
            ...(input.fromTrendId ? { sourceTrendId: input.fromTrendId } : {}),
          });

      if (!draft) {
        // Out of scope, already published, or genuinely gone — one message
        // for all three, same reasoning as HumanLoopStore.answer.
        throw new ToolError('NOT_FOUND', 'That draft slot is not open.', { contentItemId: input.contentItemId });
      }

      /**
       * §8.6's draft-time verdict. Evaluated against the copy that was just
       * written, and recorded on the item so the calendar can show it.
       *
       * A *block* sets `blocked` and a *flag* sets `needs_review`; a pass leaves
       * the status alone, because a clean draft is exactly as scheduled as it was
       * before. Deliberately does not throw on a block: the draft exists, it is
       * on the calendar, and somebody has to be able to open it and see what is
       * wrong with it. Throwing would delete the evidence.
       *
       * The platform is the playbook's first — this runs before a slot has an
       * account assigned in the ad-hoc path, and `platform_policy` is the only
       * check that reads it.
       */
      const guardPlatform = playbook.output.platforms[0] ?? 'instagram';
      const draftText = beats
        .filter((b): b is Extract<ResolvedBeat, { kind: 'text' }> => b.kind === 'text')
        .map((b) => b.text)
        .join('\n\n');

      if (deps.guard && draftText) {
        const verdict = await deps.guard
          .check(
            {
              genomeId: input.genomeId,
              playbookId: playbook.playbook_id,
              platform: guardPlatform,
              text: draftText,
              referencedAssetIds: beats
                .filter((b): b is Extract<ResolvedBeat, { kind: 'asset' }> => b.kind === 'asset')
                .map((b) => b.assetId),
            },
            ctx,
          )
          // A guardrail layer that is itself broken must not stop a draft being
          // saved — `publish.now` re-runs all of this before anything is public.
          .catch(() => ({ verdict: 'pass' as const }));

        if (verdict.verdict === 'block') {
          await ctx.db.content.markBlocked({
            id: draft.id,
            orgId: ctx.orgId,
            reason: verdict.fixAction ?? verdict.rule ?? `Blocked by ${verdict.guard ?? 'a guardrail'}.`,
          });
        } else if (verdict.verdict === 'flag') {
          await ctx.db.content.markNeedsReview({
            id: draft.id,
            orgId: ctx.orgId,
            reason: verdict.fixAction ?? verdict.rule ?? `Flagged by ${verdict.guard ?? 'a guardrail'}.`,
          });
        }
      }

      ctx.logger.info('content drafted', {
        genomeId: input.genomeId,
        playbookId: playbook.playbook_id,
        contentItemId: draft.id,
        beats: beats.length,
      });

      return {
        contentItemId: draft.id,
        playbookId: playbook.playbook_id,
        mode: playbook.mode as 'synthesize' | 'assemble',
        mediaType: plan.mediaType,
        beats,
        why,
      };
    },
  });
}

/** Exported for `draft.variants`/`draft.repurpose` (variants.ts) — the same plan-then-write pipeline `content.draft` itself uses. */
export async function resolvePlan(
  playbook: Playbook,
  genome: Genome,
  input: z.infer<typeof ContentDraftInput>,
  ctx: ToolCtx,
  embed: EmbedClient,
): Promise<RenderPlan> {
  if (playbook.mode !== 'assemble') return buildSynthesizePlan(playbook, genome);

  const roles = requiredRoles(playbook.structure.beats);
  let assets: RetrievedAsset[] = [];
  if (roles.length > 0) {
    const embedding = await embed.embed(input.intent || playbook.description);
    const results = await ctx.db.assets.retrieve({
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      embedding,
      requiredRoles: roles,
      k: roles.length * CANDIDATES_PER_ROLE,
    });
    assets = results.map((r) => ({ assetId: r.assetId, role: r.role, caption: r.caption, score: r.score }));
  }

  const { plan } = buildRenderPlan({ playbook, genome, assets });
  return plan;
}

/**
 * The running order of a post, for the writer of each beat.
 *
 * Built once per post and shared, so beats are still written independently and
 * in parallel — what they share is the outline, not each other's output. Three
 * call sites need it (`content.draft`, `content.variants`, `content.repurpose`),
 * which is why it is a function rather than three copies of the same map.
 */
export function buildOutline(beats: readonly PlannedBeat[]): BeatOutlineEntry[] {
  return beats.map((b) =>
    b.kind === 'copy'
      ? { beatId: b.beatId, kind: 'copy' as const, promptRef: b.promptRef }
      : b.kind === 'text'
        ? { beatId: b.beatId, kind: 'literal' as const, text: b.text }
        : { beatId: b.beatId, kind: 'literal' as const },
  );
}

export async function resolveBeat(
  beat: PlannedBeat,
  ground: {
    genome: Genome;
    playbook: Playbook;
    intent: string;
    outline: BeatOutlineEntry[];
    /** The campaign's objective, or the genome's when there is no campaign. */
    objective?: string;
  },
  text: TextWriter,
): Promise<ResolvedBeat> {
  /**
   * Duration and label are stamped onto every beat here, which is the moment the
   * draft takes ownership of its own structure. `PlannedBeat.durationSec` already
   * came from the playbook, so this copies rather than computes — the difference
   * is that from now on the *draft* is the record of it, and a later playbook
   * edit cannot silently retime a post somebody approved.
   */
  const structure = { durationSec: beat.durationSec, label: labelFor(beat.beatId) };

  if (beat.kind === 'asset') {
    return {
      ...structure,
      kind: 'asset',
      beatId: beat.beatId,
      assetId: beat.assetId,
      role: beat.role,
      caption: beat.caption,
    };
  }
  if (beat.kind === 'text') {
    return { ...structure, kind: 'text', beatId: beat.beatId, text: beat.text };
  }
  // kind === 'copy'
  const written = await text.write({
    genome: ground.genome,
    playbook: ground.playbook,
    promptRef: beat.promptRef,
    ...(ground.intent ? { intent: ground.intent } : {}),
    ...(ground.objective ? { objective: ground.objective } : {}),
    beatId: beat.beatId,
    durationSec: beat.durationSec,
    outline: ground.outline,
  });
  return { ...structure, kind: 'text', beatId: beat.beatId, text: written };
}

/**
 * Carry a beat's structure across a change of `kind`.
 *
 * `content.generate_image`/`_avatar_video`/`_broll`/`_voiceover`/`_dub` all
 * *replace* a beat wholesale — the beat becomes the media that was generated for
 * it. Before the draft owned its structure that was harmless, because a beat
 * held nothing but its id and its content. It is not harmless now: writing the
 * new object without these two fields would silently reset the scene's length to
 * the playbook's and drop the label, so generating media into a retimed scene
 * would quietly undo the retime.
 *
 * Spread this first, so the replacing object's own `kind` and content still win.
 */
export function keepStructure(
  beat: ResolvedBeat,
): { durationSec?: number; label?: string; voice?: 'brand' | 'stock'; lowerThird?: string } {
  return {
    ...(beat.durationSec !== undefined ? { durationSec: beat.durationSec } : {}),
    ...(beat.label !== undefined ? { label: beat.label } : {}),
    ...(beat.voice !== undefined ? { voice: beat.voice } : {}),
    ...(beat.lowerThird !== undefined ? { lowerThird: beat.lowerThird } : {}),
  };
}

/**
 * The storyboard badge, from the beat's own id.
 *
 * Playbook beat ids are already the vocabulary the design uses — `hook`, `cta`,
 * `take`, `body`, `cover`, `step_1` — so the label is a presentation of
 * something that exists rather than a new field somebody has to fill. Anything
 * unrecognised becomes its own id in words, which is what the panel showed
 * before this existed.
 *
 * Stored rather than derived at render time because a scene somebody *added* has
 * no playbook id to derive from, and a label that only worked for seeded beats
 * would be a badge that vanished on the one beat the user made themselves.
 */
export function labelFor(beatId: string): string {
  const base = beatId.replace(/_\d+$/, '');
  const known: Record<string, string> = {
    hook: 'Hook',
    cta: 'CTA',
    take: 'Talking head',
    body: 'Body',
    argument: 'Argument',
    cover: 'Cover',
    step: 'Step',
    slides: 'Slides',
    proof: 'Proof',
    caption: 'Caption',
    broll: 'B-roll + text overlay',
  };
  return known[base] ?? base.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * CLAUDE.md invariant 4: which beats were written vs. sourced from the
 * brand's own library is a decision the user watches SPARK make.
 */
function explain(plan: RenderPlan, playbookName: string, beats: ResolvedBeat[]): Explanation {
  const written = beats.filter((b) => b.kind === 'text').length;
  const fromLibrary = beats.filter((b) => b.kind === 'asset').length;

  return {
    summary:
      `Drafted a ${playbookName} — ${written} written beat${written === 1 ? '' : 's'}` +
      `${fromLibrary ? ` and ${fromLibrary} of your own ${fromLibrary === 1 ? 'asset' : 'assets'}` : ''}.`,
    factors: [
      { label: 'playbook', detail: playbookName },
      { label: 'beats', detail: `${beats.length}` },
      ...(fromLibrary ? [{ label: 'assets used', detail: `${fromLibrary}` }] : []),
    ],
    evidence: beats
      .filter((b): b is Extract<ResolvedBeat, { kind: 'asset' }> => b.kind === 'asset')
      .map((b) => ({ kind: 'asset' as const, id: b.assetId, note: b.caption ?? `${b.role} in "${b.beatId}"` })),
    alternatives: [],
  };
}
