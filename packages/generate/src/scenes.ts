import { z } from 'zod';
import { defineTool, type ToolCtx } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import { byId, type Playbook } from '@sparksocial/playbooks';
import { assertDraftDuration } from '@sparksocial/assemble';
import { ResolvedBeat, labelFor } from './draft.js';
import { MAX_LOWER_THIRD } from '@sparksocial/shared/brandKit';

/**
 * THE SCENE TOOLS — `M5`'s storyboard, at the tool layer.
 *
 * `DP video2.dc.html` draws a video draft as an ordered strip of scenes: each
 * with a badge ("Hook", "Talking head", "B-roll + text overlay", "CTA"), a
 * description, a time range, and per-scene audio; above them, an `Add scene`
 * button and a running total. Four of those five things were readable from the
 * existing draft. The fifth — changing the strip — had no tool behind it at all.
 * The Draft Panel could regenerate a beat's *content* five different ways and
 * could not add, delete, move, or retime one.
 *
 * That was not an omission in the UI. It was structural: a beat's duration lived
 * on the playbook record, joined at render time, so a scene the user added had
 * nowhere to state its own length and `zipTimeline` threw on it. The draft taking
 * ownership of its structure (see `beatShape` in `draft.ts`) is what makes these
 * five tools possible; they are the write side of that change.
 *
 * ── One invariant, enforced in one place ──────────────────────────────────
 *
 * Every one of these tools can change the post's total length, and every video
 * format declares a duration band it has to stay inside — that band is the
 * format's contract with the platform, not a suggestion. So all five run the
 * result through `assertDraftDuration` *before* saving. Editing is the only place
 * that check can now live: `buildRenderPlan`'s own band check only ever sees the
 * playbook template, which by definition no longer describes an edited draft.
 *
 * The consequence is worth stating plainly, because it will look like a bug the
 * first time someone hits it: on a tight format there is no room to add a scene.
 * `pb_talking_head_hot_take` is a 23-second cut in a 15–30s band, so a fourth
 * scene has to come out of the other three. The tools say so — the error names
 * the resulting length and the band — rather than accepting the edit and letting
 * the post fail on the way out, hours later, in front of nobody.
 *
 * ── What these tools deliberately do not do ───────────────────────────────
 *
 * They do not generate anything. An inserted scene is a `text` beat holding the
 * description the user typed; turning it into footage is
 * `content.generate_broll`/`_image`/`_avatar_video`, unchanged, and free of any
 * knowledge that the beat was hand-added. Splitting "make a slot" from "fill it"
 * is what keeps the storyboard editable without spending money per keystroke.
 */

/* ── Shared plumbing ─────────────────────────────────────────────────── */

/** Every scene tool addresses one draft and answers with the whole new strip. */
const SceneTarget = {
  contentItemId: z.string().min(1),
  genomeId: z.string().min(1),
};

const SceneOutput = z.object({
  contentItemId: z.string(),
  beats: z.array(ResolvedBeat),
  /** The post's new length, so the storyboard's "0:24 total" is a fact and not a client-side sum that could drift. */
  totalDurationSec: z.number(),
  /** The format's band, when it has one, so the UI can show the headroom an edit has left. */
  durationBand: z.tuple([z.number(), z.number()]).optional(),
  why: Explanation,
});

interface Loaded {
  playbook: Playbook;
  beats: ResolvedBeat[];
}

async function loadStrip(
  input: { contentItemId: string; genomeId: string },
  ctx: ToolCtx,
): Promise<Loaded> {
  const draft = await ctx.db.content.get(input.contentItemId, input.genomeId, ctx.orgId);
  if (!draft) throw new ToolError('NOT_FOUND', 'No such draft.', { contentItemId: input.contentItemId });

  /**
   * A published post is not a storyboard. Editing the scenes of something already
   * live would change the record of what went out without changing what went out
   * — `publish.rollback` is the tool for taking it down.
   */
  if (draft.status === 'published' || draft.status === 'rolled_back') {
    throw new ToolError('INVALID_INPUT', 'This post has already gone out — its scenes are a record now, not a draft.', {
      contentItemId: input.contentItemId,
      status: draft.status,
    });
  }

  const playbook = byId(draft.playbookId);
  if (!playbook) {
    throw new ToolError('NOT_FOUND', `No playbook "${draft.playbookId}".`, { playbookId: draft.playbookId });
  }

  const parsed = z.array(ResolvedBeat).safeParse(draft.copy);
  const beats = parsed.success ? parsed.data : [];
  if (beats.length === 0) {
    throw new ToolError('INVALID_INPUT', 'This slot has no draft yet — run content.draft on it first.', {
      contentItemId: input.contentItemId,
    });
  }
  return { playbook, beats };
}

