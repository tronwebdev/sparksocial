import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { makeTeamInvite, makeTeamRoleSet, teamPermissionSet } from '../src/team.js';

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
