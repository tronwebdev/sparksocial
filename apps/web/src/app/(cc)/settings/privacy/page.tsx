import { SettingsShell } from '@/components/settings/SettingsShell';
import { PrivacySection } from '@/components/settings/personal/PrivacySection';

/**
 * `Settings PS Privacy` — What is collected, and what you can take with you.
 *
 * In `(cc)` rather than `(app)`: the prototype is full-bleed on the same 1698
 * card as Calendar, Discovery and the Command Center, with its own Back button
 * and no sidebar. The route group changes no URL.
 */
export default function PrivacyPage() {
  return (
    <SettingsShell heading="Privacy" subtitle="What is collected, and what you can take with you.">
      <PrivacySection />
    </SettingsShell>
  );
}
