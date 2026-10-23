import { SettingsShell } from '@/components/settings/SettingsShell';
import { BrandBudgetsSection } from '@/components/settings/BrandBudgetsSection';

/**
 * `/settings/org/brands` — how the shared balance divides between clients.
 *
 * The ledger has carried `brand_id` on every row since it was written, so an
 * agency could always see that one client had eaten the month. It could not
 * stop the next one. This is where that stops.
 */
export default function OrgBrandBudgetsPage() {
  return (
    <SettingsShell
      heading="Brand budgets"
      subtitle="A hard monthly limit per brand. A brand that reaches its limit stops spending until the month turns."
    >
      <BrandBudgetsSection />
    </SettingsShell>
  );
}
