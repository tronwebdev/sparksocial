import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { makeTeamInvite, makeTeamRoleSet, makeTeamList, teamPermissionSet } from '../src/team.js';

function ctx(db: unknown, over: Partial<ToolCtx> = {}): ToolCtx {
  return {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: db as ToolCtx['db'],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    ...over,
  } as unknown as ToolCtx;
}

describe('team.invite', () => {
  it('sends a real invitation through the injected Clerk client', async () => {
    const calls: unknown[] = [];
    const clerk = {
      organizations: {
        createOrganizationInvitation: async (args: unknown) => {
          calls.push(args);
          return { id: 'inv_1', status: 'pending' };
        },
      },
    } as any;
    const tool = makeTeamInvite({ clerk });
    const out = await tool.handler({ email: 'client@example.com', role: 'org:editor' }, ctx({}));
    expect(out.invitationId).toBe('inv_1');
    expect(calls[0]).toMatchObject({ organizationId: 'org_1', emailAddress: 'client@example.com', role: 'org:editor', inviterUserId: 'user_1' });
  });

  it('wraps a Clerk failure as UPSTREAM_FAILED rather than an unhandled rejection', async () => {
    const clerk = { organizations: { createOrganizationInvitation: async () => { throw new Error('Clerk 422'); } } } as any;
    const tool = makeTeamInvite({ clerk });
    await expect(tool.handler({ email: 'x@example.com', role: 'org:editor' }, ctx({}))).rejects.toThrow(ToolError);
  });

  it('is not idempotent — a retry would send a second email', () => {
    const tool = makeTeamInvite({ clerk: {} as any });
    expect(tool.idempotent).toBe(false);
  });
});

describe('team.role.set', () => {
  it('updates the membership through Clerk', async () => {
    const clerk = { organizations: { updateOrganizationMembership: async () => ({ role: 'org:admin' }) } } as any;
    const tool = makeTeamRoleSet({ clerk });
    const out = await tool.handler({ userId: 'user_2', role: 'org:admin' }, ctx({}));
    expect(out.role).toBe('org:admin');
  });

  it('is owner-only', () => {
    const tool = makeTeamRoleSet({ clerk: {} as any });
    expect(tool.scopes).toEqual(['owner']);
  });
});

describe('team.permission.set', () => {
  it('grants brand-level access', async () => {
    const sets: unknown[] = [];
    const db = { brandMembers: { set: async (args: unknown) => { sets.push(args); return { userId: 'user_2', brandId: 'brand_1', role: 'editor', createdAt: new Date() }; } } };
    const out = await teamPermissionSet.handler({ userId: 'user_2', brandId: 'brand_1', role: 'editor', revoke: false }, ctx(db));
    expect(out.role).toBe('editor');
    expect(out.revoked).toBe(false);
  });

  it('revokes access without needing a role', async () => {
    const removed: unknown[] = [];
    const db = { brandMembers: { remove: async (args: unknown) => { removed.push(args); } } };
    const out = await teamPermissionSet.handler({ userId: 'user_2', brandId: 'brand_1', revoke: true }, ctx(db));
    expect(out.revoked).toBe(true);
    expect(removed).toHaveLength(1);
  });

  it('refuses to grant with no role and no revoke flag', async () => {
    await expect(teamPermissionSet.handler({ userId: 'user_2', brandId: 'brand_1', revoke: false }, ctx({}))).rejects.toThrow(ToolError);
  });
});

