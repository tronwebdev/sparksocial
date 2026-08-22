import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import {
  teamGroupCreate,
  teamGroupDelete,
  teamGroupList,
  teamGroupMemberSet,
  teamGroupUpdate,
} from '../src/teamGroups.js';

/**
 * TEAM GROUPS (`SET-WS-TEAM-GROUPS`) — the tool surface.
 *
 * `team.invite`/`team.role.set` put somebody on the org ladder and
 * `team.permission.set` scopes them to a client's brand. Neither could express
 * "these four people may publish and approve, whatever their role says", because
 * a role is a fixed rung compiled into every tool's `scopes`.
 *
 * What is enforced lives in `policy.ts` and is tested there. What is tested here
 * is that the configuration a person types on that screen survives, and that the
 * ways it can go wrong are refusals rather than silent no-ops — the failure mode
 * for a permission screen is somebody discovering a fortnight later that their
 * posts never went out.
 */

/** A minimal in-memory `TeamGroupStore`, mirroring the real uniqueness rules. */
function store() {
  const groups = new Map<string, { id: string; orgId: string; name: string; capabilities: string[] }>();
  const members = new Set<string>();
  let next = 1;

  const memberIds = (groupId: string) =>
    [...members].filter((k) => k.startsWith(`${groupId}:`)).map((k) => k.slice(groupId.length + 1));

  const shape = (g: { id: string; name: string; capabilities: string[] }) => ({
    ...g,
    memberCount: memberIds(g.id).length,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });

  return {
    groups,
    members,
    db: {
      teamGroups: {
        async list(orgId: string) {
          return [...groups.values()].filter((g) => g.orgId === orgId).map(shape);
        },
        async create({ orgId, name, capabilities }: { orgId: string; name: string; capabilities: string[] }) {
          const id = `grp_${next++}`;
          const row = { id, orgId, name, capabilities };
          groups.set(id, row);
          return shape(row);
        },
        async update({
          orgId,
          id,
          name,
          capabilities,
        }: {
          orgId: string;
          id: string;
          name?: string;
          capabilities?: string[];
        }) {
          const row = groups.get(id);
          if (!row || row.orgId !== orgId) return undefined;
          if (name !== undefined) row.name = name;
          if (capabilities !== undefined) row.capabilities = capabilities;
          return shape(row);
        },
        async remove({ orgId, id }: { orgId: string; id: string }) {
          const row = groups.get(id);
          if (!row || row.orgId !== orgId) return false;
          for (const k of [...members]) if (k.startsWith(`${id}:`)) members.delete(k);
          groups.delete(id);
          return true;
        },
        async members(orgId: string, groupId: string) {
          const row = groups.get(groupId);
          return row && row.orgId === orgId ? memberIds(groupId) : [];
        },
        async addMember({ groupId, userId }: { groupId: string; userId: string }) {
          members.add(`${groupId}:${userId}`);
        },
        async removeMember({ groupId, userId }: { groupId: string; userId: string }) {
          members.delete(`${groupId}:${userId}`);
        },
        async capabilitiesForUser(orgId: string, userId: string) {
          const union = new Set<string>();
          for (const k of members) {
            const [groupId, member] = k.split(':');
            if (member !== userId) continue;
            const row = groups.get(groupId!);
            if (!row || row.orgId !== orgId) continue;
            for (const c of row.capabilities) union.add(c);
          }
          return [...union].sort();
        },
      },
    },
  };
}

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

describe('team.group.create', () => {
  it('creates a group with its capabilities and members', async () => {
    const s = store();
    const out = await teamGroupCreate.handler(
      { name: 'Video Production', capabilities: ['publish', 'approve'], members: ['user_2', 'user_3'] },
      ctx(s.db),
    );

    expect(out.name).toBe('Video Production');
    expect(out.capabilities).toEqual(['publish', 'approve']);
    expect(out.memberCount).toBe(2);
  });

  it('refuses a duplicate name in the same workspace', async () => {
    // Two groups called "Design Team" is a mistake every time, and the person
    // who made it cannot tell them apart on the screen.
    const s = store();
    await teamGroupCreate.handler({ name: 'Design Team', capabilities: [], members: [] }, ctx(s.db));

    await expect(
      teamGroupCreate.handler({ name: 'design team', capabilities: [], members: [] }, ctx(s.db)),
    ).rejects.toThrow(ToolError);
  });

  it('refuses a name that is only whitespace', async () => {
    const s = store();
    await expect(
      teamGroupCreate.handler({ name: '   ', capabilities: [], members: [] }, ctx(s.db)),
    ).rejects.toThrow(ToolError);
  });

  it('does not add the same person twice', async () => {
    const s = store();
    const out = await teamGroupCreate.handler(
      { name: 'Social', capabilities: [], members: ['user_2', 'user_2'] },
      ctx(s.db),
    );

    expect(out.memberCount).toBe(1);
  });

  it('says what the group can actually do, not what its config says', async () => {
    // Invariant 4: changing who can publish is a decision somebody will want
    // explained later, and `capabilities: ['publish']` is not an explanation.
    const s = store();
    const out = await teamGroupCreate.handler(
      { name: 'Publishers', capabilities: ['publish'], members: ['user_2'] },
      ctx(s.db),
    );

    expect(out.why.summary).toMatch(/may now publish/);
    expect(out.why.factors[0]!.detail).toMatch(/restricts publishing by role/);
  });

  it('is honest about a group that grants nothing', async () => {
    const s = store();
    const out = await teamGroupCreate.handler({ name: 'Interns', capabilities: [], members: ['user_9'] }, ctx(s.db));

    expect(out.why.summary).toMatch(/grants nothing yet/);
  });

  it('states that groups cannot take access away', async () => {
    // The opposite is the natural assumption about anything called
    // "permissions", so the why says it outright.
    const s = store();
    const out = await teamGroupCreate.handler({ name: 'Design', capabilities: ['approve'], members: [] }, ctx(s.db));

    expect(out.why.alternatives[0]!.rejectedBecause).toMatch(/only widen/i);
  });
});

