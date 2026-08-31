import { OverviewPanel } from '@/components/settings/OverviewPanel';

/**
 * `SET-WS-OVERVIEW`, and the settings index.
 *
 * This route used to stack all ten panels. It now answers only the questions
 * you would otherwise open three sections to ask, and links to the section that
 * changes each — see `OverviewPanel` for why a summary that restates the next
 * screen is a screen people learn to skip.
 */
export default function SettingsOverviewPage() {
  return <OverviewPanel />;
}
