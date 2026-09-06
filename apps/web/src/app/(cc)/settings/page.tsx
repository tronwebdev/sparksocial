import { SettingsShell } from '@/components/settings/SettingsShell';
import { OverviewSection } from '@/components/settings/OverviewSection';

/**
 * `Settings WS Overview` — the brand's identity and the three facts worth reading first.
 *
 * In `(cc)` rather than `(app)`: the prototype is full-bleed on the same 1698
 * card as Calendar, Discovery and the Command Center, with its own Back button
 * and no sidebar. The route group changes no URL.
 */
export default function SettingsOverviewPage() {
  return (
    /*
      `bare`: unlike every other section, the design's Overview card carries no
      heading band — it opens straight onto the cyan banner at 8,8. So the
      section owns its own card.
    */
    <SettingsShell heading="Overview" bare>
      <OverviewSection />
    </SettingsShell>
  );
}
