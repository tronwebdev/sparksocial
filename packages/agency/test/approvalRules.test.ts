import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ApprovalRuleRecord, ToolCtx } from '@sparksocial/tools/defineTool';
import { approvalRuleDelete, approvalRuleList, approvalRuleSet } from '../src/approvalRules.js';

/**
 * `approval.rule.*` — the workspace's "Approval flows".
 *
 * The behaviour worth pinning is the two refusals and the wording. A rule
 * pointing at a deleted team applies to nobody while looking identical on screen
 * to one that works, and a threshold saved against a publish rule sits in the
 * row implying that cheap publishes are exempt. Both are the same class of
 * defect: a stored value that does not mean what it appears to.
 */

function store(seed: ApprovalRuleRecord[] = [], groups: Array<{ id: string; name: string }> = []) {
  const rows = new Map(seed.map((r) => [r.id, { ...r }]));
  let next = seed.length + 1;

  const db = {
    approvalRules: {
      list: async () => [...rows.values()],
      active: async () => [...rows.values()].filter((r) => r.enabled),
      upsert: async (args: {
        orgId: string;
        id?: string;
        trigger: string;
        thresholdCents?: number;
        requiresRole: ApprovalRuleRecord['requiresRole'];
        groupIds: string[];
        enabled: boolean;
        createdBy?: string;
      }) => {
        const id = args.id && rows.has(args.id) ? args.id : `apr_${next++}`;
        const row: ApprovalRuleRecord = {
          id,
          orgId: args.orgId,
          trigger: args.trigger,
          ...(args.thresholdCents === undefined ? {} : { thresholdCents: args.thresholdCents }),
          requiresRole: args.requiresRole,
          groupIds: args.groupIds,
          enabled: args.enabled,
          ...(args.createdBy ? { createdBy: args.createdBy } : {}),
          updatedAt: new Date('2026-09-01T00:00:00Z'),
        };
        rows.set(id, row);
        return { ...row };
      },
      remove: async ({ id }: { orgId: string; id: string }) => rows.delete(id),
    },
    teamGroups: {
      list: async () =>
        groups.map((g) => ({
          ...g,
          orgId: 'org_1',
          capabilities: [],
          memberCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
    },
  };

  return { rows, db };
}

const ctx = (db: unknown, role = 'owner') =>
  ({
    orgId: 'org_1',
    userId: 'user_1',
    role,
    db,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  }) as unknown as ToolCtx;

describe('approval.rule.set', () => {
  it('saves a publishing rule and says what it holds', async () => {
    const { db, rows } = store();
    const out = await approvalRuleSet.handler(
      { trigger: 'publish', requiresRole: 'approver', groupIds: [], enabled: true },
      ctx(db),
    );

    expect(rows.size).toBe(1);
    expect(out.rule.label).toBe('Publishing needs an approver to review it');
    expect(out.rule.appliesTo).toBe('Everyone, including SPARK');
  });

  it('refuses a spending rule with no amount', async () => {
    const { db } = store();
    await expect(
      approvalRuleSet.handler({ trigger: 'spend_over', requiresRole: 'admin', groupIds: [], enabled: true }, ctx(db)),
    ).rejects.toThrow(/needs an amount/);
  });

  it('refuses an amount on a publishing rule rather than ignoring it', async () => {
    // Ignored, it would sit on the row looking like it did something, and the
    // next person to read the table would conclude cheap publishes are exempt.
    const { db, rows } = store();
    await expect(
      approvalRuleSet.handler(
        { trigger: 'publish', thresholdCents: 100, requiresRole: 'admin', groupIds: [], enabled: true },
        ctx(db),
      ),
    ).rejects.toThrow(/takes no amount/);
    expect(rows.size).toBe(0);
  });

  it('refuses a team that no longer exists', async () => {
    // A rule pointing at a deleted group applies to nobody, and looks identical
    // on the screen to one that is working.
    const { db } = store([], [{ id: 'grp_1', name: 'Design Team' }]);
    await expect(
      approvalRuleSet.handler(
        { trigger: 'publish', requiresRole: 'approver', groupIds: ['grp_gone'], enabled: true },
        ctx(db),
      ),
    ).rejects.toThrow(ToolError);
  });

  it('names the teams a rule applies to', async () => {
    const { db } = store([], [
      { id: 'grp_1', name: 'Design Team' },
      { id: 'grp_2', name: 'Social Team' },
    ]);
    const out = await approvalRuleSet.handler(
      { trigger: 'publish', requiresRole: 'approver', groupIds: ['grp_1', 'grp_2'], enabled: true },
      ctx(db),
    );
    expect(out.rule.appliesTo).toBe('Design Team, Social Team');
  });

  it('spells out a spend threshold in money, not cents', async () => {
    const { db } = store();
    const out = await approvalRuleSet.handler(
      { trigger: 'spend_over', thresholdCents: 10_000, requiresRole: 'admin', groupIds: [], enabled: true },
      ctx(db),
    );
    expect(out.rule.label).toBe('Spending over $100.00 needs an admin to approve it');
  });

  it('updates in place when given an id', async () => {
    const { db, rows } = store([
      {
        id: 'apr_1',
        orgId: 'org_1',
        trigger: 'publish',
        requiresRole: 'approver',
        groupIds: [],
        enabled: true,
        updatedAt: new Date(),
      },
    ]);
    await approvalRuleSet.handler(
      { id: 'apr_1', trigger: 'publish', requiresRole: 'admin', groupIds: [], enabled: false },
      ctx(db),
    );
    expect(rows.size).toBe(1);
    expect(rows.get('apr_1')).toMatchObject({ requiresRole: 'admin', enabled: false });
  });

  it('says a disabled rule is holding nothing yet', async () => {
    // Otherwise the confirmation reads as though the rule is in force, which is
    // the one thing somebody saving a switched-off rule needs to know it is not.
    const { db } = store();
    const out = await approvalRuleSet.handler(
      { trigger: 'publish', requiresRole: 'approver', groupIds: [], enabled: false },
      ctx(db),
    );
    expect(out.why.summary).toMatch(/switched off/);
  });

  it('is human-only and owner/admin — an agent that can switch off its own review is not reviewed', () => {
    expect(approvalRuleSet.autonomy).toBe('human_only');
    expect(approvalRuleSet.scopes).toEqual(['owner', 'admin']);
  });
});

describe('approval.rule.list', () => {
  it('shows switched-off rules too', async () => {
    // A rule somebody disabled in March is a fact an audit asks about, and it
    // cannot be answered by a list that hides it.
    const { db } = store([
      {
        id: 'apr_1',
        orgId: 'org_1',
        trigger: 'publish',
        requiresRole: 'approver',
        groupIds: [],
        enabled: false,
        updatedAt: new Date(),
      },
    ]);
    const out = await approvalRuleList.handler({}, ctx(db));
    expect(out.rules).toHaveLength(1);
    expect(out.rules[0]!.enabled).toBe(false);
  });

  it('says so when a rule points at a team that has been deleted', async () => {
    const { db } = store([
      {
        id: 'apr_1',
        orgId: 'org_1',
        trigger: 'publish',
        requiresRole: 'approver',
        groupIds: ['grp_gone'],
        enabled: true,
        updatedAt: new Date(),
      },
    ]);
    const out = await approvalRuleList.handler({}, ctx(db));
    expect(out.rules[0]!.appliesTo).toBe('a deleted team');
  });

  it('is readable by every role — a rule you cannot see is one you cannot act on', () => {
    expect(approvalRuleList.scopes).toContain('viewer');
    expect(approvalRuleList.scopes).toContain('editor');
  });
});

describe('approval.rule.delete', () => {
  it('removes the rule', async () => {
    const { db, rows } = store([
      {
        id: 'apr_1',
        orgId: 'org_1',
        trigger: 'publish',
        requiresRole: 'approver',
        groupIds: [],
        enabled: true,
        updatedAt: new Date(),
      },
    ]);
    await approvalRuleDelete.handler({ id: 'apr_1' }, ctx(db));
    expect(rows.size).toBe(0);
  });

  it('fails clearly on a rule that is already gone', async () => {
    const { db } = store();
    await expect(approvalRuleDelete.handler({ id: 'apr_nope' }, ctx(db))).rejects.toThrow(/no longer exists/);
  });
});
