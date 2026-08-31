import { assetRoleLabel, type AssetRole } from '@sparksocial/shared';

/**
 * `AssetRole` in the order the pickers show it, labelled from the one shared
 * record.
 *
 * The order is the only thing this file decides — a UI judgement about which
 * roles a brand most likely has, which does not belong in `packages/shared`.
 * The *words* come from `ASSET_ROLE_WORDS`, so a dropdown can no longer disagree
 * with the sentences the server writes. They previously did: "Physical capture"
 * in this list sat two lines below "physical_capture would unlock the most" in
 * the panel above it.
 *
 * This import is the thing CLAUDE.md always permitted and the build always
 * refused — see `next.config.ts`'s `extensionAlias` for what was actually in
 * the way.
 */
const ORDER: readonly AssetRole[] = [
  'talent_likeness',
  'product_screen',
  'work_artifact',
  'physical_capture',
  'product_shot',
  'social_proof',
  'knowledge',
  'past_post',
  'brand_kit',
];

export const ASSET_ROLES = ORDER.map((value) => ({ value, label: assetRoleLabel(value) }));
