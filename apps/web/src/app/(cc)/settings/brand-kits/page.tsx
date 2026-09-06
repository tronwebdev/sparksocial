import { SettingsShell } from '@/components/settings/SettingsShell';
import { BrandKitsSection } from '@/components/settings/BrandKitsSection';

/**
 * `Settings WS Brand Kits` — everything that decides what a post sounds and
 * looks like.
 *
 * In `(cc)` rather than `(app)`: the prototype is full-bleed on the same 1698
 * card as Calendar, Discovery and the Command Center, with its own Back button
 * and no sidebar. The route group changes no URL.
 */
export default function BrandKitsPage() {
  return (
    <SettingsShell
      heading="Brand Kits"
      subtitle="Voice, guardrails, logo and colours, what SPARK knows, and whose face and voice it may use."
    >
      <BrandKitsSection />
    </SettingsShell>
  );
}
