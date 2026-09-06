import { SettingsShell } from '@/components/settings/SettingsShell';
import { AccessibilitySection } from '@/components/settings/personal/AccessibilitySection';

/**
 * `Settings PS Accessibility & Editor` — How the interface behaves while you work in it.
 *
 * In `(cc)` rather than `(app)`: the prototype is full-bleed on the same 1698
 * card as Calendar, Discovery and the Command Center, with its own Back button
 * and no sidebar. The route group changes no URL.
 */
export default function AccessibilityPage() {
  return (
    <SettingsShell heading="Accessibility & Editor" subtitle="How the interface behaves while you work in it.">
      <AccessibilitySection />
    </SettingsShell>
  );
}
