import { describe, expect, it } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools';
import { ToolError } from '@sparksocial/shared';
import {
  brandEngagementPlatformsGet,
  brandEngagementPlatformsSet,
} from '../src/engagementPlatforms.js';

/**
 * `Settings WS EI Platforms` — the per-platform engagement matrix.
 *
 * The interesting assertions are about the *read*: a matrix that only returned
 * the rows that exist would leave the screen reconstructing the fallback itself,
 * which is precisely how two readers of one setting come to disagree.
 */

interface Row {
  platform: string;
  autonomy: string | null;
  engagementTypes: string[] | null;
  enabled: boolean;
}

function ctx(
  over: {
    rows?: Row[];
    brandAutonomy?: 'off' | 'suggest' | 'auto';
    brandTypes?: string[];
    noBrand?: boolean;
    calls?: unknown[];
  } = {},
): ToolCtx {
  const calls = over.calls ?? [];
  return {
    orgId: 'org_1',
    ...(over.noBrand ? {} : { brandId: 'brand_1' }),
    userId: 'user_owner',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      brands: {
        get: async () => ({
          brandId: 'brand_1',
          engagementAutonomy: over.brandAutonomy ?? 'suggest',
          ...(over.brandTypes ? { engagementTypes: over.brandTypes } : {}),
        }),
      },
      brandEngagement: {
        list: async () => over.rows ?? [],
        set: async (args: Record<string, unknown>) => {
          calls.push(args);
          return {
            platform: args.platform,
            autonomy: (args.autonomy as string | undefined) ?? null,
            engagementTypes: (args.engagementTypes as string[] | undefined) ?? null,
            enabled: (args.enabled as boolean | undefined) ?? true,
          };
        },
        clear: async (...a: unknown[]) => {
          calls.push({ cleared: a });
        },
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

describe('brand.engagement.platforms.get', () => {
  it('returns every platform, not only the configured ones', async () => {
    /**
     * A brand with no rows is the state every existing brand is in. If the read
     * returned nothing, "not configured" and "not offered" would be
     * indistinguishable on a screen whose whole job is to show five rows.
     */
    const out = await brandEngagementPlatformsGet.handler({}, ctx());
    expect(out.platforms.map((p) => p.platform)).toEqual([
      'instagram',
      'tiktok',
      'linkedin',
      'x',
      'youtube_shorts',
    ]);
    expect(out.platforms.every((p) => p.inherited)).toBe(true);
  });

  it('reports the effective setting, not the stored one', async () => {
    const out = await brandEngagementPlatformsGet.handler(
      {},
      ctx({
        brandAutonomy: 'auto',
        brandTypes: ['comment'],
        rows: [{ platform: 'x', autonomy: 'off', engagementTypes: null, enabled: true }],
      }),
    );
    const x = out.platforms.find((p) => p.platform === 'x')!;
    const ig = out.platforms.find((p) => p.platform === 'instagram')!;

    expect(x.autonomy).toBe('off');
    // Not overridden on this row, so still the brand's list — the screen has to
    // be able to say "comments only, inherited".
    expect(x.engagementTypes).toEqual(['comment']);
    expect(x.inherited).toBe(false);

    expect(ig.autonomy).toBe('auto');
    expect(ig.inherited).toBe(true);
  });

  it('reports inheritance per field, not per row', async () => {
    /**
     * The screen draws autonomy and message types as separate controls, so it
     * needs to know which of the two is following the brand. The row-level flag
     * cannot answer that, and the case it gets wrong is the common one: a row
     * that mutes DMs on Instagram and says nothing about autonomy.
     */
    const out = await brandEngagementPlatformsGet.handler(
      {},
      ctx({
        brandAutonomy: 'auto',
        rows: [{ platform: 'instagram', autonomy: null, engagementTypes: ['comment'], enabled: true }],
      }),
    );
    const ig = out.platforms.find((p) => p.platform === 'instagram')!;
    expect(ig.autonomyInherited).toBe(true);
    expect(ig.typesInherited).toBe(false);
  });

  it('calls a stored autonomy an override even when it equals the brand', async () => {
    // It stops tracking the brand the moment the brand changes, so a comparison
    // against the current brand value would mislabel it.
    const out = await brandEngagementPlatformsGet.handler(
      {},
      ctx({
        brandAutonomy: 'suggest',
        rows: [{ platform: 'x', autonomy: 'suggest', engagementTypes: null, enabled: true }],
      }),
    );
    const x = out.platforms.find((p) => p.platform === 'x')!;
    expect(x.autonomyInherited).toBe(false);
  });

  it('names the brand default alongside the rows', async () => {
    // So the screen can label the inherited rows without a second call, and
    // without guessing.
    const out = await brandEngagementPlatformsGet.handler({}, ctx({ brandAutonomy: 'off' }));
    expect(out.brandAutonomy).toBe('off');
  });

  it('refuses without a brand', async () => {
    await expect(brandEngagementPlatformsGet.handler({}, ctx({ noBrand: true }))).rejects.toThrow(
      ToolError,
    );
  });
});

describe('brand.engagement.platforms.set', () => {
  it('writes only the fields the caller named', async () => {
    /**
     * The merge is the point. Two people on the same settings screen — one
     * toggling `enabled`, one changing autonomy — must not overwrite each other,
     * so a call that mentions one field must not carry a value for the other.
     */
    const calls: unknown[] = [];
    await brandEngagementPlatformsSet.handler(
      { platform: 'instagram', enabled: false },
      ctx({ calls }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      brandId: 'brand_1',
      orgId: 'org_1',
      platform: 'instagram',
      enabled: false,
    });
  });

  it('passes null through as a clear of one field', async () => {
    // `null` means "stop overriding autonomy on Instagram"; `undefined` means
    // "leave it". Collapsing them would make the first unexpressible.
    const calls: Array<Record<string, unknown>> = [];
    await brandEngagementPlatformsSet.handler(
      { platform: 'instagram', autonomy: null },
      ctx({ calls }),
    );
    expect(calls[0]!).toHaveProperty('autonomy', null);
  });

  it('deletes the row on clear', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const out = await brandEngagementPlatformsSet.handler(
      { platform: 'x', clear: true },
      ctx({ calls }),
    );
    expect(out.cleared).toBe(true);
    expect(calls[0]!).toHaveProperty('cleared');
  });

  it('refuses a call that would change nothing', async () => {
    /**
     * Not a no-op success. A call naming a platform and no field is a caller bug,
     * and answering "done" would hide it behind a screen that appears to save.
     */
    await expect(
      brandEngagementPlatformsSet.handler({ platform: 'x' }, ctx()),
    ).rejects.toThrow(ToolError);
  });

  it('says in `why` that the campaign rung still caps this', async () => {
    // The thing people get wrong about the screen: an override narrows, it never
    // widens. If the explanation did not say so, the screen would imply otherwise.
    const out = await brandEngagementPlatformsSet.handler(
      { platform: 'tiktok', autonomy: 'auto' },
      ctx(),
    );
    expect(out.why.factors.some((f) => /rung/.test(f.detail ?? ''))).toBe(true);
  });

  it('is human_only', async () => {
    /**
     * Asserted as a schema obligation rather than trusted to review: this decides
     * whether the agent may answer strangers unattended, and an agent widening
     * its own permission is the one change that must never be automatic.
     */
    expect(brandEngagementPlatformsSet.autonomy).toBe('human_only');
    expect(brandEngagementPlatformsSet.scopes).toEqual(['owner', 'admin']);
  });
});
