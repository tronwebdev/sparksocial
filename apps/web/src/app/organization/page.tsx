import { SettingsShell } from '@/components/settings/SettingsShell';
import { OrgOverviewSection } from '@/components/settings/OrgOverviewSection';

export default function OrganizationPage() {
  return (
    <SettingsShell heading="Organisation" subtitle="The account every brand in it shares.">
      <OrgOverviewSection />
    </SettingsShell>
  );
}
