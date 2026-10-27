import { SettingsShell } from '@/components/settings/SettingsShell';
import { AuditPanel } from '@/components/account/AuditPanel';

/**
 * `/organization/audit` — who did what, across every brand.
 *
 * `org.audit.query` has always been org-scoped; the panel that reads it sat
 * under the account area with no route in the settings tree pointing at it.
 */
export default function OrgAuditPage() {
  return (
    <SettingsShell heading="Audit log" subtitle="Every recorded action in this organisation, newest first.">
      <AuditPanel />
    </SettingsShell>
  );
}