describe('team.group.update', () => {
  it('changes capabilities without touching the name', async () => {
    const s = store();
    const created = await teamGroupCreate.handler(
      { name: 'Video', capabilities: ['publish'], members: ['user_2'] },
      ctx(s.db),
    );

    const out = await teamGroupUpdate.handler({ groupId: created.id, capabilities: ['approve'] }, ctx(s.db));

    expect(out.name).toBe('Video');
    expect(out.capabilities).toEqual(['approve']);
    // Membership survives an edit to the capability list.
    expect(out.memberCount).toBe(1);
  });

  it('renames without touching capabilities', async () => {
    const s = store();
    const created = await teamGroupCreate.handler(
      { name: 'Video', capabilities: ['publish'], members: [] },
      ctx(s.db),
    );

    const out = await teamGroupUpdate.handler({ groupId: created.id, name: 'Video Production' }, ctx(s.db));

    expect(out.name).toBe('Video Production');
    expect(out.capabilities).toEqual(['publish']);
  });

  it('refuses a group id from another workspace', async () => {
    const s = store();
    const created = await teamGroupCreate.handler({ name: 'Video', capabilities: [], members: [] }, ctx(s.db));

    await expect(
      teamGroupUpdate.handler({ groupId: created.id, name: 'Mine now' }, ctx(s.db, { orgId: 'org_2' })),
    ).rejects.toThrow(ToolError);
  });

  it('refuses an unknown group rather than reporting success', async () => {
    const s = store();
    await expect(teamGroupUpdate.handler({ groupId: 'grp_nope', name: 'x' }, ctx(s.db))).rejects.toThrow(ToolError);
  });
});

describe('team.group.delete', () => {
  it('deletes the group and its memberships', async () => {
    // An orphaned membership either grants nothing, which is confusing, or —
    // after an id reuse — grants something nobody chose.
    const s = store();
    const created = await teamGroupCreate.handler(
      { name: 'Video', capabilities: ['publish'], members: ['user_2'] },
      ctx(s.db),
    );

    const out = await teamGroupDelete.handler({ groupId: created.id }, ctx(s.db));

    expect(out.deleted).toBe(true);
    expect(s.members.size).toBe(0);
    expect(await s.db.teamGroups.capabilitiesForUser('org_1', 'user_2')).toEqual([]);
  });

  it('reports a second delete as a no-op rather than failing', async () => {
    const s = store();
    const created = await teamGroupCreate.handler({ name: 'Video', capabilities: [], members: [] }, ctx(s.db));
    await teamGroupDelete.handler({ groupId: created.id }, ctx(s.db));

    const out = await teamGroupDelete.handler({ groupId: created.id }, ctx(s.db));
    expect(out.deleted).toBe(false);
  });

  it('will not delete another workspace’s group', async () => {
    const s = store();
    const created = await teamGroupCreate.handler({ name: 'Video', capabilities: [], members: [] }, ctx(s.db));

    const out = await teamGroupDelete.handler({ groupId: created.id }, ctx(s.db, { orgId: 'org_2' }));

    expect(out.deleted).toBe(false);
    expect(s.groups.size).toBe(1);
  });
});

