import { SettingsShell } from '@/components/settings/SettingsShell';
import { TeamRolesSection } from '@/components/settings/TeamRolesSection';

/**
 * `Settings WS Team Users / Groups` — the Users and Groups tabs, and approval flows.
 *
 * In `(cc)` rather than `(app)`: the prototype is full-bleed on the same 1698
 * card as Calendar, Discovery and the Command Center, with its own Back button
 * and no sidebar. The route group changes no URL.
 */
export default function TeamRolesPage() {
  return (
    <SettingsShell
      heading="Team Roles"
      subtitle="An overview of team roles, emphasizing each member’s responsibilities and contributions."
    >
      <TeamRolesSection />
    </SettingsShell>
  );
}
