import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError, Explanation as ExplanationSchema } from '@sparksocial/shared';

/**
 * `team.group.*` — the Groups tab (`SET-WS-TEAM-GROUPS`).
 *
 * ── The question roles could not answer ───────────────────────────────────
 *
 * `team.invite`/`team.role.set` put somebody on the org ladder;
 * `team.permission.set` scopes them to a client's brand. Neither can express
 * *"these four people may publish and approve, whatever their role says"* — a
 * role is a fixed rung compiled into every tool's `scopes`, so a workspace
 * wanting a video team that publishes but does not spend, and a design team that
 * approves but does not publish, had nowhere to put that.
 *
 * A group is a named set of capabilities plus a set of members. It **only ever
 * widens**: `policy.ts` checks each capability at the one decision point it
 * belongs to, and rule 2 refuses any tool whose own `scopes` exclude the caller
 * before a capability is consulted. That asymmetry is deliberate — a mistake in
 * group configuration cannot lock a workspace out of its own account.
 *
 * ── Why these are `human_only` ────────────────────────────────────────────
 *
 * Same reasoning as `brand.governance.set`: an agent that can add itself to the
 * publishing group is not gated by the publishing group. SPARK may read the
 * groups (`team.group.list`) and must never write one. Note it gains nothing by
 * reading them either — `policy.ts` ignores capabilities on an agent turn.
 */

const Capability = z.enum(['publish', 'spend_credits', 'manage_brand', 'approve']);

const GroupOut = z.object({
  id: z.string(),
  name: z.string(),
  capabilities: z.array(z.string()),
  memberCount: z.number(),
});

/* ── team.group.list ─────────────────────────────────────────────────────── */

export const teamGroupList = defineTool({
  name: 'team.group.list',
  version: 1,

  summary:
    "This workspace's team groups — each one a named set of capabilities (publish, spend credits, manage " +
    'brand, approve) and the people who hold them. Free, read-only.',

  input: z.object({}),
  output: z.object({ groups: z.array(GroupOut.extend({ members: z.array(z.string()) })) }),

  effect: 'read',
  autonomy: 'auto',
  /**
   * Every role may read the groups. Same reasoning `brand.governance.get` gives:
   * somebody refused an action needs to be able to see the rule that refused
   * them, and "you are not in the publishing group" is unactionable if the
   * groups are invisible.
   */
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,
  surfaces: ['SET-WS-TEAM-GROUPS'],

  async handler(_input, ctx) {
    const groups = await ctx.db.teamGroups.list(ctx.orgId);

    // One membership read per group, in parallel. The list is small by nature —
    // a workspace with hundreds of team groups has a different problem — and the
    // screen shows members inline, so a second round trip per row on click would
    // be slower for the same data.
    const withMembers = await Promise.all(
      groups.map(async (g) => ({
        id: g.id,
        name: g.name,
        capabilities: g.capabilities,
        memberCount: g.memberCount,
        members: await ctx.db.teamGroups.members(ctx.orgId, g.id),
      })),
    );

    return { groups: withMembers };
  },
});

/* ── team.group.create ──────────────────────────────────────────────────── */

export const teamGroupCreate = defineTool({
  name: 'team.group.create',
  version: 1,

  summary:
    'Create a team group — a named set of capabilities that widens what its members may do, on top of ' +
    'their role. Never narrows: a group cannot take access away.',

  input: z.object({
    name: z.string().min(1).max(80),
    capabilities: z.array(Capability).max(4).default([]),
    /** Members can be added here or later with `team.group.member.set`. */
    members: z.array(z.string().min(1)).max(200).default([]),
  }),
  output: GroupOut.extend({ why: ExplanationSchema }),

  effect: 'write',
  autonomy: 'human_only',
  scopes: ['owner', 'admin'],
  // A second call with the same name is refused by the unique index rather than
  // making a second group, so a retry is safe without an idempotency key.
  idempotent: true,
  surfaces: ['SET-WS-TEAM-GROUPS'],

  async handler(input, ctx) {
    const name = input.name.trim();
    if (!name) throw new ToolError('INVALID_INPUT', 'A group needs a name.', {});

    const existing = await ctx.db.teamGroups.list(ctx.orgId);
    if (existing.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
      // Caught here as well as by the index, so the message is about groups
      // rather than about a constraint.
      throw new ToolError('INVALID_INPUT', `This workspace already has a group called "${name}".`, { name });
    }

    const group = await ctx.db.teamGroups.create({
      orgId: ctx.orgId,
      name,
      capabilities: dedupe(input.capabilities),
    });

    for (const userId of dedupe(input.members)) {
      await ctx.db.teamGroups.addMember({ orgId: ctx.orgId, groupId: group.id, userId });
    }

    ctx.logger.info('team group created', {
      orgId: ctx.orgId,
      groupId: group.id,
      capabilities: group.capabilities,
      members: input.members.length,
      by: ctx.userId ?? 'unknown',
    });

    return {
      id: group.id,
      name: group.name,
      capabilities: group.capabilities,
      memberCount: dedupe(input.members).length,
      why: explain(name, dedupe(input.capabilities), dedupe(input.members).length, 'created'),
    };
  },
});

/* ── team.group.update ──────────────────────────────────────────────────── */