/**
 * The one write path, so the band check cannot be forgotten by a sixth tool
 * added later: validate against the format, save, and answer with the totals the
 * storyboard header shows.
 */
async function saveStrip(
  args: { contentItemId: string; genomeId: string },
  loaded: Loaded,
  beats: ResolvedBeat[],
  why: Explanation,
  ctx: ToolCtx,
): Promise<z.infer<typeof SceneOutput>> {
  assertDraftDuration(loaded.playbook, beats);

  const saved = await ctx.db.content.updateDraft({
    id: args.contentItemId,
    genomeId: args.genomeId,
    orgId: ctx.orgId,
    copy: beats,
    why,
  });
  if (!saved) {
    throw new ToolError('NOT_FOUND', 'That draft is no longer open.', { contentItemId: args.contentItemId });
  }

  const band = loaded.playbook.output.duration_sec;
  return {
    contentItemId: args.contentItemId,
    beats,
    totalDurationSec: totalOf(loaded.playbook, beats),
    ...(band ? { durationBand: [band[0], band[1]] as [number, number] } : {}),
    why,
  };
}

export function totalOf(playbook: Playbook, beats: ResolvedBeat[]): number {
  const seeded = new Map(playbook.structure.beats.map((b) => [b.id, b.duration_sec]));
  const sum = beats.reduce((acc, b) => acc + (b.durationSec ?? seeded.get(b.beatId) ?? 0), 0);
  return Math.round(sum * 10) / 10;
}

function indexOf(beats: ResolvedBeat[], beatId: string): number {
  const i = beats.findIndex((b) => b.beatId === beatId);
  if (i === -1) throw new ToolError('NOT_FOUND', `This draft has no scene "${beatId}".`, { beatId });
  return i;
}

/**
 * A fresh id for an inserted scene, `scene_1`, `scene_2`, …
 *
 * Counted from what the strip already holds rather than from its length, because
 * inserting and deleting in any order must never reissue a live id: a duplicate
 * beat id would make every other tool here address the wrong scene, since they
 * all find by id.
 */
export function nextSceneId(beats: ResolvedBeat[]): string {
  const taken = new Set(beats.map((b) => b.beatId));
  for (let n = 1; ; n += 1) {
    const id = `scene_${n}`;
    if (!taken.has(id)) return id;
  }
}

/* ── content.scene.insert ────────────────────────────────────────────── */

export const SceneInsertInput = z.object({
  ...SceneTarget,
  /**
   * Insert after this scene. Omit to open the post — a hook is the one scene
   * people most often want in front of what the agent wrote.
   */
  afterBeatId: z.string().min(1).optional(),
  /** What happens in this scene, in the user's own words. Becomes the beat's text, and the brief for generating its media. */
  description: z.string().min(1).max(2_000),
  durationSec: z.number().min(0.5).max(600),
  /** The storyboard badge. Defaults to "Scene", since a hand-added scene has no playbook id to name it from. */
  label: z.string().min(1).max(40).optional(),
});

export const sceneInsert = defineTool({
  name: 'content.scene.insert',
  version: 1,

  summary:
    'Add a scene to a video draft\'s storyboard — a described, timed slot at a chosen position. Writes the ' +
    'description as the scene\'s text; generating its footage is a separate content.generate_* call. Refused ' +
    'if the new total would put the post outside its format\'s duration band. Free.',

  input: SceneInsertInput,
  output: SceneOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  // A second identical call adds a second scene, which is what it looks like it
  // does — but it is not a safe replay of the first.
  idempotent: false,
  surfaces: ['CC-02'],

  async handler(input, ctx) {
    const loaded = await loadStrip(input, ctx);
    const at = input.afterBeatId === undefined ? 0 : indexOf(loaded.beats, input.afterBeatId) + 1;

    const scene: ResolvedBeat = {
      kind: 'text',
      beatId: nextSceneId(loaded.beats),
      text: input.description,
      durationSec: input.durationSec,
      label: input.label ?? 'Scene',
    };

    const beats = [...loaded.beats.slice(0, at), scene, ...loaded.beats.slice(at)];

    const why: Explanation = {
      summary: `Added a ${input.durationSec}s scene at position ${at + 1}.`,
      factors: [
        { label: 'scene', detail: scene.label ?? 'Scene' },
        { label: 'new total', detail: `${totalOf(loaded.playbook, beats)}s` },
      ],
      evidence: [],
      alternatives: [],
    };

    return saveStrip(input, loaded, beats, why, ctx);
  },
});

/* ── content.scene.remove ────────────────────────────────────────────── */

export const SceneRemoveInput = z.object({ ...SceneTarget, beatId: z.string().min(1) });

