import { z } from 'zod';
import { defineTool, type ToolCtx } from '@sparksocial/tools/defineTool';
import { AssetRole, Explanation, ToolError } from '@sparksocial/shared';
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

export const ResolvedBeat = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('asset'),
    beatId: z.string(),
    assetId: z.string(),
    role: AssetRole,
    caption: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('text'),
    beatId: z.string(),
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
    kind: z.literal('generated_image'),
    beatId: z.string(),
    url: z.string(),
    prompt: z.string(),
  }),
  /** A `content.generate_avatar_video`-produced clip — the cloned likeness speaking `script`. */
  z.object({
    kind: z.literal('generated_video'),
    beatId: z.string(),
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
    kind: z.literal('generated_broll'),
    beatId: z.string(),
    url: z.string(),
    prompt: z.string(),
  }),
  /**
   * A `content.generate_dub`-produced clip — an existing beat's own media
   * (video or audio) re-voiced into `targetLanguage` and written back into
   * the SAME `beatId`, replacing the original-language version. Not a new
   * sibling beat: `zipTimeline` resolves duration by looking `beatId` up in
   * the *playbook's* fixed beat list, so an ad-hoc extra beat id with no
   * playbook entry would break every render — a dub is a beat becoming its
   * target-language self, the same way `content.generate_image` replacing a
   * beat makes it become a specific image. A multi-language *variant* of a
   * whole post is `draft.repurpose` (clone the item) followed by dubbing each
   * clone's beats — not a job for this beat-level tool.
   */
  z.object({
    kind: z.literal('dubbed_media'),
    beatId: z.string(),
    url: z.string(),
    targetLanguage: z.string(),
    mediaType: z.enum(['video', 'audio']),
  }),
  /** A `content.generate_voiceover`-produced narration track, meant to sit under an `asset`/`generated_image` b-roll beat. */
  z.object({
    kind: z.literal('generated_audio'),
    beatId: z.string(),
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
});

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
        throw new ToolError(
          'INVALID_INPUT',
          `${playbook.playbook_id} is filmed, not drafted — use direct.brief.generate.`,
          { playbookId: playbook.playbook_id },
        );
      }

      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

      const plan = await resolvePlan(playbook, genome, input, ctx, deps.embed);

      const outline = buildOutline(plan.beats);

      const beats: ResolvedBeat[] = await Promise.all(
        plan.beats.map((beat) => resolveBeat(beat, { genome, playbook, intent: input.intent, outline }, deps.text)),
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
  ground: { genome: Genome; playbook: Playbook; intent: string; outline: BeatOutlineEntry[] },
  text: TextWriter,
): Promise<ResolvedBeat> {
  if (beat.kind === 'asset') {
    return { kind: 'asset', beatId: beat.beatId, assetId: beat.assetId, role: beat.role, caption: beat.caption };
  }
  if (beat.kind === 'text') {
    return { kind: 'text', beatId: beat.beatId, text: beat.text };
  }
  // kind === 'copy'
  const written = await text.write({
    genome: ground.genome,
    playbook: ground.playbook,
    promptRef: beat.promptRef,
    ...(ground.intent ? { intent: ground.intent } : {}),
    beatId: beat.beatId,
    durationSec: beat.durationSec,
    outline: ground.outline,
  });
  return { kind: 'text', beatId: beat.beatId, text: written };
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