describe('team.group.member.set', () => {
  it('adds somebody, and their capabilities follow', async () => {
    const s = store();
    const created = await teamGroupCreate.handler(
      { name: 'Publishers', capabilities: ['publish'], members: [] },
      ctx(s.db),
    );

    const out = await teamGroupMemberSet.handler({ groupId: created.id, userId: 'user_5', member: true }, ctx(s.db));

    expect(out.memberCount).toBe(1);
    expect(await s.db.teamGroups.capabilitiesForUser('org_1', 'user_5')).toEqual(['publish']);
  });

  it('removes somebody, and their capabilities go with them', async () => {
    const s = store();
    const created = await teamGroupCreate.handler(
      { name: 'Publishers', capabilities: ['publish'], members: ['user_5'] },
      ctx(s.db),
    );

    await teamGroupMemberSet.handler({ groupId: created.id, userId: 'user_5', member: false }, ctx(s.db));

    expect(await s.db.teamGroups.capabilitiesForUser('org_1', 'user_5')).toEqual([]);
  });

  it('adding twice is one membership', async () => {
    const s = store();
    const created = await teamGroupCreate.handler({ name: 'P', capabilities: [], members: [] }, ctx(s.db));

    await teamGroupMemberSet.handler({ groupId: created.id, userId: 'user_5', member: true }, ctx(s.db));
    const out = await teamGroupMemberSet.handler({ groupId: created.id, userId: 'user_5', member: true }, ctx(s.db));

    expect(out.memberCount).toBe(1);
  });

  it('refuses an unknown group instead of quietly doing nothing', async () => {
    // The store is org-scoped, so a wrong id would already be a silent no-op —
    // and a silent no-op on "add this person to the publishing group" is
    // discovered a fortnight later, by their posts not going out.
    const s = store();
    await expect(
      teamGroupMemberSet.handler({ groupId: 'grp_nope', userId: 'user_5', member: true }, ctx(s.db)),
    ).rejects.toThrow(ToolError);
  });

  it('refuses a group belonging to another workspace', async () => {
    const s = store();
    const created = await teamGroupCreate.handler({ name: 'P', capabilities: [], members: [] }, ctx(s.db));

    await expect(
      teamGroupMemberSet.handler(
        { groupId: created.id, userId: 'user_5', member: true },
        ctx(s.db, { orgId: 'org_2' }),
      ),
    ).rejects.toThrow(ToolError);
  });
});

describe('team.group.list', () => {
  it('returns each group with its members inline', async () => {
    const s = store();
    await teamGroupCreate.handler({ name: 'Design Team', capabilities: ['approve'], members: ['user_2'] }, ctx(s.db));
    await teamGroupCreate.handler({ name: 'Video', capabilities: ['publish'], members: ['user_3', 'user_4'] }, ctx(s.db));

    const out = await teamGroupList.handler({}, ctx(s.db));

    expect(out.groups).toHaveLength(2);
    expect(out.groups.find((g) => g.name === 'Video')!.members.sort()).toEqual(['user_3', 'user_4']);
  });

  it('does not show another workspace’s groups', async () => {
    const s = store();
    await teamGroupCreate.handler({ name: 'Design Team', capabilities: [], members: [] }, ctx(s.db));

    const out = await teamGroupList.handler({}, ctx(s.db, { orgId: 'org_2' }));

    expect(out.groups).toEqual([]);
  });

  it('is readable by every role', async () => {
    // Somebody refused an action has to be able to see the rule that refused
    // them; "you are not in the publishing group" is unactionable otherwise.
    expect(teamGroupList.scopes).toContain('viewer');
    expect(teamGroupList.effect).toBe('read');
  });
});

describe('the agent may read groups and never write one', () => {
  it('declares every write human_only', () => {
    // An agent that can add itself to the publishing group is not gated by the
    // publishing group — the same asymmetry `brand.governance.set` relies on.
    for (const tool of [teamGroupCreate, teamGroupUpdate, teamGroupDelete, teamGroupMemberSet]) {
      expect(tool.autonomy).toBe('human_only');
      expect(tool.scopes).toEqual(['owner', 'admin']);
    }
    expect(teamGroupList.autonomy).toBe('auto');
  });
});

describe('capabilitiesForUser', () => {
  it('unions across groups rather than intersecting', async () => {
    // Adding somebody to a second group must not silently remove access, which
    // is what intersecting would do.
    const s = store();
    await teamGroupCreate.handler({ name: 'Video', capabilities: ['publish'], members: ['user_7'] }, ctx(s.db));
    await teamGroupCreate.handler({ name: 'Design', capabilities: ['approve'], members: ['user_7'] }, ctx(s.db));

    expect(await s.db.teamGroups.capabilitiesForUser('org_1', 'user_7')).toEqual(['approve', 'publish']);
  });

  it('gives somebody in no group nothing at all', async () => {
    const s = store();
    await teamGroupCreate.handler({ name: 'Video', capabilities: ['publish'], members: ['user_7'] }, ctx(s.db));

    expect(await s.db.teamGroups.capabilitiesForUser('org_1', 'user_8')).toEqual([]);
  });
});
