import { SettingsShell } from '@/components/settings/SettingsShell';
import { EngagementSection } from '@/components/settings/EngagementSection';

/**
 * `Settings WS Engagement*` — the five-step Engagement Intelligence wizard and its two entry states.
 *
 * In `(cc)` rather than `(app)`: the prototype is full-bleed on the same 1698
 * card as Calendar, Discovery and the Command Center, with its own Back button
 * and no sidebar. The route group changes no URL.
 */
export default function EngagementSettingsPage() {
  return (
    <SettingsShell heading="Engagement Intelligence" bare>
      <EngagementSection />
    </SettingsShell>
  );
}
