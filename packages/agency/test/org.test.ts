import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { orgCreate, orgGovernanceSet, orgBillingPlanSet, orgSecuritySsoConfigure, orgAuditQuery, makeOrgCreditsGrant } from '../src/org.js';

function orgSettingsStore() {
  const rows = new Map<string, { orgId: string; plan: 'starter' | 'growth' | 'agency'; defaultApprovalMode: string; ssoRequired: boolean; monthlyCapCents: number; updatedAt: Date }>();
  const get = async (orgId: string) =>
    rows.get(orgId) ?? { orgId, plan: 'starter' as const, defaultApprovalMode: 'review_first_week', ssoRequired: false, monthlyCapCents: 500_00, updatedAt: new Date() };
  return {
    rows,
    store: {
      get,
      async setPlan({ orgId, plan, monthlyCapCents }: any) {
        const row = { ...(await get(orgId)), plan, monthlyCapCents, updatedAt: new Date() };
        rows.set(orgId, row);
        return row;
      },
      async setGovernance({ orgId, defaultApprovalMode }: any) {
        const row = { ...(await get(orgId)), defaultApprovalMode, updatedAt: new Date() };
        rows.set(orgId, row);
        return row;
      },
      async setSso({ orgId, required }: any) {
        const row = { ...(await get(orgId)), ssoRequired: required, updatedAt: new Date() };
        rows.set(orgId, row);
        return row;
      },
    },
  };
}

function ctx(db: unknown, over: Partial<ToolCtx> = {}): ToolCtx {
  return {
    orgId: 'org_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: db as ToolCtx['db'],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    ...over,
  } as unknown as ToolCtx;
}

describe('org.create', () => {
  it('provisions the org on the chosen plan with the matching spend cap', async () => {
    const { store } = orgSettingsStore();
    const out = await orgCreate.handler({ plan: 'growth' }, ctx({ orgSettings: store }));
    expect(out.plan).toBe('growth');
    expect(out.monthlyCapCents).toBe(2_000_00);
  });

  it('with no plan, reads the current settings rather than resetting to Starter', async () => {
    const { store } = orgSettingsStore();
    await orgCreate.handler({ plan: 'agency' }, ctx({ orgSettings: store }));
    // A second call with no plan is the "what are we on right now" read a UI
    // makes on load — it must not silently demote the org back to Starter.
    const out = await orgCreate.handler({}, ctx({ orgSettings: store }));
    expect(out.plan).toBe('agency');
    expect(out.monthlyCapCents).toBe(10_000_00);
  });

  it('with no plan on a never-configured org, upserts the schema defaults', async () => {
    const { store } = orgSettingsStore();
    const out = await orgCreate.handler({}, ctx({ orgSettings: store }));
    expect(out.plan).toBe('starter');
  });
});

describe('org.governance.set', () => {
  it('sets the default approval mode for new brands', async () => {
    const { store } = orgSettingsStore();
    const out = await orgGovernanceSet.handler({ defaultApprovalMode: 'review_everything' }, ctx({ orgSettings: store }));
    expect(out.defaultApprovalMode).toBe('review_everything');
  });
});

describe('org.billing.plan.set', () => {
  it('moves both the plan label and the spend cap together', async () => {
    const { store } = orgSettingsStore();
    const out = await orgBillingPlanSet.handler({ plan: 'agency' }, ctx({ orgSettings: store }));
    expect(out.plan).toBe('agency');
    expect(out.monthlyCapCents).toBe(10_000_00);
  });

  it('only owner may change billing, not admin', () => {
    expect(orgBillingPlanSet.scopes).toEqual(['owner']);
  });
});

describe('org.security.sso.configure', () => {
  it('is only a policy flag — the tool never claims to provision a real SSO connection', async () => {
    const { store } = orgSettingsStore();
    const out = await orgSecuritySsoConfigure.handler({ required: true }, ctx({ orgSettings: store }));
    expect(out.ssoRequired).toBe(true);
  });
});

describe('org.audit.query', () => {
  it('reads the org-wide call list, never one genome\'s slice', async () => {
    const calls = [{ id: 'c1', tool: 'publish.now', caller: 'user' as const, decision: 'auto', status: 'succeeded', costCents: 0, at: new Date() }];
    const db = { toolCalls: { list: async () => calls } };
    const out = await orgAuditQuery.handler({ limit: 50 }, ctx(db));
    expect(out.calls).toHaveLength(1);
    expect(out.calls[0]!.tool).toBe('publish.now');
  });

  it('refuses an unbounded sweep with no tool filter and a huge limit', async () => {
    const db = { toolCalls: { list: async () => [] } };
    await expect(orgAuditQuery.handler({ limit: 500 }, ctx(db))).rejects.toThrow(ToolError);
  });

  it('allows a wide limit when narrowed by tool name', async () => {
    const db = { toolCalls: { list: async () => [] } };
    await expect(orgAuditQuery.handler({ limit: 500, tool: 'publish.now' }, ctx(db))).resolves.toBeDefined();
  });
});

describe('org.credits.grant', () => {
  it('grants a credit and returns the updated balance, never touching ctx.db', async () => {
    const grants: unknown[] = [];
    const deps = {
      grant: async (entry: unknown) => { grants.push(entry); },
      budget: async () => ({ monthlyCapCents: 50_000, spentCents: 10_000 }),
    };
    const tool = makeOrgCreditsGrant(deps);
    const out = await tool.handler({ amountCents: 5_000, reason: 'goodwill' }, ctx({}));
    expect(out.granted).toBe(true);
    expect(out.balance.spentCents).toBe(10_000);
    expect(grants).toEqual([{ orgId: 'org_1', amountCents: 5_000, reason: 'goodwill' }]);
  });

  it('is not idempotent — a retried grant must not double the credit', () => {
    const tool = makeOrgCreditsGrant({ grant: async () => {}, budget: async () => ({ monthlyCapCents: 0, spentCents: 0 }) });
    expect(tool.idempotent).toBe(false);
  });

  it('is owner-only', () => {
    const tool = makeOrgCreditsGrant({ grant: async () => {}, budget: async () => ({ monthlyCapCents: 0, spentCents: 0 }) });
    expect(tool.scopes).toEqual(['owner']);
  });
});
