import { z } from 'zod';
import { AssetRole, ToolError } from '@sparksocial/shared';
import type { Genome } from '@sparksocial/shared/genome';
import type { Beat, Playbook } from '@sparksocial/playbooks';

/**
 * BEAT ASSEMBLY — the middle of the Assemble pipeline (plan §6.5).
 *
 *   `asset.retrieve → [Playwright capture] → **beat assembly** → compose.render`
 *
 * A playbook's `structure.beats` is a template: an ordered list of slots, each
 * either generated copy (`prompt_ref`) or something the brand already owns
 * (`source`). This module turns that template plus a genome plus retrieved
 * assets into a **RenderPlan** — a concrete, fully-resolved description of what
 * to render, with no lookups left to do.
 *
 * It is pure. No I/O, no model calls, no database. Retrieval happens before it
 * and rendering happens after it, which is what makes the interesting part —
 * which asset landed in which beat, and why — testable without either.
 *
 * ── The failure that matters ───────────────────────────────────────────────
 * When a beat needs `asset:product_screen` and the Asset Graph has none, this
 * does **not** quietly drop the beat or substitute a neighbour. It fails with
 * the roles it could not fill. That gap is a product signal, not an error to
 * paper over: it is exactly what `direct.brief.generate` exists to close, and a
 * silently shortened video would hide the one thing the capture loop needs to
 * know.
 */

/* ── Beat sources ──────────────────────────────────────────────────── */

/**
 * `source` is a small URI-ish language, already used by the playbook records:
 *
 *   `asset:<asset_role>`  — fill from the Asset Graph
 *   `genome:<dot.path>`   — fill from the brand genome (e.g. offer.primary_cta)
 *
 * Parsed rather than pattern-matched per call site so that an unknown scheme is
 * a loud error in one place. A typo in a playbook record is a data bug, and
 * playbooks are data (CLAUDE.md invariant 5) — the engine must reject it
 * clearly instead of rendering a beat that silently shows nothing.
 */
export type BeatSource =
  | { kind: 'asset'; role: AssetRole }
  | { kind: 'genome'; path: string };

export function parseBeatSource(source: string): BeatSource {
  const [scheme, ...rest] = source.split(':');
  const value = rest.join(':');
  if (!value) {
    throw new ToolError('INVALID_INPUT', `Beat source "${source}" has no value after the scheme.`, { source });
  }

  if (scheme === 'asset') {
    const role = AssetRole.safeParse(value);
    if (!role.success) {
      throw new ToolError('INVALID_INPUT', `Beat source "${source}" names an unknown asset role.`, { source });
    }
    return { kind: 'asset', role: role.data };
  }

  if (scheme === 'genome') return { kind: 'genome', path: value };

  throw new ToolError('INVALID_INPUT', `Beat source "${source}" uses an unknown scheme.`, { source });
}

/* ── The render plan ───────────────────────────────────────────────── */

/**
 * One resolved beat. `kind` is what the renderer switches on, and the three
 * variants are deliberately not collapsed into an optional-everything object:
 * a renderer that has to guess whether a beat is copy or footage is a renderer
 * that will guess wrong.
 */
export const PlannedBeat = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('asset'),
    beatId: z.string(),
    durationSec: z.number(),
    role: AssetRole,
    assetId: z.string(),
    caption: z.string().nullable(),
    /** Retrieval score, carried through so the Why popover can show the ranking. */
    score: z.number(),
  }),
  z.object({
    kind: z.literal('copy'),
    beatId: z.string(),
    durationSec: z.number(),
    /** Prompt-library key. The copy itself is written later, voice-matched. */
    promptRef: z.string(),
  }),
  z.object({
    kind: z.literal('text'),
    beatId: z.string(),
    durationSec: z.number(),
    /** Literal text lifted from the genome, e.g. the primary CTA. */
    text: z.string(),
    genomePath: z.string(),
  }),
]);
export type PlannedBeat = z.infer<typeof PlannedBeat>;

export const RenderPlan = z.object({
  playbookId: z.string(),
  genomeId: z.string(),
  mediaType: z.enum(['video', 'image', 'carousel', 'text']),
  aspectRatios: z.array(z.string()).min(1),
  beats: z.array(PlannedBeat).min(1),
  totalDurationSec: z.number(),
});
export type RenderPlan = z.infer<typeof RenderPlan>;

/* ── Inputs ────────────────────────────────────────────────────────── */

/** One candidate from `asset.retrieve`, already genome-scoped by the repository. */
export interface RetrievedAsset {
  assetId: string;
  role: AssetRole;
  caption: string | null;
  score: number;
}

export interface BuildPlanArgs {
  playbook: Playbook;
  genome: Genome;
  /** Ranked candidates. Order is respected: the best-scoring unused asset wins. */
  assets: RetrievedAsset[];
}

export interface BuildPlanResult {
  plan: RenderPlan;
  /** Roles a beat asked for and retrieval could not supply. Empty on success. */
  missingRoles: AssetRole[];
}

/* ── Assembly ──────────────────────────────────────────────────────── */

