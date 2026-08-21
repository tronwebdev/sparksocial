import { LEARNED_CONFIDENCE_THRESHOLD, assetRoleWordList, unlockRouteFor, type AssetRole, type Genome } from '@sparksocial/shared';
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
  /**
   * Which required roles are missing. Feeds `asset.gaps` and the capture session.
   *
   * `AssetRole[]`, not `string[]`: it is filtered straight out of
   * `required_asset_roles`, which the playbook schema already types as
   * `z.array(AssetRole)`. Widening it here cost the callers the exhaustiveness
   * that made these values safe to look up by name — which is how three of them
   * ended up interpolating the raw enum into a sentence instead.
   */
  missingRoles: AssetRole[];
  /**
   * How `missingRoles` gets closed — present only when something is missing.
   *
   * `'capture'` is the Direct+Finish loop: film it. `'upload'` is a file the
   * owner already has. The two want completely different words on screen, and
   * conflating them is what made the product ask a barber to give up a Saturday
   * when a logo upload would have unlocked more.
   */
  unlockedBy?: 'upload' | 'capture';
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

    /**
     * Nothing is discarded for a missing asset any more.
     *
     * This used to reject every non-`direct_finish` playbook whose assets were
     * absent, reasoning that they "cannot be filmed to order". They cannot — but
     * they can be *supplied* to order, which is a different and much cheaper
     * thing, and the code had no way to say so. A brand with an empty library
     * lost fourteen playbooks here silently, including the one that best fitted
     * its own stated objective.
     *
     * A missing role is now always a route rather than a verdict, and
     * `assetAvailabilityFactor` is what keeps the ordering honest: an upload
     * route is handicapped well below a filmed one, so surfacing these cannot
     * push a local brand's month toward library filler — the §6 invariant the
     * golden set exists to protect.
     */
    const unlockedBy = hasAssets ? undefined : unlockRouteFor(missingRoles);

    /* 5 ── Score. §5.2's four multiplicands. */
    const objectiveFit = p.objective_fit[d.objective] ?? 0;
    if (objectiveFit === 0) {
      rejected.push({ playbook_id: p.playbook_id, because: `no fit for objective "${d.objective}"` });
      continue;
    }

    const availability = assetAvailabilityFactor(hasAssets, unlockedBy);
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
      ...(unlockedBy ? { unlockedBy } : {}),
      factors: [
        { label: 'objective fit', detail: `${p.name} scores ${objectiveFit.toFixed(2)} for ${d.objective}`, weight: objectiveFit },
        {
          label: 'assets',
          detail: hasAssets
            ? 'everything this needs already exists'
            : unlockedBy === 'capture'
              ? `needs ${assetRoleWordList(missingRoles)} — reachable with a capture brief`
              : `needs ${assetRoleWordList(missingRoles)} — a file you upload, no filming`,
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
function assetAvailabilityFactor(hasAssets: boolean, unlockedBy: 'upload' | 'capture' | undefined): number {
  if (hasAssets) return 1;
  /**
   * `0.85` for filming, `0.35` for uploading — a wide gap on purpose.
   *
   * Filming stays close to 1 because §6 is explicit that a local brand's month
   * should be footage it was told how to shoot, and that unlockable capture work
   * must outrank anything producible today rather than merely appear.
   *
   * The upload route used to be `0`, which was consistent only because those
   * playbooks were thrown away before scoring. Now that they are offered it has
   * to be a real number, and it has to stay far enough below `0.85` that every
   * filmable format still outranks every uploadable one for a brand that can
   * film. It also has to be non-zero, or a SaaS brand — which no capture
   * playbook fits on dimensions at all — would get its entire library tied at
   * zero and ordered arbitrarily.
   */
  return unlockedBy === 'capture' ? 0.85 : 0.35;
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