export const teamGroupUpdate = defineTool({
  name: 'team.group.update',
  version: 1,

  summary:
    "Rename a team group or change which capabilities it carries. A partial patch: omitted fields are " +
    'left alone.',

  input: z
    .object({
      groupId: z.string().min(1),
      name: z.string().min(1).max(80).optional(),
      capabilities: z.array(Capability).max(4).optional(),
    })
    .refine((v) => v.name !== undefined || v.capabilities !== undefined, {
      message: 'Nothing to change — pass a name, capabilities, or both.',
    }),
  output: GroupOut.extend({ why: ExplanationSchema }),

  effect: 'write',
  autonomy: 'human_only',
  scopes: ['owner', 'admin'],
  idempotent: true,
  surfaces: ['SET-WS-TEAM-GROUPS'],

  async handler(input, ctx) {
    const group = await ctx.db.teamGroups.update({
      orgId: ctx.orgId,
      id: input.groupId,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.capabilities !== undefined ? { capabilities: dedupe(input.capabilities) } : {}),
    });

    if (!group) throw new ToolError('NOT_FOUND', 'No group with that id in this workspace.', { groupId: input.groupId });

    ctx.logger.info('team group updated', {
      orgId: ctx.orgId,
      groupId: group.id,
      capabilities: group.capabilities,
      by: ctx.userId ?? 'unknown',
    });

    return {
      id: group.id,
      name: group.name,
      capabilities: group.capabilities,
      memberCount: group.memberCount,
      why: explain(group.name, group.capabilities, group.memberCount, 'updated'),
    };
  },
});

/* ── team.group.delete ──────────────────────────────────────────────────── */

export const teamGroupDelete = defineTool({
  name: 'team.group.delete',
  version: 1,

  summary:
    'Delete a team group and its memberships. Members keep their own roles — a group only ever added ' +
    'capabilities, so removing it cannot lock anybody out.',

  input: z.object({ groupId: z.string().min(1) }),
  output: z.object({ groupId: z.string(), deleted: z.boolean() }),

  effect: 'write',
  autonomy: 'human_only',
  scopes: ['owner', 'admin'],
  // Deleting twice leaves the same absence. `deleted: false` says which happened.
  idempotent: true,
  surfaces: ['SET-WS-TEAM-GROUPS'],

  async handler(input, ctx) {
    const deleted = await ctx.db.teamGroups.remove({ orgId: ctx.orgId, id: input.groupId });
    ctx.logger.info('team group deleted', { orgId: ctx.orgId, groupId: input.groupId, deleted });
    return { groupId: input.groupId, deleted };
  },
});

/* ── team.group.member.set ──────────────────────────────────────────────── */

export const teamGroupMemberSet = defineTool({
  name: 'team.group.member.set',
  version: 1,

  summary: 'Add or remove one person from a team group.',

  input: z.object({
    groupId: z.string().min(1),
    userId: z.string().min(1),
    /** False removes them. */
    member: z.boolean().default(true),
  }),
  output: z.object({ groupId: z.string(), userId: z.string(), member: z.boolean(), memberCount: z.number() }),

  effect: 'write',
  autonomy: 'human_only',
  scopes: ['owner', 'admin'],
  idempotent: true,
  surfaces: ['SET-WS-TEAM-GROUPS'],

  async handler(input, ctx) {
    // Checked rather than assumed: `addMember` is scoped by org in every store,
    // so a wrong id is already a silent no-op — and a silent no-op on "add this
    // person to the publishing group" is the kind of thing somebody discovers a
    // fortnight later when their posts never went out.
    const groups = await ctx.db.teamGroups.list(ctx.orgId);
    if (!groups.some((g) => g.id === input.groupId)) {
      throw new ToolError('NOT_FOUND', 'No group with that id in this workspace.', { groupId: input.groupId });
    }

    if (input.member) {
      await ctx.db.teamGroups.addMember({ orgId: ctx.orgId, groupId: input.groupId, userId: input.userId });
    } else {
      await ctx.db.teamGroups.removeMember({ orgId: ctx.orgId, groupId: input.groupId, userId: input.userId });
    }

    const members = await ctx.db.teamGroups.members(ctx.orgId, input.groupId);
    ctx.logger.info('team group membership set', {
      orgId: ctx.orgId,
      groupId: input.groupId,
      userId: input.userId,
      member: input.member,
      by: ctx.userId ?? 'unknown',
    });

    return { groupId: input.groupId, userId: input.userId, member: input.member, memberCount: members.length };
  },
});

/* ── helpers ────────────────────────────────────────────────────────────── */

const dedupe = (values: string[]): string[] => [...new Set(values)];

const CAPABILITY_WORDS: Record<string, string> = {
  publish: 'publish, even if the workspace restricts publishing by role',
  spend_credits: 'spend credits, even where the workspace has spending switched off',
  manage_brand: 'change brand and genome settings',
  approve: 'approve work, including media generation that would otherwise wait',
};

/**
 * Invariant 4: changing who can publish is a decision somebody will want
 * explained later, and "capabilities: ['publish']" is not an explanation. The
 * `why` says what the group can actually now do, in the words the effect has.
 */
function explain(name: string, capabilities: string[], memberCount: number, verb: string): Explanation {
  return {
    summary: capabilities.length
      ? `${name} ${verb}: ${memberCount} member(s) may now ${capabilities.map((c) => CAPABILITY_WORDS[c] ?? c).join('; ')}.`
      : `${name} ${verb} with no capabilities, so it grants nothing yet — it is a list of ${memberCount} people.`,
    factors: capabilities.map((c) => ({ label: c, detail: CAPABILITY_WORDS[c] ?? 'unrecognised capability' })),
    evidence: [],
    // Worth stating explicitly, because the opposite is the natural assumption
    // about anything called "permissions".
    alternatives: [
      {
        option: 'restricting access with a group',
        rejectedBecause:
          'Groups only widen. To take access away, change the person’s role or the workspace permission.',
      },
    ],
  };
}

type Explanation = z.infer<typeof ExplanationSchema>;