export function buildRenderPlan(args: BuildPlanArgs): BuildPlanResult {
  const { playbook, genome, assets } = args;

  if (playbook.mode !== 'assemble') {
    // Synthesize and Direct+Finish reach `compose.render` by different routes
    // (§6.5). Planning them here would produce a plan whose beats nothing has
    // generated or filmed yet.
    throw new ToolError('INVALID_INPUT', `${playbook.playbook_id} is a ${playbook.mode} playbook, not assemble.`, {
      playbookId: playbook.playbook_id,
      mode: playbook.mode,
    });
  }

  // Highest score first, so "best available" is well-defined regardless of the
  // order retrieval happened to return.
  const byRole = new Map<AssetRole, RetrievedAsset[]>();
  for (const asset of [...assets].sort((a, b) => b.score - a.score)) {
    const list = byRole.get(asset.role) ?? [];
    list.push(asset);
    byRole.set(asset.role, list);
  }

  const used = new Set<string>();
  const beats: PlannedBeat[] = [];
  const missing: AssetRole[] = [];

  for (const beat of playbook.structure.beats) {
    const planned = planBeat(beat, genome, byRole, used, missing);
    if (planned) beats.push(planned);
  }

  if (missing.length > 0) {
    throw new ToolError(
      'NOT_FOUND',
      `The Asset Graph has nothing for: ${[...new Set(missing)].join(', ')}.`,
      { missingRoles: [...new Set(missing)], playbookId: playbook.playbook_id },
    );
  }

  const totalDurationSec = round1(beats.reduce((sum, b) => sum + b.durationSec, 0));
  assertDurationInRange(playbook, totalDurationSec);

  return {
    plan: {
      playbookId: playbook.playbook_id,
      genomeId: genome.genome_id,
      mediaType: playbook.output.media_type,
      aspectRatios: [...playbook.output.aspect_ratios],
      beats,
      totalDurationSec,
    },
    missingRoles: [],
  };
}

function planBeat(
  beat: Beat,
  genome: Genome,
  byRole: Map<AssetRole, RetrievedAsset[]>,
  used: Set<string>,
  missing: AssetRole[],
): PlannedBeat | undefined {
  if (beat.source) {
    const source = parseBeatSource(beat.source);

    if (source.kind === 'genome') {
      const text = readGenomePath(genome, source.path);
      if (!text) {
        // A genome beat with nothing behind it is a *content* gap, not an asset
        // gap: the brand has not told us its CTA yet. Rendering an empty frame
        // would be worse than refusing.
        throw new ToolError('NOT_FOUND', `The genome has no value at "${source.path}".`, {
          genomePath: source.path,
          beatId: beat.id,
        });
      }
      return { kind: 'text', beatId: beat.id, durationSec: beat.duration_sec, text, genomePath: source.path };
    }

    // Never reuse one asset for two beats in the same post: the same photo
    // twice in fifteen seconds is the "reads as automated" failure the
    // retrieval penalties exist to avoid, and it would be pointless to rank for
    // diversity and then undo it here.
    const candidate = (byRole.get(source.role) ?? []).find((a) => !used.has(a.assetId));
    if (!candidate) {
      missing.push(source.role);
      return undefined;
    }
    used.add(candidate.assetId);
    return {
      kind: 'asset',
      beatId: beat.id,
      durationSec: beat.duration_sec,
      role: candidate.role,
      assetId: candidate.assetId,
      caption: candidate.caption,
      score: candidate.score,
    };
  }

  if (beat.prompt_ref) {
    return { kind: 'copy', beatId: beat.id, durationSec: beat.duration_sec, promptRef: beat.prompt_ref };
  }

  throw new ToolError('INVALID_INPUT', `Beat "${beat.id}" has neither a source nor a prompt_ref.`, {
    beatId: beat.id,
  });
}

/**
 * Dotted lookup into the genome, e.g. `offer.primary_cta`.
 *
 * Returns undefined for anything that is not a non-empty string: a beat renders
 * text, and an object or a number arriving here means the playbook points at
 * the wrong path. Silently stringifying it would put `[object Object]` on
 * someone's Instagram.
 */
export function readGenomePath(genome: Genome, path: string): string | undefined {
  let current: unknown = genome;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    // Own-property only: a path like `constructor.name` must not resolve.
    if (!Object.prototype.hasOwnProperty.call(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' && current.trim() ? current : undefined;
}

/**
 * The playbook declares an intended duration band; the beats declare their own
 * lengths. They are authored separately and can drift apart, and a 45-second
 * cut submitted to a format specified as 15–30 is a post that reads as
 * off-format rather than a crash — so it is checked rather than assumed.
 */
function assertDurationInRange(playbook: Playbook, totalSec: number): void {
  const band = playbook.output.duration_sec;
  if (!band) return; // images and carousels have no duration
  const [min, max] = band;
  if (totalSec < min || totalSec > max) {
    throw new ToolError(
      'INVALID_INPUT',
      `${playbook.playbook_id} beats total ${totalSec}s, outside its declared ${min}–${max}s.`,
      { playbookId: playbook.playbook_id, totalSec, min, max },
    );
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;
