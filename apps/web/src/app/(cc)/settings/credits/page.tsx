import { SettingsShell } from '@/components/settings/SettingsShell';
import { CreditUsageSection } from '@/components/settings/CreditUsageSection';

/**
 * `Settings WS Credit Usage` — what the organisation has spent and what is left.
 *
 * In `(cc)` rather than `(app)`: the prototype is full-bleed on the same 1698
 * card as Calendar, Discovery and the Command Center, with its own Back button
 * and no sidebar. The route group changes no URL.
 */
export default function CreditUsagePage() {
  return (
    <SettingsShell
      heading="Credit & Usage"
      subtitle="What this organisation has spent, on what, and how much of the plan is left."
    >
      <CreditUsageSection />
    </SettingsShell>
  );
}
