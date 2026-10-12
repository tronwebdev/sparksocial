import { describe, expect, it } from 'vitest';
import type { PlatformEngagementRow, ToolCtx } from '@sparksocial/tools';
import { listPlatformOverrides, pickPlatformOverride } from '../src/platformOverride.js';

/**
 * The reply path's one reading of `brand_engagement_settings`.
 *
 * The rule these guard is that an absent row must behave *exactly* as the system
 * behaved before the table existed. Every brand in the database is in that state,
 * so a mistake here is not a mistake about a new feature — it is a change to how
 * every existing brand replies.
 */

function ctx(over: { brandId?: string; rows?: unknown[]; onList?: () => void } = {}): ToolCtx {
  return {
    orgId: 'org_1',
    ...(over.brandId === null ? {} : { brandId: over.brandId ?? 'brand_1' }),
    db: {
      brandEngagement: {
        list: async () => {
          over.onList?.();
          return over.rows ?? [];
        },
      },
    },
  } as unknown as ToolCtx;
}

describe('listPlatformOverrides', () => {
  it('returns nothing and queries nothing without a brand', async () => {
    /**
     * The engagement webhook path can build a ctx without a brand. Querying on a
     * missing brand id would either throw or — worse — return another brand's
     * rows if the predicate were ever written wrong.
     */
    let queried = false;
    const rows = await listPlatformOverrides(
      ctx({ brandId: null as unknown as string, onList: () => (queried = true) }),
    );
    expect(rows).toEqual([]);
    expect(queried).toBe(false);
  });

  it('returns the brand’s rows', async () => {
    const rows = await listPlatformOverrides(
      ctx({ rows: [{ platform: 'x', autonomy: null, engagementTypes: null, enabled: true }] }),
    );
    expect(rows).toHaveLength(1);
  });
});

describe('pickPlatformOverride', () => {
  const rows: PlatformEngagementRow[] = [
    { platform: 'x', autonomy: 'off', engagementTypes: null, enabled: true },
    { platform: 'instagram', autonomy: null, engagementTypes: ['comment'], enabled: false },
  ];

  it('is undefined for a platform with no row', () => {
    // The common case, and the one that must stay free of behaviour.
    expect(pickPlatformOverride(rows, 'tiktok')).toBeUndefined();
  });

  it('is undefined when the message has no platform', () => {
    expect(pickPlatformOverride(rows, undefined)).toBeUndefined();
  });

  it('converts a null column to an absent field, not to a value', () => {
    /**
     * The conversion this file exists for. `applyPlatformOverride` reads
     * `undefined` as "leave the rung alone" and would read a literal `null` as a
     * value — so a row that overrides only the types must come back with no
     * `autonomy` key at all.
     */
    const ig = pickPlatformOverride(rows, 'instagram')!;
    expect('autonomy' in ig).toBe(false);
    expect(ig.engagementTypes).toEqual(['comment']);
    expect(ig.enabled).toBe(false);
  });

  it('carries an explicit autonomy through', () => {
    const x = pickPlatformOverride(rows, 'x')!;
    expect(x.autonomy).toBe('off');
    expect('engagementTypes' in x).toBe(false);
  });
});