export const sceneRemove = defineTool({
  name: 'content.scene.remove',
  version: 1,

  summary:
    'Drop a scene from a video draft\'s storyboard. Refused if it would leave the post empty, or outside its ' +
    'format\'s duration band. Free.',

  input: SceneRemoveInput,
  output: SceneOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  // Removing a scene that is already gone is a NOT_FOUND, not a second removal
  // — so replaying this call can only ever produce the state it produced.
  idempotent: true,
  surfaces: ['CC-02'],

  async handler(input, ctx) {
    const loaded = await loadStrip(input, ctx);
    const at = indexOf(loaded.beats, input.beatId);

    if (loaded.beats.length === 1) {
      throw new ToolError('INVALID_INPUT', 'That is the only scene left — delete the draft instead of emptying it.', {
        contentItemId: input.contentItemId,
      });
    }

    const dropped = loaded.beats[at]!;
    const beats = loaded.beats.filter((_, i) => i !== at);

    const why: Explanation = {
      summary: `Removed the "${dropped.label ?? labelFor(dropped.beatId)}" scene.`,
      factors: [{ label: 'new total', detail: `${totalOf(loaded.playbook, beats)}s` }],
      evidence: [],
      alternatives: [],
    };

    return saveStrip(input, loaded, beats, why, ctx);
  },
});

/* ── content.scene.reorder ───────────────────────────────────────────── */

export const SceneReorderInput = z.object({
  ...SceneTarget,
  beatId: z.string().min(1),
  /** Zero-based position in the finished strip. Clamped, so dragging past the end lands at the end. */
  toIndex: z.number().int().min(0),
});

export const sceneReorder = defineTool({
  name: 'content.scene.reorder',
  version: 1,

  summary: 'Move a scene to a different position in a video draft\'s storyboard. Free.',

  input: SceneReorderInput,
  output: SceneOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  // Moving a scene to the position it is already in is the same state.
  idempotent: true,
  surfaces: ['CC-02'],

  async handler(input, ctx) {
    const loaded = await loadStrip(input, ctx);
    const from = indexOf(loaded.beats, input.beatId);
    const to = Math.min(input.toIndex, loaded.beats.length - 1);

    const beats = [...loaded.beats];
    const [moved] = beats.splice(from, 1);
    beats.splice(to, 0, moved!);

    const why: Explanation = {
      summary: `Moved "${moved!.label ?? labelFor(moved!.beatId)}" from position ${from + 1} to ${to + 1}.`,
      // Reordering cannot change the total, so there is nothing to report about
      // length — saying "new total: 24s" after a move would imply it might have.
      factors: [{ label: 'scenes', detail: `${beats.length}` }],
      evidence: [],
      alternatives: [],
    };

    return saveStrip(input, loaded, beats, why, ctx);
  },
});

/* ── content.scene.retime ────────────────────────────────────────────── */

export const SceneRetimeInput = z.object({
  ...SceneTarget,
  beatId: z.string().min(1),
  durationSec: z.number().min(0.5).max(600),
});

export const sceneRetime = defineTool({
  name: 'content.scene.retime',
  version: 1,

  summary:
    'Change how long one scene runs. Refused if the new total would put the post outside its format\'s ' +
    'duration band. Free.',

  input: SceneRetimeInput,
  output: SceneOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  // Setting a duration to a given value is a safe replay of that same value.
  idempotent: true,
  surfaces: ['CC-02'],

  async handler(input, ctx) {
    const loaded = await loadStrip(input, ctx);
    const at = indexOf(loaded.beats, input.beatId);
    const before = loaded.beats[at]!;

    const beats = loaded.beats.map((b, i) => (i === at ? { ...b, durationSec: input.durationSec } : b));

    const why: Explanation = {
      summary: `Retimed "${before.label ?? labelFor(before.beatId)}" to ${input.durationSec}s.`,
      factors: [
        // The previous length is worth stating: on a legacy draft it came from
        // the playbook rather than the beat, and this edit is the moment that
        // stops being true for this scene.
        { label: 'was', detail: `${before.durationSec ?? 'the format default'}` },
        { label: 'new total', detail: `${totalOf(loaded.playbook, beats)}s` },
      ],
      evidence: [],
      alternatives: [],
    };

    return saveStrip(input, loaded, beats, why, ctx);
  },
});

/* ── content.scene.voice ─────────────────────────────────────────────── */

/**
 * The prototype's per-scene "Audio override".
 *
 * The design draws a named voice ("Maya, warm, conversational") as the override
 * value, and there is no voice catalogue behind that name — no tool lists
 * available voices, and nothing stores one per brand beyond a single cloned
 * `elevenlabs_voice_id`. So the override is modelled as the choice that actually
 * exists rather than the one the mock draws: **the brand's own cloned voice, or
 * a stock one.** That distinction is real, is per-scene, is consent-gated, and is
 * the thing `content.generate_voiceover` was already deciding — it just had to be
 * told per call, so the decision could not survive being made once.
 *
 * Naming voices properly needs a catalogue tool and a picker; when that lands
 * this field widens from an enum to an id and this comment goes away. Storing a
 * made-up name today would put a control on screen that resolves to nothing.
 */
