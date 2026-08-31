import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import {
  EngagementKind,
  EngagementPlatform,
  resolvePlatformEngagement,
} from '@sparksocial/shared/engagementConfig';

/**
 * `Settings WS EI Platforms` — the per-platform engagement matrix, `4.3`.
 *
 * Engagement config was one global value per brand, while `engage.ingest` has
 * always carried a platform and a kind. So the inbound dimension existed and the
 * outbound decision had nowhere to live: a brand could not answer comments on
 * Instagram while staying silent on X.
 *
 * ── Two tools, and the read is the interesting one ────────────────────────
 *
 * `brand.engagement.platforms.get` returns **every** platform with its
 * *effective* setting and whether that setting is inherited — not just the rows
 * that exist. A screen given only the overrides would have to reconstruct the
 * fallback itself, which is exactly how two readers of one setting come to
 * disagree; `resolvePlatformEngagement` is the single definition and this returns
 * its output.
 *
 * `brand.engagement.platforms.set` writes one platform. Clearing a field is
 * distinct from leaving it alone: `null` goes back to inheriting the brand value,
 * `undefined` does not touch it. Conflating them would make "stop overriding
 * autonomy on Instagram" unexpressible.
 */

const PLATFORMS = EngagementPlatform.options;

const EffectivePlatform = z.object({
  platform: EngagementPlatform,
  autonomy: z.enum(['off', 'suggest', 'auto']),
  /** The kinds SPARK may answer. Empty means all of them, matching the brand-level rule. */
  engagementTypes: z.array(z.string()),
  enabled: z.boolean(),
  /** True when this platform has no override of its own and is following the brand. */
  inherited: z.boolean(),
  /**
   * Per-field, because the row-level `inherited` cannot answer what the screen
   * has to ask.
   *
   * A row that overrides only the message types still *inherits* autonomy, and a
   * row whose stored autonomy happens to equal the brand's is still an override —
   * it stops tracking the brand the moment the brand changes. Without these two
   * the settings screen would have to guess which control to draw as "following
   * my default", and it would guess wrong in exactly the case where the two
   * values coincide.
   */
  autonomyInherited: z.boolean(),
  typesInherited: z.boolean(),
});

export const BrandEngagementPlatformsGetInput = z.object({
  brandId: z.string().min(1).optional(),
});

export const BrandEngagementPlatformsGetOutput = z.object({
  brandId: z.string(),
  /** The brand-level values these fall back to, so the screen can label the default. */
  brandAutonomy: z.enum(['off', 'suggest', 'auto']),
  brandEngagementTypes: z.array(z.string()),
  platforms: z.array(EffectivePlatform),
});

export const brandEngagementPlatformsGet = defineTool({
  name: 'brand.engagement.platforms.get',
  version: 1,

  summary:
    'How SPARK is set to engage on each platform — the effective setting for all five, and whether each ' +
    'is following the brand default or overriding it. Read-only, free.',

  input: BrandEngagementPlatformsGetInput,
  output: BrandEngagementPlatformsGetOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,
  surfaces: ['SET-WS-EI-PLATFORMS'],

  async handler(input, ctx) {
    const brandId = input.brandId ?? ctx.brandId;
    if (!brandId) throw new ToolError('INVALID_INPUT', 'No brand selected.', {});

    const [brand, rows] = await Promise.all([
      ctx.db.brands.get(brandId, ctx.orgId),
      ctx.db.brandEngagement.list(brandId, ctx.orgId),
    ]);

    const byPlatform = new Map(rows.map((r) => [r.platform, r]));
    const brandAutonomy = brand.engagementAutonomy ?? 'off';
    const brandTypes = brand.engagementTypes;

    return {
      brandId,
      brandAutonomy,
      brandEngagementTypes: brandTypes ?? [],
      /**
       * Every platform, always — including the four a brand has never touched.
       * A matrix that only showed configured rows would make "not configured"
       * indistinguishable from "not offered", and the screen is a matrix.
       */
      platforms: PLATFORMS.map((platform) => {
        const row = byPlatform.get(platform);
        const eff = resolvePlatformEngagement({
          platform,
          brandAutonomy,
          brandTypes,
          row: row
            ? {
                platform,
                ...(row.autonomy ? { autonomy: row.autonomy as 'off' | 'suggest' | 'auto' } : {}),
                ...(row.engagementTypes
                  ? { engagementTypes: row.engagementTypes as Array<'comment' | 'dm' | 'story_reply'> }
                  : {}),
                enabled: row.enabled,
              }
            : undefined,
        });
        return {
          platform,
          autonomy: eff.autonomy,
          engagementTypes: [...(eff.types ?? [])],
          enabled: eff.enabled,
          inherited: eff.inherited,
          // Read off the stored row rather than compared against the brand: a
          // stored value equal to the brand's is still an override.
          autonomyInherited: !row?.autonomy,
          typesInherited: !row?.engagementTypes,
        };
      }),
    };
  },
});

