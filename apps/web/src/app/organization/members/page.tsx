import { SettingsShell } from '@/components/settings/SettingsShell';
import { TeamPanel } from '@/components/account/TeamPanel';

/**
 * `/organization/members` — who is in the organisation, and what each can reach.
 *
 * Folded in from `/account`. Membership and org role are Clerk's and
 * org-wide (`team.list`, `team.role.set`); which brands a member reaches is
 * `brand_members` (`team.permission.set`). Both are about the organisation,
 * so they live on its screen.
 */
export default function OrgMembersPage() {
  return (
    <SettingsShell heading="Members" subtitle="Everyone in this organisation, their role, and the brands they can reach.">
      <TeamPanel />
    </SettingsShell>
  );
}
