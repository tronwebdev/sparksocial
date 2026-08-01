import { PASS, type CheckResult } from './types.js';

/**
 * AVATAR SATURATION — engine spec §10:
 *
 *   *"Cap avatar-mode output as a percentage of total. If every SparkSocial
 *   account leans on avatar video, accounts converge on an identical look and
 *   platforms suppress the pattern."*
 *
 * `avatar_enabled` gates whether avatar formats are reachable at all (enforced
 * upstream in `packages/playbooks/src/resolver.ts`, §5.2/§10 — a barbershop
 * never even resolves an avatar playbook). This guardrail is the second,
 * independent line of defense: even for a genome where avatar IS legitimately
 * available (a freelancer, a coach), it caps *how much* of the output leans on
 * it, so the account doesn't converge on looking like every other one.
 */

const DEFAULT_CAP = 0.3; // avatar/cloned-likeness content should not dominate even where it's earned its place

export interface AvatarSaturationInput {
  /** Whether the draft under evaluation is itself an avatar/likeness format. */
  isAvatarFormat: boolean;
  /** How many of the trailing window's items were avatar format, before this one. */
  recentAvatarCount: number;
  /** Total items in that same trailing window. */
  recentTotalCount: number;
  capRatio?: number;
}

export function avatarSaturation(input: AvatarSaturationInput): CheckResult {
  if (!input.isAvatarFormat) return PASS;

  const cap = input.capRatio ?? DEFAULT_CAP;
  const projectedTotal = input.recentTotalCount + 1;
  const projectedAvatar = input.recentAvatarCount + 1;
  const projectedRatio = projectedAvatar / projectedTotal;

  if (projectedRatio <= cap) return PASS;

  return {
    verdict: 'flag',
    rule: 'avatar_saturation',
    evidence: { projectedRatio: Number(projectedRatio.toFixed(3)), cap, recentAvatarCount: input.recentAvatarCount, recentTotalCount: input.recentTotalCount },
    fixAction: `Publishing this would put avatar content at ${(projectedRatio * 100).toFixed(0)}% of recent output, above the ${(cap * 100).toFixed(0)}% cap — swap in an Assemble or Direct+Finish format instead.`,
  };
}
