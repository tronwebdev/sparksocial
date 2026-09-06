import { SettingsShell } from '@/components/settings/SettingsShell';
import { PasswordSection } from '@/components/settings/personal/PasswordSection';

/**
 * `Settings PS Password & Security` — How you sign in, and what protects the account.
 *
 * In `(cc)` rather than `(app)`: the prototype is full-bleed on the same 1698
 * card as Calendar, Discovery and the Command Center, with its own Back button
 * and no sidebar. The route group changes no URL.
 */
export default function PasswordPage() {
  return (
    <SettingsShell heading="Password & Security" subtitle="How you sign in, and what protects the account.">
      <PasswordSection />
    </SettingsShell>
  );
}