export const SceneVoiceInput = z.object({
  ...SceneTarget,
  beatId: z.string().min(1),
  /** `brand` narrates in the genome's own cloned voice; `stock` in a generic one; `default` clears the override. */
  voice: z.enum(['brand', 'stock', 'default']),
});

export const sceneVoice = defineTool({
  name: 'content.scene.voice',
  version: 1,

  summary:
    'Set which voice one scene narrates in — the brand\'s own cloned voice or a stock one — or clear the ' +
    'override. Records the choice; the narration itself is generated by content.generate_voiceover. Free.',

  input: SceneVoiceInput,
  output: SceneOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,
  surfaces: ['CC-02'],

  async handler(input, ctx) {
    const loaded = await loadStrip(input, ctx);
    const at = indexOf(loaded.beats, input.beatId);

    /**
     * Consent is checked here, at the moment the choice is made, and again in
     * `content.generate_voiceover` at the moment money is spent. Both, on
     * purpose: checking only at generation time means the storyboard shows "your
     * voice" on a scene that will refuse to render, and checking only here means
     * a consent record withdrawn afterwards is never noticed.
     */
    if (input.voice === 'brand') {
      const consented = await ctx.db.consent.hasActive(input.genomeId, ctx.orgId, 'voice_clone');
      if (!consented) {
        throw new ToolError(
          'FORBIDDEN',
          'No active voice consent for this brand — grant one before narrating in its own voice.',
          { genomeId: input.genomeId },
        );
      }
    }

    const beats = loaded.beats.map((b, i) => {
      if (i !== at) return b;
      if (input.voice === 'default') {
        const { voice: _cleared, ...rest } = b;
        return rest as ResolvedBeat;
      }
      return { ...b, voice: input.voice };
    });

    const why: Explanation = {
      summary:
        input.voice === 'default'
          ? 'This scene now uses the post\'s default voice.'
          : `This scene will narrate in ${input.voice === 'brand' ? "the brand's own voice" : 'a stock voice'}.`,
      factors: [{ label: 'scene', detail: input.beatId }],
      evidence: [],
      alternatives: [],
    };

    return saveStrip(input, loaded, beats, why, ctx);
  },
});


/* ── content.scene.lower_third ───────────────────────────────────────── */

/**
 * `SET-WS-BRAND-KITS`' `Lower-Thirds` templates, applied to one scene.
 *
 * The brand kit stores the lines; this puts one on a scene. Kept separate from
 * `content.beat.update` — which edits what a beat *says* — because a lower-third
 * is superimposed on top of whatever the beat already is: a talking-head scene
 * keeps its script and gains a name plate. Folding the two together would mean a
 * caption edit could silently clear an overlay, or the reverse.
 *
 * Not gated on the format having a duration. A still can carry a lower-third —
 * `compose.static` draws one — so gating on video would remove the overlay from
 * the one format where it is easiest to read.
 */
export const SceneLowerThirdInput = z.object({
  ...SceneTarget,
  beatId: z.string().min(1),
  /** The line to superimpose. Null clears it, which is how the panel removes one. */
  text: z.string().min(1).max(MAX_LOWER_THIRD).nullable(),
});

export const sceneLowerThird = defineTool({
  name: 'content.scene.lower_third',
  version: 1,

  summary:
    'Put a lower-third line on one scene — a superimposed name, role or point, usually chosen from the ' +
    "brand kit's Lower-Thirds presets. Pass null to clear it. Leaves the scene's own text and media alone. Free.",

  input: SceneLowerThirdInput,
  output: SceneOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  // Setting an overlay to a given value replays safely to that same value.
  idempotent: true,
  surfaces: ['CC-02'],

  async handler(input, ctx) {
    const loaded = await loadStrip(input, ctx);
    const at = indexOf(loaded.beats, input.beatId);

    const beats = loaded.beats.map((b, i) => {
      if (i !== at) return b;
      if (input.text === null) {
        const { lowerThird: _cleared, ...rest } = b;
        return rest as ResolvedBeat;
      }
      return { ...b, lowerThird: input.text };
    });

    const why: Explanation = {
      summary:
        input.text === null
          ? 'Cleared this scene\u2019s lower-third.'
          : `Added a lower-third to this scene: \u201C${input.text}\u201D.`,
      factors: [{ label: 'scene', detail: loaded.beats[at]!.label ?? input.beatId }],
      evidence: [],
      alternatives: [],
    };

    return saveStrip(input, loaded, beats, why, ctx);
  },
});
