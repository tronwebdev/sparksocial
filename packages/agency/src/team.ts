import { z } from 'zod';
import type { ClerkClient } from '@clerk/backend';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';

/**
 * `team.*` — org membership vs. brand-level access (plan §6.9, §12 P6).
 *
 * Split deliberately down the middle: **Clerk owns whether someone is in the
 * org at all** (`team.invite`, `team.role.set` — real calls against
 * `@clerk/backend`, the same client `clerk-auth.ts` already authenticates
 * every request with). **This registry owns which specific brands within
 * that org they can reach** (`team.permission.set`, backed by
 * `brand_members` — a table Clerk has no concept of). An org member with no
 * `brand_members` row for a given brand cannot be routed to it by anything
 * that checks; today nothing enforces that at the query layer yet, so this
 * is the write half of agency isolation, not the whole of it.
 */

export interface TeamDeps {
  clerk: ClerkClient;
}

/* ── team.invite ─────────────────────────────────────────────────────── */

export function makeTeamInvite(deps: TeamDeps) {
  return defineTool({
    name: 'team.invite',
    version: 1,

    summary:
      'Invite someone to this org by email through Clerk — a real invitation email, sent by Clerk\'s own ' +
      'infrastructure. Grants org membership only; call team.permission.set afterward to scope them to ' +
      'specific brands.',

    input: z.object({
      email: z.string().email(),
      /** Must match a role configured in this org's Clerk dashboard (Organizations → Roles). */
      role: z.string().min(1),
    }),
    output: z.object({ invitationId: z.string(), status: z.string() }),

    effect: 'external',
    autonomy: 'auto',
    scopes: ['owner', 'admin'],
    // A retried call would send a second email — not a safe replay.
    idempotent: false,

    async handler(input, ctx) {
      try {
        const invitation = await deps.clerk.organizations.createOrganizationInvitation({
          organizationId: ctx.orgId,
          emailAddress: input.email,
          role: input.role,
          ...(ctx.userId ? { inviterUserId: ctx.userId } : {}),
        });
        ctx.logger.info('team invite sent', { orgId: ctx.orgId, email: input.email, role: input.role });
        return { invitationId: invitation.id, status: invitation.status ?? 'pending' };
      } catch (e) {
        throw new ToolError('UPSTREAM_FAILED', `Clerk could not send the invitation: ${e instanceof Error ? e.message : String(e)}`, {
          email: input.email,
        });
      }
    },
  });
}

/* ── team.role.set ───────────────────────────────────────────────────── */

export function makeTeamRoleSet(deps: TeamDeps) {
  return defineTool({
    name: 'team.role.set',
    version: 1,

    summary: 'Change an existing member\'s org-level role in Clerk — owner/admin/editor/etc., the role carried in their session claims.',

    input: z.object({ userId: z.string().min(1), role: z.string().min(1) }),
    output: z.object({ userId: z.string(), role: z.string() }),

    effect: 'external',
    autonomy: 'auto',
    scopes: ['owner'],
    idempotent: true,

    async handler(input, ctx) {
      try {
        const membership = await deps.clerk.organizations.updateOrganizationMembership({
          organizationId: ctx.orgId,
          userId: input.userId,
          role: input.role,
        });
        ctx.logger.info('team role changed', { orgId: ctx.orgId, userId: input.userId, role: input.role });
        return { userId: input.userId, role: membership.role };
      } catch (e) {
        throw new ToolError('UPSTREAM_FAILED', `Clerk could not update the membership: ${e instanceof Error ? e.message : String(e)}`, {
          userId: input.userId,
        });
      }
    },
  });
}

/* ── team.permission.set ─────────────────────────────────────────────── */

export const teamPermissionSet = defineTool({
  name: 'team.permission.set',
  version: 1,

  summary:
    'Grant (or revoke) one team member\'s access to one specific brand. This is what actually scopes an ' +
    'agency staffer to their assigned clients — org membership alone (team.invite/team.role.set) does not.',

  input: z.object({
    userId: z.string().min(1),
    brandId: z.string().min(1),
    role: z.enum(['owner', 'admin', 'editor', 'approver', 'viewer', 'client']).optional(),
    /** Omit `role` and set this to revoke access to the brand entirely. */
    revoke: z.boolean().default(false),
  }),
  output: z.object({ userId: z.string(), brandId: z.string(), role: z.string().optional(), revoked: z.boolean() }),

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin'],
  idempotent: true,

  async handler(input, ctx) {
    if (input.revoke) {
      await ctx.db.brandMembers.remove({ orgId: ctx.orgId, brandId: input.brandId, userId: input.userId });
      return { userId: input.userId, brandId: input.brandId, revoked: true };
    }
    if (!input.role) {
      throw new ToolError('INVALID_INPUT', 'A role is required unless revoking access.', { userId: input.userId });
    }
    const member = await ctx.db.brandMembers.set({ orgId: ctx.orgId, brandId: input.brandId, userId: input.userId, role: input.role });
    ctx.logger.info('brand permission set', { orgId: ctx.orgId, brandId: input.brandId, userId: input.userId, role: input.role });
    return { userId: member.userId, brandId: member.brandId, role: member.role, revoked: false };
  },
});
