import { PASS, type CheckResult } from './types.js';

/**
 * RIGHTS — engine spec §10: "Music licensing, UGC permissions, client-asset
 * scope, likeness consent for cloning (store explicit consent record with
 * timestamp and scope)."
 *
 * This is deliberately the strictest guardrail in the file — everything else
 * here is `flag` or `block` depending on severity; every branch of `rights`
 * blocks, because a rights violation is not something a human should be asked
 * to wave through casually in Review. §10: *"Cloning a third party is blocked
 * at the tool layer, not the prompt layer"* — this module is that block.
 *
 * Music licensing is out of scope until a licensed-audio asset type exists
 * (master plan Tier 3, v1.1) — not stubbed with a fake pass.
 */

export interface RightsInput {
  /** rightsStatus of every asset this draft references. */
  referencedAssetRights: Array<{ assetId: string; rightsStatus: string }>;
  /** True if the playbook needs a cloned face/voice (Playbook.preconditions.requires_likeness_license). */
  requiresLikenessLicense: boolean;
  /** `consent.hasActive(genomeId, orgId, 'avatar_clone')` — true only once a likeness-consent record is on file and unrevoked (§10). */
  avatarEnabled: boolean;
}

export function rights(input: RightsInput): CheckResult {
  const uncleared = input.referencedAssetRights.filter((a) => a.rightsStatus !== 'cleared');
  if (uncleared.length > 0) {
    return {
      verdict: 'block',
      rule: 'rights',
      evidence: { uncleared: uncleared.map((a) => a.assetId) },
      fixAction: `Asset(s) ${uncleared.map((a) => a.assetId).join(', ')} are not rights-cleared — resolve consent/licensing before this can be scheduled.`,
    };
  }

  // Defense in depth: the resolver already refuses to reach a likeness-requiring
  // playbook when avatar_enabled is false (§5.2), but a guardrail that trusted
  // the caller to have checked upstream would not be a guardrail.
  if (input.requiresLikenessLicense && !input.avatarEnabled) {
    return {
      verdict: 'block',
      rule: 'rights',
      evidence: { requiresLikenessLicense: true, avatarEnabled: false },
      fixAction: 'This format clones a face/voice, but no likeness consent record is on file for this genome.',
    };
  }

  return PASS;
}
