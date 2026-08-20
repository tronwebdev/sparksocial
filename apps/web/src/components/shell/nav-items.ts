import type { ComponentType, SVGProps } from 'react';
import {
  AccountIcon,
  AgentsIcon,
  DiscoveryIcon,
  CalendarIcon,
  AutomationIcon,
  EngagementIcon,
  AssetsIcon,
  HomeIcon,
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
 * Data, not code — adding a destination is a row here, never a branch in
 * `SidebarNav`. Order and label sizes are read off
 * `ui build/SparkSocial Dashboard.dc.html:553-561`; rows sit on a 65px pitch,
 * which `SidebarNav` reproduces with a 27px row height and a 38px gap.
 */
export const NAV_ITEMS: NavItem[] = [
  // `DASH-B-01` leads, because it is the screen that tells a new brand what to
  // do next; `agents` (the Command Center) is for a brand already running.
  { id: 'home', label: 'Home', href: '/home', icon: HomeIcon, labelPx: 18 },
  { id: 'agents', label: 'Agents', href: '/agents', icon: AgentsIcon, labelPx: 18 },
  { id: 'discovery', label: 'Discovery', href: '/discovery', icon: DiscoveryIcon, labelPx: 18 },
  { id: 'calendar', label: 'Calendar', href: '/calendar', icon: CalendarIcon, labelPx: 18 },
  { id: 'automation', label: 'Automation Recipes', href: '/automation', icon: AutomationIcon, labelPx: 18 },
  {
    id: 'engagement',
    label: 'Engagement Intelligence',
    href: '/command-center',
    icon: EngagementIcon,
    labelPx: 17,
  },
  { id: 'assets', label: 'Assets Library', href: '/assets', icon: AssetsIcon, labelPx: 18 },
  { id: 'settings', label: 'Settings', href: '/settings', icon: SettingsIcon, labelPx: 18 },
  // `DASH-A-01` — the org level. Last, because it is the one destination that
  // is *not* about the brand currently selected.
  { id: 'account', label: 'Account', href: '/account', icon: AccountIcon, labelPx: 18 },
];
