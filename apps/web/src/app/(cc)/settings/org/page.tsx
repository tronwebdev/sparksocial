import { SettingsShell } from '@/components/settings/SettingsShell';
import { OrgOverviewSection } from '@/components/settings/OrgOverviewSection';

/**
 * `/settings/org` — the organisation itself, and what "Account Settings" now
 * opens.
 *
 * That link used to go to `/settings`, which is one *brand's* settings. The
 * two had been conflated because there was no third scope: the prototype draws
 * `Settings PS *` for a person and `Settings WS *` for a workspace, and
 * nothing for the organisation that owns both.
 */
export default function OrgOverviewPage() {
  return (
    <SettingsShell heading="Organisation" subtitle="The account every brand in it shares.">
      <OrgOverviewSection />
    </SettingsShell>
  );
}