export const BrandEngagementPlatformsSetInput = z.object({
  brandId: z.string().min(1).optional(),
  platform: EngagementPlatform,
  /**
   * `null` clears the override so this platform inherits the brand again;
   * omitting the field leaves whatever is there. Those are different operations.
   */
  autonomy: z.enum(['off', 'suggest', 'auto']).nullable().optional(),
  engagementTypes: z.array(EngagementKind).max(3).nullable().optional(),
  /** False silences the platform entirely, whatever autonomy or types say. */
  enabled: z.boolean().optional(),
  /** True removes the row completely — the cleanest way back to "follows the brand". */
  clear: z.boolean().optional(),
});

export const BrandEngagementPlatformsSetOutput = z.object({
  brandId: z.string(),
  platform: EngagementPlatform,
  cleared: z.boolean(),
  why: Explanation,
});

export const brandEngagementPlatformsSet = defineTool({
  name: 'brand.engagement.platforms.set',
  version: 1,

  summary:
    'Override how SPARK engages on one platform, or clear the override so it follows the brand again. ' +
    'Free.',

  input: BrandEngagementPlatformsSetInput,
  output: BrandEngagementPlatformsSetOutput,

  effect: 'write',
  /**
   * `human_only`. This decides whether the agent may answer strangers unattended
   * on a given platform, and an agent widening its own permission is the one
   * change that must never be automatic — the same reasoning
   * `approval.policy.set` and `team.*` already carry.
   */
  autonomy: 'human_only',
  scopes: ['owner', 'admin'],
  // Setting a platform to a given configuration replays safely to that same
  // configuration; the upsert is keyed on (brand, platform).
  idempotent: true,
  surfaces: ['SET-WS-EI-PLATFORMS'],

  async handler(input, ctx) {
    const brandId = input.brandId ?? ctx.brandId;
    if (!brandId) throw new ToolError('INVALID_INPUT', 'No brand selected.', {});

    if (input.clear) {
      await ctx.db.brandEngagement.clear(brandId, ctx.orgId, input.platform);
      ctx.logger.info('platform engagement override cleared', { brandId, platform: input.platform });
      return {
        brandId,
        platform: input.platform,
        cleared: true,
        why: {
          summary: `${input.platform} now follows the brand's own engagement setting.`,
          factors: [{ label: 'platform', detail: input.platform }],
          evidence: [],
          alternatives: [],
        },
      };
    }

    if (input.autonomy === undefined && input.engagementTypes === undefined && input.enabled === undefined) {
      // Refused rather than treated as a no-op: a call that names a platform and
      // changes nothing is a caller bug, and answering "done" would hide it.
      throw new ToolError(
        'INVALID_INPUT',
        'Nothing to change — pass autonomy, engagementTypes, enabled, or clear.',
        { platform: input.platform },
      );
    }

    const row = await ctx.db.brandEngagement.set({
      brandId,
      orgId: ctx.orgId,
      platform: input.platform,
      ...(input.autonomy !== undefined ? { autonomy: input.autonomy } : {}),
      ...(input.engagementTypes !== undefined ? { engagementTypes: input.engagementTypes } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    });

    const said = !row.enabled
      ? `SPARK will not engage on ${input.platform} at all.`
      : `On ${input.platform}: ${row.autonomy ?? "the brand's autonomy"}, ` +
        `${row.engagementTypes?.length ? row.engagementTypes.join(' and ') : 'all message types'}.`;

    ctx.logger.info('platform engagement set', {
      brandId,
      platform: input.platform,
      by: ctx.userId ?? 'unknown',
    });

    return {
      brandId,
      platform: input.platform,
      cleared: false,
      why: {
        summary: said,
        factors: [
          { label: 'platform', detail: input.platform },
          // Named because it is the thing people get wrong about this screen: the
          // rung on the campaign still governs, and this narrows rather than widens.
          {
            label: 'still capped by',
            detail: "the campaign's engagement rung — a platform override cannot exceed it",
          },
        ],
        evidence: [],
        alternatives: [],
      },
    };
  },
});
