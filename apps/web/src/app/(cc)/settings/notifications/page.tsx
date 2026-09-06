import { SettingsShell } from '@/components/settings/SettingsShell';
import { NotificationsSection } from '@/components/settings/personal/NotificationsSection';

/**
 * `Settings PS Notifications` — What reaches you, and where.
 *
 * In `(cc)` rather than `(app)`: the prototype is full-bleed on the same 1698
 * card as Calendar, Discovery and the Command Center, with its own Back button
 * and no sidebar. The route group changes no URL.
 */
export default function NotificationsPage() {
  return (
    <SettingsShell heading="Notifications" subtitle="What reaches you, and where.">
      <NotificationsSection />
    </SettingsShell>
  );
}
