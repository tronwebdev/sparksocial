import type { PlatformEngagementRow, ToolCtx } from '@sparksocial/tools/defineTool';
import type { EngagementPlatform, PlatformEngagementSetting } from '@sparksocial/shared/engagementConfig';

/**
 * A brand's per-platform engagement overrides, for the reply path —
 * `Settings WS EI Platforms` (§8.8).
 *
 * Shared by `autohandle` and `replySend` rather than written twice, for the same
 * reason `resolveEngagementEligibility` is: the two tools must reach the same
 * verdict about the same message, and two copies of a null-handling rule is how
 * they stop doing that.
 *
 * Split into a fetch and a pick so the fetch can sit inside the same
 * `Promise.all` as the message read — it needs only the brand, not the platform,
 * so making it wait for the message would add a round trip to every reply for a
 * table that is usually empty.
 */
export async function listPlatformOverrides(ctx: ToolCtx): Promise<PlatformEngagementRow[]> {
  if (!ctx.brandId) return [];
  return ctx.db.brandEngagement.list(ctx.brandId, ctx.orgId);
}

/**
 * The override for one platform, or `undefined` for "no override" — the common
 * case, and the one that must stay behaving exactly as it did before this table
 * existed.
 */
export function pickPlatformOverride(
  rows: readonly PlatformEngagementRow[],
  platform: EngagementPlatform | undefined,
): PlatformEngagementSetting | undefined {
  if (!platform) return undefined;
  const row = rows.find((r) => r.platform === platform);
  if (!row) return undefined;
  return {
    platform: row.platform,
    /**
     * `null` in the column and `undefined` in the vocabulary both mean "no
     * override on this field", and the distinction matters downstream:
     * `applyPlatformOverride` reads `undefined` as "leave the rung alone". The
     * conversion belongs here — at the one boundary between the column and the
     * rule — rather than at each call site.
     */
    ...(row.autonomy ? { autonomy: row.autonomy as 'off' | 'suggest' | 'auto' } : {}),
    ...(row.engagementTypes
      ? { engagementTypes: row.engagementTypes as Array<'comment' | 'dm' | 'story_reply'> }
      : {}),
    enabled: row.enabled,
  };
}
