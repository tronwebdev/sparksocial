import { SettingsShell } from '@/components/settings/SettingsShell';
import { BrandTransferPanel } from '@/components/account/BrandTransferPanel';

/**
 * `/organization/transfer` — moving a brand into or out of this organisation.
 *
 * Folded in from `/account`. Moving a brand between accounts is something an
 * organisation does to one of its brands, not something a brand does to itself,
 * so it sits here rather than under the brand's own Import / Export.
 */
export default function OrgTransferPage() {
  return (
    <SettingsShell heading="Move a brand" subtitle="Take a brand to another account, or bring one in.">
      <BrandTransferPanel />
    </SettingsShell>
  );
}
