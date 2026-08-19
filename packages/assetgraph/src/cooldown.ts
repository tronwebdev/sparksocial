import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { DEFAULT_COOLDOWN_DAYS } from '@sparksocial/guardrails';

/**
 * `asset.cooldown.check` — a pre-flight read of the same reuse-cooldown
 * signal `guard.duplicate` enforces at publish time (`packages/guardrails/src/duplicate.ts`).
 * That guardrail only runs once a draft is fully assembled and someone tries
 * to publish it; this lets a caller ask "is this asset safe to use" *before*
 * building around it, so a blocked choice never gets that far. Same default
 * cooldown window as the guardrail, imported rather than duplicated, so the
 * two can never silently disagree.
 */

export const AssetCooldownCheckInput = z.object({
  genomeId: z.string().min(1),
  assetIds: z.array(z.string().min(1)).min(1).max(50),
  cooldownDays: z.number().int().min(1).max(90).optional(),
});

const AssetCooldownResult = z.object({
  assetId: z.string(),
  inCooldown: z.boolean(),
  lastUsedDaysAgo: z.number().optional(),
  found: z.boolean(),
});

export const assetCooldownCheck = defineTool({
  name: 'asset.cooldown.check',
  version: 1,

  summary:
    'Check whether one or more assets are still within their reuse-cooldown window before building a draft around ' +
    'them — the same check `guard.duplicate` enforces at publish time, run early so a blocked choice is caught sooner.',

  input: AssetCooldownCheckInput,
  output: z.object({ results: z.array(AssetCooldownResult), cooldownDays: z.number() }),

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,

  async handler(input, ctx) {
    const cooldownDays = input.cooldownDays ?? DEFAULT_COOLDOWN_DAYS;
    const info = await ctx.db.assets.info(input.assetIds, input.genomeId, ctx.orgId);

    const results = input.assetIds.map((assetId) => {
      const found = info[assetId];
      if (!found) return { assetId, inCooldown: false, found: false };
      const lastUsedDaysAgo = found.lastUsedDaysAgo;
      return {
        assetId,
        inCooldown: lastUsedDaysAgo !== undefined && lastUsedDaysAgo < cooldownDays,
        ...(lastUsedDaysAgo !== undefined ? { lastUsedDaysAgo } : {}),
        found: true,
      };
    });

    return { results, cooldownDays };
  },
});
