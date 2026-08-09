import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { BrandGovernance, BrandGovernanceStore, ToolCtx } from '@sparksocial/tools';
import { approvalGet, approvalSet, remainingReviewDays } from '../src/approval.js';

/**
 * §6.8 Step 5: *"Recommend 'review first week, then autopublish' explicitly —
 * it is the setting that gets people to autopublish at all."*
 *
 * The rung a brand sits on is the only thing between the agent and a public
 * feed, so the properties here are about who may change it and when the middle
 * rung actually ends.
 */

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

function store(initial: Partial<BrandGovernance> = {}): BrandGovernanceStore {
  let row: BrandGovernance = {
    brandId: 'brand_1',
    name: 'Emeka Cuts',
    approvalMode: 'review_first_week',
    createdAt: daysAgo(2),
    ...initial,
  };
  return {
    get: async () => row,
    setApprovalMode: async (_b, _o, mode) => {
      row = { ...row, approvalMode: mode };
      return row;
    },
  };
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

describe('remainingReviewDays', () => {
  it('counts down from seven', () => {
    const now = new Date('2026-09-10T00:00:00Z');
    expect(remainingReviewDays(new Date('2026-09-10T00:00:00Z'), now)).toBe(7);
    expect(remainingReviewDays(new Date('2026-09-07T00:00:00Z'), now)).toBe(4);
  });

  it('floors at zero once graduated', () => {
    const now = new Date('2026-09-30T00:00:00Z');
    // Never negative: "graduates in -12 days" is not a sentence anyone should read.
    expect(remainingReviewDays(new Date('2026-09-01T00:00:00Z'), now)).toBe(0);
  });

  it('measures from brand creation, not from when the mode was set', () => {
    // Re-setting the same mode on day six must not restart the clock — the
    // rung is a week of watching the account, not a week of watching a setting.
    const created = daysAgo(6);
    const before = remainingReviewDays(created);
    const after = remainingReviewDays(created);
    expect(after).toBe(before);
    expect(before).toBe(1);
  });
});

describe('brand.approval.get', () => {
  it('reports the mode and when a first-week review ends', async () => {
    const out = await approvalGet.handler({}, ctx(store({ createdAt: daysAgo(3) })));
    expect(out.approvalMode).toBe('review_first_week');
    expect(out.graduatesInDays).toBe(4);
  });

  it('recommends the middle rung, which is the one that converts', async () => {
    const out = await approvalGet.handler({}, ctx(store({ approvalMode: 'review_everything' })));
    expect(out.recommended).toBe('review_first_week');
    expect(out.why.alternatives[0]?.option).toMatch(/first week/i);
  });

  it('reports no graduation date when the mode has none', async () => {
    const out = await approvalGet.handler({}, ctx(store({ approvalMode: 'autopublish' })));
    expect(out.graduatesInDays).toBeNull();
  });

  it('is readable by every role — the gate should not be a secret', () => {
    expect(approvalGet.scopes).toContain('client');
    expect(approvalGet.scopes).toContain('viewer');
    expect(approvalGet.effect).toBe('read');
  });

  it('refuses without a brand', async () => {
    await expect(approvalGet.handler({}, ctx(store(), { brandId: undefined }))).rejects.toThrow(ToolError);
  });
});

describe('brand.approval.set', () => {
  it('persists the mode through the store', async () => {
    const s = store();
    const spy = vi.spyOn(s, 'setApprovalMode');

    const out = await approvalSet.handler({ mode: 'autopublish' }, ctx(s));

    expect(spy).toHaveBeenCalledWith('brand_1', 'org_1', 'autopublish');
    expect(out.approvalMode).toBe('autopublish');
  });

  it('only owners and admins can lower the gate', () => {
    // An editor can draft and schedule; changing what stands between the agent
    // and a public feed is a different decision.
    expect(approvalSet.scopes).toEqual(expect.arrayContaining(['owner', 'admin']));
    expect(approvalSet.scopes).not.toContain('editor');
    expect(approvalSet.scopes).not.toContain('viewer');
    expect(approvalSet.scopes).not.toContain('client');
  });

  it('takes brand and org from the context, never from the input', async () => {
    const s = store();
    const spy = vi.spyOn(s, 'setApprovalMode');
    await approvalSet.handler({ mode: 'autopublish' }, ctx(s));
    // There is no input field for either, which is the point.
    expect(spy.mock.calls[0]!.slice(0, 2)).toEqual(['brand_1', 'org_1']);
  });

  it('rejects a mode outside the ladder at the schema', () => {
    expect(approvalSet.input.safeParse({ mode: 'yolo' }).success).toBe(false);
  });

  it('explains what the chosen mode actually does', async () => {
    const auto = await approvalSet.handler({ mode: 'autopublish' }, ctx(store()));
    expect(auto.why.summary).toMatch(/without waiting/i);

    const every = await approvalSet.handler({ mode: 'review_everything' }, ctx(store()));
    expect(every.why.summary).toMatch(/waits for your approval/i);
  });

  it('names the policy rule, so the UI cannot claim to be the enforcement', async () => {
    const out = await approvalSet.handler({ mode: 'review_everything' }, ctx(store()));
    expect(out.why.evidence[0]?.id).toBe('approval_mode.review_everything');
    expect(out.why.evidence[0]?.note).toMatch(/policy engine/i);
  });
});
