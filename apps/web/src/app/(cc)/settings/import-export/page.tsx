import { SettingsShell } from '@/components/settings/SettingsShell';
import { ImportExportSection } from '@/components/settings/ImportExportSection';

/**
 * `Settings WS Export / Import / Clone` — the three tabs of moving a brand.
 *
 * In `(cc)` rather than `(app)`: the prototype is full-bleed on the same 1698
 * card as Calendar, Discovery and the Command Center, with its own Back button
 * and no sidebar. The route group changes no URL.
 */
export default function ImportExportPage() {
  return (
    <SettingsShell
      heading="Import & Export Workspace"
      subtitle="Move assets, templates and settings between workspaces. Bundle a complete copy or clone an entire environment."
    >
      <ImportExportSection />
    </SettingsShell>
  );
}
