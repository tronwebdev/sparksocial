import { SettingsShell } from '@/components/settings/SettingsShell';
import { ConnectedSection } from '@/components/settings/personal/ConnectedSection';

/**
 * `Settings PS Connected Accounts` — The identities and services attached to your account.
 *
 * In `(cc)` rather than `(app)`: the prototype is full-bleed on the same 1698
 * card as Calendar, Discovery and the Command Center, with its own Back button
 * and no sidebar. The route group changes no URL.
 */
export default function ConnectedPage() {
  return (
    <SettingsShell heading="Connected Accounts" subtitle="The identities and services attached to your account.">
      <ConnectedSection />
    </SettingsShell>
  );
}
