import { SettingsShell } from '@/components/settings/SettingsShell';
import { ProfileSection } from '@/components/settings/personal/ProfileSection';

/**
 * `Settings PS Profile Settings` — This information is visible to your workspace.
 *
 * In `(cc)` rather than `(app)`: the prototype is full-bleed on the same 1698
 * card as Calendar, Discovery and the Command Center, with its own Back button
 * and no sidebar. The route group changes no URL.
 */
export default function ProfilePage() {
  return (
    <SettingsShell heading="Profile Settings" subtitle="This information is visible to your workspace.">
      <ProfileSection />
    </SettingsShell>
  );
}
