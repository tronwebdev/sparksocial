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
 * `brand_members` — a table Clerk has no concept of).
 *
 * This comment used to end *"today nothing enforces that at the query layer
 * yet, so this is the write half of agency isolation, not the whole of it"*.
 * That stopped being true in `e343534`: `apps/api/src/clerk-auth.ts` reads
 * `brand_members` on every request and refuses a claimed genome whose brand the
 * caller has no row for, with `ISOLATION_VIOLATION`. Enforcement is real; these
 * are the writes that feed it. Recorded rather than quietly deleted because the
 * stale version was cited in `docs/GAPS.md` as evidence of an open security
 * hole that had in fact been closed.
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

/* ── team.list ───────────────────────────────────────────────────────── */

const TeamMemberOut = z.object({
  userId: z.string(),
  /** Absent when Clerk has no primary email on the account (an SSO-only user can lack one). */
  email: z.string().optional(),
  name: z.string().optional(),
  /** The org-level role from Clerk's membership record — what lands in session claims. */
  orgRole: z.string(),
  joinedAt: z.string(),
  /** This registry's half: which brands the member has an explicit row for. */
  brands: z.array(z.object({ brandId: z.string(), role: z.string() })),
  /**
   * True for `owner`/`admin`, who administer every brand in the org by
   * construction and therefore need no rows. Without this the UI would show
   * them as assigned to nothing, which reads as "locked out" and is the
   * opposite of the truth.
   */
  allBrands: z.boolean(),
});

export const TeamListOutput = z.object({
  members: z.array(TeamMemberOut),
  /** Set when Clerk answered but the brand-assignment read did not, so a partial list is labelled as one. */
  partial: z.string().optional(),
});

/**
 * Who is in this org, and which brands each of them can reach.
 *
 * The read the `team.*` family never had. `team.invite`, `team.role.set` and
 * `team.permission.set` are three writes with no way to see their effect, which
 * makes an administration screen impossible: you cannot change a role without
 * first knowing whose, and you cannot audit an agency's client isolation by
 * writing to it.
 *
 * **Both halves in one call, deliberately.** Org membership lives in Clerk and
 * brand assignment lives in `brand_members`, and a caller that had to join them
 * itself would be re-deriving the `allBrands` rule below — the same rule
 * `clerk-auth.ts` enforces. One tool, one answer, one place that rule is
 * written down.
 */
export function makeTeamList(deps: TeamDeps) {
  return defineTool({
    name: 'team.list',
    version: 1,

    summary:
      "Everyone in this org: their Clerk org role, and which brands each can reach. Joins Clerk's membership " +
      'list with this registry\'s brand_members rows — the read behind team.invite/.role.set/.permission.set. Free.',

    input: z.object({ limit: z.number().int().min(1).max(200).default(100) }),
    output: TeamListOutput,

    effect: 'read',
    /**
     * `owner`/`admin` only, matching `team.permission.set`. A member list is a
     * list of colleagues' email addresses — not secret, and not something an
     * agency's `client` role should be handed either.
     */
    autonomy: 'auto',
    scopes: ['owner', 'admin'],
    idempotent: true,
    surfaces: ['SET-WS-01'],

    async handler(input, ctx) {
      let memberships: Awaited<ReturnType<typeof deps.clerk.organizations.getOrganizationMembershipList>>;
      try {
        memberships = await deps.clerk.organizations.getOrganizationMembershipList({
          organizationId: ctx.orgId,
          limit: input.limit,
        });
      } catch (e) {
        throw new ToolError('UPSTREAM_FAILED', `Clerk could not list this org's members: ${e instanceof Error ? e.message : String(e)}`, {
          orgId: ctx.orgId,
        });
      }

      /**
       * One brand-assignment read per member, in parallel. `brand_members` has
       * no "every row for this org" read and this tool is not the place to add
       * one: `listForUser` is the shape `clerk-auth.ts` already uses on the hot
       * path, and an org-wide variant would exist solely for this screen.
       *
       * A failure here degrades rather than throws. Clerk has already answered,
       * so the useful half of the list exists, and returning it with `partial`
       * set beats replacing a member list with an error page.
       */
      let partial: string | undefined;
      const members = await Promise.all(
        memberships.data.map(async (m) => {
          const userId = m.publicUserData?.userId ?? '';
          const orgRole = m.role.replace(/^org:/, '');
          const allBrands = orgRole === 'owner' || orgRole === 'admin';

          let brands: { brandId: string; role: string }[] = [];
          if (userId && !allBrands) {
            try {
              const rows = await ctx.db.brandMembers.listForUser(ctx.orgId, userId);
              brands = rows.map((r) => ({ brandId: r.brandId, role: r.role }));
            } catch (e) {
              partial = `Brand assignments could not be read: ${e instanceof Error ? e.message : String(e)}`;
            }
          }

          return {
            userId,
            ...(m.publicUserData?.identifier ? { email: m.publicUserData.identifier } : {}),
            ...(nameOf(m.publicUserData) ? { name: nameOf(m.publicUserData)! } : {}),
            orgRole,
            joinedAt: new Date(m.createdAt).toISOString(),
            brands,
            allBrands,
          };
        }),
      );

      return { members, ...(partial ? { partial } : {}) };
    },
  });
}

/** Clerk splits the name across two optional fields and either can be absent. */
function nameOf(u: { firstName?: string | null; lastName?: string | null } | null | undefined): string | undefined {
  const full = [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim();
  return full || undefined;
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
