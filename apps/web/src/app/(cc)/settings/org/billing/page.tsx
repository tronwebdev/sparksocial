import { SettingsShell } from '@/components/settings/SettingsShell';
import { BillingSection } from '@/components/settings/BillingSection';

/**
 * `/settings/org/billing` — the credit balance, and where to top it up.
 *
 * This lived at `/settings/credits`, inside Brand Settings, which is where it
 * was found to be wrong: `org_budgets` and `credit_ledger` are both keyed on
 * `org_id` and `org.usage.get` takes no brand, so the balance on that screen
 * was shared by every brand in the organisation and displayed as though it
 * belonged to whichever one happened to be selected.
 */
export default function OrgBillingPage() {
  return (
    <SettingsShell
      heading="Billing & Credits"
      subtitle="What this organisation has spent, what is left, and how to buy more."
    >
      <BillingSection />
    </SettingsShell>
  );
}
