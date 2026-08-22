import type { TeamGroupStore } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import * as scoped from './scoped.js';

/**
 * `team_groups` / `team_group_members` backed by Postgres.
 *
 * Org-scoped rather than genome-scoped, unlike almost everything else reached
 * through `ScopedDb` — see `listTeamGroups` in `scoped.ts` for why that is a
 * deliberate exception and not an oversight: a group names the agency's own
 * staff, who work across several clients by design, and these two tables carry
 * no client material at all.
 */
export function createTeamGroupRepository(db: Database): TeamGroupStore {
  return {
    list: (orgId) => scoped.listTeamGroups(db, orgId),
    create: ({ orgId, ...args }) => scoped.createTeamGroup(db, orgId, args),
    update: ({ orgId, ...args }) => scoped.updateTeamGroup(db, orgId, args),
    remove: ({ orgId, id }) => scoped.deleteTeamGroup(db, orgId, id),
    members: (orgId, groupId) => scoped.listTeamGroupMembers(db, orgId, groupId),
    addMember: ({ orgId, ...args }) => scoped.addTeamGroupMember(db, orgId, args),
    removeMember: ({ orgId, ...args }) => scoped.removeTeamGroupMember(db, orgId, args),
    capabilitiesForUser: (orgId, userId) => scoped.capabilitiesForUser(db, orgId, userId),
  };
}
