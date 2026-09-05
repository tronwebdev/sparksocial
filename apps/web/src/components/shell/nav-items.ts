import type { ComponentType, SVGProps } from 'react';
import {
  AgentsIcon,
  DiscoveryIcon,
  CalendarIcon,
  AutomationIcon,
  EngagementIcon,
  AssetsIcon,
  SettingsIcon,
} from './nav-icons';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Prototype label size. "Engagement Intelligence" is 17px, the rest 18px. */
  labelPx: 17 | 18;
}

/**
 * Data, not code - adding a destination is a row here, never a branch in
 * `SidebarNav`. Order and label sizes come from `navDefs` in the prototypes,
 * which is identical across Dashboard, Assets Library and Automation: rows on a
 * 65px pitch, and "Engagement Intelligence" alone at 17px because it is the one
 * label that would otherwise wrap.
 *
 * ── Two rows I had added, now gone ───────────────────────────────────────
 *
 * `home` and `account` were mine. Every prototype's nav is exactly these seven,
 * and neither destination is lost:
 *
 *   Home     the Agents row *is* the dashboard. `Dashboard.dc.html` renders
 *            Brand Home with the glow on the first row and "Agents" in
 *            `#0C0C0C`, which is the design saying these are one destination,
 *            not two. Pointing this row at `/agents` split them: the row lit up
 *            on the Command Center and went dark on the screen the design draws
 *            it lit on, and `/home` was reachable only from the wordmark.
 *            `SidebarNav` needed a special case to fake the parked glow; with
 *            the href correct the ordinary match produces it and that case is
 *            gone. The Command Center keeps its own route, reached from the
 *            banner's "Command Center" button.
 *   Account  lives under the workspace switcher as "Account Home / All
 *            workspaces & organization", which is the row `Dashboard.dc.html`
 *            draws in that dropdown and which now points at `/workspaces`.
 *
 * That matters beyond tidiness: nine rows on a 65px pitch is 585px of nav, and
 * the prototype's Pro plan card is pinned at y=1023. Two extra rows push the
 * nav into it at any viewport shorter than the 1409px stage.
 */
export const NAV_ITEMS: NavItem[] = [
  { id: 'agents', label: 'Agents', href: '/home', icon: AgentsIcon, labelPx: 18 },
  { id: 'discovery', label: 'Discovery', href: '/discovery', icon: DiscoveryIcon, labelPx: 18 },
  { id: 'calendar', label: 'Calendar', href: '/calendar', icon: CalendarIcon, labelPx: 18 },
  { id: 'automation', label: 'Automation Recipes', href: '/automation', icon: AutomationIcon, labelPx: 18 },
  {
    id: 'engagement',
    label: 'Engagement Intelligence',
    /**
     * Points into the Command Center's tab, not at a screen of its own.
     *
     * Engagement Intelligence is one of the Command Center's four tabs
     * (`app/(cc)/agents/page.tsx`), and it was also a standalone route — the
     * same feed in two places, reachable two ways, with a sidebar on one and
     * not the other. One destination now; `/engagement` redirects here so old
     * links and bookmarks still land somewhere real.
     */
    href: '/agents?tab=engagement',
    icon: EngagementIcon,
    labelPx: 17,
  },
  { id: 'assets', label: 'Assets Library', href: '/assets', icon: AssetsIcon, labelPx: 18 },
  { id: 'settings', label: 'Settings', href: '/settings', icon: SettingsIcon, labelPx: 18 },
];
