import { LEARNED_CONFIDENCE_THRESHOLD, type Genome } from '@sparksocial/shared';
import type { AssetInventory } from './golden.js';
import { PLAYBOOKS } from './records.js';
import type { Playbook } from './schema.js';

/**
 * THE PLAYBOOK RESOLVER — engine spec §5.2.
 *
 * Pure function: `(genome, asset inventory) → ranked playbooks`. No I/O, no clock,
 * no niche lookup. This is the component that has to make an unanticipated business
 * type work, so it is deliberately small enough to read in one sitting.
 *
 * The rule that carries the most weight is the last filter: a `direct_finish`
 * playbook whose assets are missing is **not discarded**. It comes back marked
 * `unlockable`, and that gap is what the capture loop consumes. Drop that rule and
 * every local business resolves to an empty month.
 */

export interface ResolvedPlaybook {
  playbook: Playbook;
  score: number;
  /** True when the assets do not exist yet but a capture brief could create them. */
  unlockable: boolean;
  /** Which required roles are missing. Feeds `asset.gaps` and the capture session. */
  missingRoles: string[];
  /** Human-readable scoring breakdown for the `why` payload. */
  factors: Array<{ label: string; detail: string; weight?: number }>;
}

export interface Resolution {
  ranked: ResolvedPlaybook[];
  /** Playbooks excluded, with the dimension that ruled them out. */
  rejected: Array<{ playbook_id: string; because: string }>;
}

export function resolve(genome: Genome, assets: AssetInventory, library: readonly Playbook[] = PLAYBOOKS): Resolution {
  const { dimensions: d, constraints } = genome;
  const ranked: ResolvedPlaybook[] = [];
  const rejected: Resolution['rejected'] = [];

  for (const p of library) {
    if (!p.is_active) {
      rejected.push({ playbook_id: p.playbook_id, because: 'inactive' });
      continue;
    }

    const pre = p.preconditions;

    /* 1 ── Dimension preconditions. Absent means "no constraint on this axis". */
    if (pre.proof_asset_any?.length && !pre.proof_asset_any.some((v) => d.proof_asset.includes(v))) {
      rejected.push({
        playbook_id: p.playbook_id,
        because: `needs proof asset ${pre.proof_asset_any.join('/')}, genome has ${d.proof_asset.join('/')}`,
      });
      continue;
    }

    if (
      pre.capture_capability_any?.length &&
      !pre.capture_capability_any.some((v) => d.capture_capability.includes(v))
    ) {
      rejected.push({
        playbook_id: p.playbook_id,
        because: `needs capture ${pre.capture_capability_any.join('/')}, genome has ${d.capture_capability.join('/')}`,
      });
      continue;
    }

    /* 2 ── Talent. A human must exist to film or clone. */
    if (pre.talent_required && d.talent_availability === 'no') {
      rejected.push({ playbook_id: p.playbook_id, because: 'nobody is available to be on camera' });
      continue;
    }

    /* 3 ── Likeness licensing. Engine spec §10 — this is the gate that keeps an
     *      avatar away from a barbershop. `avatar_enabled` defaults false for any
     *      genome whose proof asset is not a person, so the check is on the
     *      derived constraint rather than on talent availability alone: a shop
     *      whose staff will be *filmed* must not thereby become clonable. */
    if (pre.requires_likeness_license && !constraints.avatar_enabled) {
      rejected.push({
        playbook_id: p.playbook_id,
        because: 'avatar/voice cloning is off for this genome (proof asset is not a licensed person)',
      });
      continue;
    }

    /* 4 ── Asset availability. */
    const missingRoles = pre.required_asset_roles.filter((role) => (assets[role] ?? 0) < Math.max(1, pre.min_assets));
    const held = pre.required_asset_roles.reduce((n, role) => n + (assets[role] ?? 0), 0);
    const hasAssets = missingRoles.length === 0 && held >= pre.min_assets;

    if (!hasAssets && p.mode !== 'direct_finish') {
      rejected.push({
        playbook_id: p.playbook_id,
        because: `missing ${missingRoles.join(', ')} and cannot be filmed to order`,
      });
      continue;
    }

    /* 5 ── Score. §5.2's four multiplicands. */
    const objectiveFit = p.objective_fit[d.objective] ?? 0;
    if (objectiveFit === 0) {
      rejected.push({ playbook_id: p.playbook_id, because: `no fit for objective "${d.objective}"` });
      continue;
    }

    const availability = assetAvailabilityFactor(hasAssets, p);
    const saturation = 1 - saturationPenalty(p);
    const learned = learnedMultiplier(genome, p);

    // A secondary objective contributes at a discount — it is a tiebreaker, not a
    // second primary, or the mix drifts toward whatever serves two goals weakly.
    const secondary =
      d.secondary_objectives.reduce((best, o) => Math.max(best, p.objective_fit[o] ?? 0), 0) * 0.25;

    const score = (objectiveFit + secondary) * availability * saturation * learned;

    ranked.push({
      playbook: p,
      score,
      unlockable: !hasAssets,
      missingRoles,
      factors: [
        { label: 'objective fit', detail: `${p.name} scores ${objectiveFit.toFixed(2)} for ${d.objective}`, weight: objectiveFit },
        {
          label: 'assets',
          detail: hasAssets
            ? 'everything this needs already exists'
            : `needs ${missingRoles.join(', ')} — reachable with a capture brief`,
          weight: availability,
        },
        { label: 'saturation', detail: `${p.saturation_risk} risk of looking like every other AI account`, weight: saturation },
      ],
    });
  }

  ranked.sort((a, b) => b.score - a.score || a.playbook.playbook_id.localeCompare(b.playbook.playbook_id));
  return { ranked, rejected };
}

/**
 * Producible now beats needs-filming, but not by so much that the capture loop
 * never surfaces. A local business has nothing digital on day one; if this
 * discount were harsh, its whole month would rank below a generic quote card.
 */
function assetAvailabilityFactor(hasAssets: boolean, p: Playbook): number {
  if (hasAssets) return 1;
  return p.mode === 'direct_finish' ? 0.85 : 0;
}

/**
 * Engine spec §10: cap formats that make every SparkSocial account look alike.
 * High-saturation formats are not banned — they are handicapped, so they win only
 * when they genuinely fit.
 */
function saturationPenalty(p: Playbook): number {
  switch (p.saturation_risk) {
    case 'low':
      return 0;
    case 'medium':
      return 0.15;
    case 'high':
      return 0.35;
  }
}

/** 1.0 until the learning loop has earned the right to move it (§3.2, §7.2). */
function learnedMultiplier(genome: Genome, p: Playbook): number {
  const { learned } = genome;
  if (learned.confidence <= LEARNED_CONFIDENCE_THRESHOLD) return 1;
  return learned.top_formats.includes(p.playbook_id) ? 1.25 : 0.95;
}