describe('team.list', () => {
  const membership = (over: Record<string, unknown> = {}) => ({
    role: 'org:editor',
    createdAt: Date.parse('2026-07-01T09:00:00Z'),
    publicUserData: { userId: 'user_2', identifier: 'staff@agency.com', firstName: 'Ada', lastName: 'Byron' },
    ...over,
  });

  const clerkWith = (data: unknown[]) =>
    ({ organizations: { getOrganizationMembershipList: async () => ({ data }) } }) as any;

  const dbWith = (rows: { brandId: string; role: string }[] = [], opts: { throws?: boolean } = {}) => ({
    brandMembers: {
      listForUser: async () => {
        if (opts.throws) throw new Error('brand_members unavailable');
        return rows;
      },
    },
  });

  it('joins Clerk membership with this registry\'s brand assignments', async () => {
    // The whole reason it is one call: a caller doing the join itself would be
    // re-deriving the all-brands rule that `clerk-auth.ts` enforces.
    const tool = makeTeamList({ clerk: clerkWith([membership()]) });
    const out = await tool.handler({ limit: 100 }, ctx(dbWith([{ brandId: 'brand_a', role: 'editor' }])));
    expect(out.members).toHaveLength(1);
    expect(out.members[0]).toMatchObject({
      userId: 'user_2',
      email: 'staff@agency.com',
      name: 'Ada Byron',
      orgRole: 'editor',
      allBrands: false,
    });
    expect(out.members[0]!.brands).toEqual([{ brandId: 'brand_a', role: 'editor' }]);
  });

  it('strips Clerk\'s `org:` prefix, so the role matches the Role enum', async () => {
    const tool = makeTeamList({ clerk: clerkWith([membership({ role: 'org:approver' })]) });
    const out = await tool.handler({ limit: 100 }, ctx(dbWith()));
    expect(out.members[0]!.orgRole).toBe('approver');
  });

  it('marks an owner as reaching every brand rather than none', async () => {
    // Owners and admins administer every brand by construction and have no
    // rows. Rendering them as assigned to nothing reads as "locked out", which
    // is the opposite of the truth.
    const tool = makeTeamList({ clerk: clerkWith([membership({ role: 'org:owner' })]) });
    const out = await tool.handler({ limit: 100 }, ctx(dbWith()));
    expect(out.members[0]!.allBrands).toBe(true);
    expect(out.members[0]!.brands).toEqual([]);
  });

  it('does not read brand rows for an admin at all', async () => {
    let read = false;
    const tool = makeTeamList({ clerk: clerkWith([membership({ role: 'org:admin' })]) });
    const out = await tool.handler(
      { limit: 100 },
      ctx({ brandMembers: { listForUser: async () => { read = true; return []; } } }),
    );
    expect(read).toBe(false);
    expect(out.members[0]!.allBrands).toBe(true);
  });

  it('survives a member with no email on the account', async () => {
    // An SSO-only user can lack a primary email; the row should still render.
    const tool = makeTeamList({
      clerk: clerkWith([membership({ publicUserData: { userId: 'user_3' } })]),
    });
    const out = await tool.handler({ limit: 100 }, ctx(dbWith()));
    expect(out.members[0]!.email).toBeUndefined();
    expect(out.members[0]!.name).toBeUndefined();
    expect(out.members[0]!.userId).toBe('user_3');
  });

  it('degrades to a partial list when brand assignments cannot be read', async () => {
    // Clerk has already answered, so the useful half exists. Replacing a member
    // list with an error page would throw that away.
    const tool = makeTeamList({ clerk: clerkWith([membership()]) });
    const out = await tool.handler({ limit: 100 }, ctx(dbWith([], { throws: true })));
    expect(out.members).toHaveLength(1);
    expect(out.partial).toMatch(/brand_members unavailable/);
  });

  it('wraps a Clerk failure as UPSTREAM_FAILED', async () => {
    const clerk = { organizations: { getOrganizationMembershipList: async () => { throw new Error('Clerk 500'); } } } as any;
    const tool = makeTeamList({ clerk });
    await expect(tool.handler({ limit: 100 }, ctx(dbWith()))).rejects.toThrow(ToolError);
  });

  it('is not readable by an agency client', () => {
    // A member list is a list of colleagues' email addresses.
    const tool = makeTeamList({ clerk: {} as any });
    expect(tool.scopes).toEqual(['owner', 'admin']);
    expect(tool.effect).toBe('read');
  });
});
