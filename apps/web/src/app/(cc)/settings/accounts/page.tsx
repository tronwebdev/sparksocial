import { SettingsShell } from '@/components/settings/SettingsShell';
import { AccountsSection } from '@/components/settings/AccountsSection';

/**
 * `Settings WS Social Accounts` — the accounts this brand publishes through.
 *
 * In `(cc)` rather than `(app)`: the prototype is full-bleed on the same 1698
 * card as Calendar, Discovery and the Command Center, with its own Back button
 * and no sidebar. The route group changes no URL.
 */
export default function AccountConnectionPage() {
  return (
    <SettingsShell
      heading="Social Accounts"
      subtitle="Connect your social media accounts to enhance your online presence."
    >
      <AccountsSection />
    </SettingsShell>
  );
}
