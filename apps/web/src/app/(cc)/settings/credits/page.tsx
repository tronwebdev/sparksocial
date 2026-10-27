import { SettingsShell } from '@/components/settings/SettingsShell';
import { BrandUsageSection } from '@/components/settings/BrandUsageSection';

/**
 * `/settings/credits` — this brand's Credit & Usage.
 *
 * It redirected to the organisation's billing, because it had been showing the
 * organisation's balance as though it were the selected brand's. The brand's
 * own numbers exist now (`brand.usage.get`), so the path is a brand screen
 * again — and the organisation's balance stays where it moved to.
 */
export default function CreditsPage() {
  return (
    <SettingsShell heading="Credit & Usage" subtitle="What this brand spent this month, and on what.">
      <BrandUsageSection />
    </SettingsShell>
  );
}
