import { SettingsShell } from '@/components/settings/SettingsShell';
import { AgencyPanel } from '@/components/settings/AgencyPanel';

/**
 * `/organization/policies` — the plan and the organisation's defaults.
 *
 * Folded in from `/account`, which nothing linked to: the plan tier, the
 * default approval mode new brands start on, SSO and two-factor rules, data
 * residency and retention, and creating a brand. All org-scoped, all owner or
 * admin — which is why they belong here and not under a brand.
 */
export default function OrgPoliciesPage() {
  return (
    <SettingsShell
      heading="Plan & policies"
      subtitle="The plan, and the defaults every brand in this organisation starts from."
    >
      <AgencyPanel />
    </SettingsShell>
  );
}
