import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { BrandGovernance, BrandGovernanceStore, ToolCtx } from '@sparksocial/tools';
import { approvalPolicyGet, approvalPolicySet } from '../src/approvalPolicy.js';

/**
 * `approval.policy.*` — the write side of five `policy.ts` fields that have
 * been read since P1 and, until this pair existed, nothing ever set. What
 * matters here: a partial patch merges rather than replaces (setting
 * `restrictedPlatforms` must not wipe a `quietWindows` set earlier), `null`
 * clears a field back to "no override" while omitting it leaves it alone,
 * and only owner/admin — never SPARK — may call `.set`.
 */

function store(initial: Partial<BrandGovernance> = {}): BrandGovernanceStore {
  let row: BrandGovernance = {
    brandId: 'brand_1',
    name: 'Emeka Cuts',
    approvalMode: 'autopublish',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    agentPaused: false,
    postsPerWeek: 3,
      strictMode: false,
      timezone: 'UTC',
      engagementAutonomy: 'off' as const,
    ...initial,
  };
  return {
    get: async () => row,
    setApprovalMode: async (_b, _o, mode) => ((row = { ...row, approvalMode: mode }), row),
    setFrequency: async ({ postsPerWeek }) => ((row = { ...row, postsPerWeek }), row),
    setAgentPaused: async ({ paused }) => ((row = { ...row, agentPaused: paused }), row),
    setPolicy: async ({ patch }) => {
      const next = { ...row };
      if (patch.familyOverrides !== undefined) {
        if (patch.familyOverrides === null) delete next.familyOverrides;
        else next.familyOverrides = patch.familyOverrides;
      }
      if (patch.restrictedPlatforms !== undefined) {
        if (patch.restrictedPlatforms === null) delete next.restrictedPlatforms;
        else next.restrictedPlatforms = patch.restrictedPlatforms;
      }
      if (patch.restrictedContentTypes !== undefined) {
        if (patch.restrictedContentTypes === null) delete next.restrictedContentTypes;
        else next.restrictedContentTypes = patch.restrictedContentTypes;
      }
      if (patch.quietWindows !== undefined) {
        if (patch.quietWindows === null) delete next.quietWindows;
        else next.quietWindows = patch.quietWindows;
      }
      if (patch.permissions !== undefined) {
        if (patch.permissions === null) delete next.permissions;
        else next.permissions = patch.permissions;
      }
      row = next;
      return row;
    },
    // Brand-level governance is a separate patch surface from `setPolicy` above
    // (see `BrandGovernanceStore.setGovernance`); these tests only exercise the
    // approval ladder, so this records the patch faithfully and nothing more.
    setGovernance: async ({ patch }) => ((row = { ...row, ...stripNulls(patch) } as BrandGovernance), row),
  };
}

/** `null` clears a field in the real store; for these tests dropping it is equivalent. */
function stripNulls<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null && v !== undefined)) as Partial<T>;
}

const ctx = (brands: BrandGovernanceStore, over: Partial<ToolCtx> = {}): ToolCtx =>
  ({
    orgId: 'org_1',
    brandId: 'brand_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: { brands } as unknown as ToolCtx['db'],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    ...over,
  }) as unknown as ToolCtx;

describe('the registry contract', () => {
  it('approval.policy.set is human_only, owner/admin only', () => {
    expect(approvalPolicySet.autonomy).toBe('human_only');
    expect(approvalPolicySet.scopes).toEqual(['owner', 'admin']);
  });

  it('approval.policy.get is a free read, broader scopes', () => {
    expect(approvalPolicyGet.effect).toBe('read');
    expect(approvalPolicyGet.scopes).toContain('viewer');
  });
});

describe('approval.policy.get', () => {
  it('reads back nulls when nothing has ever been set', async () => {
    const out = await approvalPolicyGet.handler({}, ctx(store()));
    expect(out).toEqual({
      brandId: 'brand_1',
      familyOverrides: null,
      restrictedPlatforms: null,
      restrictedContentTypes: null,
      quietWindows: null,
      permissions: null,
    });
  });

  it('requires a brand to be selected', async () => {
    await expect(approvalPolicyGet.handler({}, ctx(store(), { brandId: undefined }))).rejects.toThrow(ToolError);
  });
});

describe('approval.policy.set — writing', () => {
  it('sets restrictedPlatforms', async () => {
    const s = store();
    const out = await approvalPolicySet.handler({ restrictedPlatforms: ['tiktok'] }, ctx(s));
    expect(out.policy.restrictedPlatforms).toEqual(['tiktok']);
  });

  it('sets familyOverrides with a real Autonomy value', async () => {
    const s = store();
    const out = await approvalPolicySet.handler({ familyOverrides: { engage: 'approval' } }, ctx(s));
    expect(out.policy.familyOverrides).toEqual({ engage: 'approval' });
  });

  it('sets quietWindows and round-trips ISO timestamps', async () => {
    const s = store();
    const out = await approvalPolicySet.handler(
      { quietWindows: [{ from: '2026-12-24T00:00:00.000Z', to: '2026-12-26T00:00:00.000Z', reason: 'holiday freeze' }] },
      ctx(s),
    );
    expect(out.policy.quietWindows).toEqual([{ from: '2026-12-24T00:00:00.000Z', to: '2026-12-26T00:00:00.000Z', reason: 'holiday freeze' }]);
  });

  it('rejects a quiet window where "to" is not after "from"', () => {
    const parsed = approvalPolicySet.input.safeParse({
      quietWindows: [{ from: '2026-12-26T00:00:00.000Z', to: '2026-12-24T00:00:00.000Z', reason: 'backwards' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('sets permissions', async () => {
    const s = store();
    const out = await approvalPolicySet.handler({ permissions: { spendCredits: false } }, ctx(s));
    expect(out.policy.permissions).toEqual({ spendCredits: false });
  });

  it('rejects an empty patch — nothing to change', () => {
    expect(approvalPolicySet.input.safeParse({}).success).toBe(false);
  });
});

describe('approval.policy.set — merges, does not replace', () => {
  it('setting restrictedPlatforms does not wipe a previously set quietWindows', async () => {
    const s = store();
    await approvalPolicySet.handler(
      { quietWindows: [{ from: '2026-12-24T00:00:00.000Z', to: '2026-12-26T00:00:00.000Z', reason: 'holiday freeze' }] },
      ctx(s),
    );
    const out = await approvalPolicySet.handler({ restrictedPlatforms: ['tiktok'] }, ctx(s));

    expect(out.policy.restrictedPlatforms).toEqual(['tiktok']);
    expect(out.policy.quietWindows).toEqual([{ from: '2026-12-24T00:00:00.000Z', to: '2026-12-26T00:00:00.000Z', reason: 'holiday freeze' }]);
  });

  it('passing null clears a field back to "no override"', async () => {
    const s = store();
    await approvalPolicySet.handler({ restrictedPlatforms: ['tiktok'] }, ctx(s));
    const out = await approvalPolicySet.handler({ restrictedPlatforms: null }, ctx(s));
    expect(out.policy.restrictedPlatforms).toBeNull();
  });
});
