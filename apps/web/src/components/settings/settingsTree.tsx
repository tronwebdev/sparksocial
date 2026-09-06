import type { ReactNode } from 'react';

/**
 * The two navigation trees of `ui build/Settings *.dc.html`.
 *
 * The prototype's router maps thirteen hash sections onto twenty-six screens:
 * seven under Workspace Settings, six under Personal Settings, and the rest are
 * states *within* a section (the Engagement wizard's five steps, Team Roles'
 * Users/Groups split, Import/Export/Clone). Only the thirteen are routes here;
 * the others are local state, which is what they are in the prototype too.
 *
 * ── Two deviations from the prototype's own labels ────────────────────────
 *
 * "Noifitcations" and "Sava Changes" are typos in the design file. They are
 * spelled correctly here — matching a prototype means matching its geometry and
 * intent, not reproducing a slip that would ship to users.
 *
 * "Workspace" is the prototype's word throughout; the product says **brand**
 * (the 22 August naming decision), and the rest of the app says brand
 * everywhere. The pill keeps the design's two-word shape but reads
 * "Brand Settings" / "Personal Settings" so this screen does not become the one
 * place the product calls a brand something else.
 */

export type SettingsTree = 'brand' | 'personal';

export interface SettingsSection {
  href: string;
  label: string;
  icon: ReactNode;
}

const S = {
  stroke: 'currentColor',
  strokeWidth: 1.6,
  fill: 'none',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/* The nav glyphs, each 19px in the design and redrawn — the prototype pulls
   them from a sprite sheet that is not part of the app. */
const Icons = {
  overview: (
    <svg width="19" height="19" viewBox="0 0 19 19" aria-hidden>
      <rect x="1" y="1" width="7.4" height="7.4" rx="2" {...S} />
      <rect x="10.6" y="1" width="7.4" height="7.4" rx="2" {...S} />
      <rect x="1" y="10.6" width="7.4" height="7.4" rx="2" {...S} />
      <rect x="10.6" y="10.6" width="7.4" height="7.4" rx="2" {...S} />
    </svg>
  ),
  brandKits: (
    <svg width="19" height="19" viewBox="0 0 19 19" aria-hidden>
      <path d="M9.5 1.2 2 5.3v8.4l7.5 4.1 7.5-4.1V5.3L9.5 1.2Z" {...S} />
      <path d="M2 5.3l7.5 4.1 7.5-4.1M9.5 9.4v8.4" {...S} />
    </svg>
  ),
  engagement: (
    <svg width="19" height="20" viewBox="0 0 19 20" aria-hidden>
      <path d="M17.8 9.2c0 4-3.7 7.2-8.3 7.2a9.5 9.5 0 0 1-2.6-.35L2.2 18l1.1-3.5A6.8 6.8 0 0 1 1.2 9.2C1.2 5.2 4.9 2 9.5 2s8.3 3.2 8.3 7.2Z" {...S} />
      <path d="M6.4 8.8h6.2M6.4 11.6h4" {...S} />
    </svg>
  ),
  accounts: (
    <svg width="19" height="19" viewBox="0 0 19 19" aria-hidden>
      <path d="M7.8 11.2a3.7 3.7 0 0 0 5.3 0l3.1-3.1a3.75 3.75 0 0 0-5.3-5.3l-1 1" {...S} />
      <path d="M11.2 7.8a3.7 3.7 0 0 0-5.3 0l-3.1 3.1a3.75 3.75 0 0 0 5.3 5.3l1-1" {...S} />
    </svg>
  ),
  importExport: (
    <svg width="19" height="18" viewBox="0 0 19 18" aria-hidden>
      <path d="M1 16.8h17" {...S} />
      <path d="M5.2 8.4 5.2 1m0 0L2.4 3.8M5.2 1 8 3.8" {...S} />
      <path d="M13.8 1v7.4m0 0L11 5.6m2.8 2.8 2.8-2.8" {...S} />
    </svg>
  ),
  credits: (
    <svg width="21" height="15" viewBox="0 0 21 15" aria-hidden>
      <rect x="1" y="1" width="19" height="13" rx="2.4" {...S} />
      <path d="M1 5.4h19" {...S} />
      <path d="M4.4 10h3.6" {...S} />
    </svg>
  ),
  team: (
    <svg width="19" height="19" viewBox="0 0 19 19" aria-hidden>
      <circle cx="9.5" cy="4.6" r="3" {...S} />
      <path d="M3.4 17c0-3 2.7-5.2 6.1-5.2s6.1 2.2 6.1 5.2" {...S} />
      <circle cx="2.9" cy="7.2" r="1.9" {...S} />
      <circle cx="16.1" cy="7.2" r="1.9" {...S} />
    </svg>
  ),
  profile: (
    <svg width="21" height="21" viewBox="0 0 21 21" aria-hidden>
      <circle cx="10.5" cy="6.8" r="3.9" {...S} />
      <path d="M3 18.6c0-3.4 3.4-5.9 7.5-5.9s7.5 2.5 7.5 5.9" {...S} />
    </svg>
  ),
  password: (
    <svg width="19" height="19" viewBox="0 0 19 19" aria-hidden>
      <rect x="3" y="8.2" width="13" height="9.4" rx="2.2" {...S} />
      <path d="M6.3 8.2V5.6a3.2 3.2 0 0 1 6.4 0v2.6" {...S} />
      <circle cx="9.5" cy="12.6" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  ),
  notifications: (
    <svg width="17" height="20" viewBox="0 0 17 20" aria-hidden>
      <path d="M14 13.6V8.4a5.5 5.5 0 0 0-11 0v5.2L1.3 16h14.4L14 13.6Z" {...S} />
      <path d="M6.6 16.6a2 2 0 0 0 3.8 0" {...S} />
    </svg>
  ),
  connected: (
    <svg width="19" height="19" viewBox="0 0 19 19" aria-hidden>
      <rect x="1.2" y="4" width="16.6" height="11.4" rx="2.4" {...S} />
      <path d="M1.2 8.2h16.6M5 12h3.4" {...S} />
    </svg>
  ),
  accessibility: (
    <svg width="19" height="19" viewBox="0 0 19 19" aria-hidden>
      <circle cx="9.5" cy="9.5" r="8.2" {...S} />
      <circle cx="9.5" cy="5.4" r="1.3" fill="currentColor" stroke="none" />
      <path d="M5.6 8.1h7.8M9.5 8.6v3.2m0 0-2 4.1m2-4.1 2 4.1" {...S} />
    </svg>
  ),
  privacy: (
    <svg width="19" height="20" viewBox="0 0 19 20" aria-hidden>
      <path d="M9.5 1.4 2.4 4.5v5.2c0 4.4 3 7.6 7.1 8.9 4.1-1.3 7.1-4.5 7.1-8.9V4.5L9.5 1.4Z" {...S} />
      <path d="m6.6 9.8 2.2 2.2 4.1-4.4" {...S} />
    </svg>
  ),
};

/** Workspace Settings — the prototype's seven, in its order. */
export const BRAND_SECTIONS: readonly SettingsSection[] = [
  { href: '/settings', label: 'Overview', icon: Icons.overview },
  { href: '/settings/brand-kits', label: 'Brand kits', icon: Icons.brandKits },
  { href: '/settings/engagement', label: 'Engagement Intelligence', icon: Icons.engagement },
  { href: '/settings/accounts', label: 'Account Connection', icon: Icons.accounts },
  { href: '/settings/import-export', label: 'Import / Export', icon: Icons.importExport },
  { href: '/settings/credits', label: 'Credit & Usage', icon: Icons.credits },
  { href: '/settings/team', label: 'Team Roles', icon: Icons.team },
];

/** Personal Settings — the prototype's six, in its order. */
export const PERSONAL_SECTIONS: readonly SettingsSection[] = [
  { href: '/settings/profile', label: 'Profile', icon: Icons.profile },
  { href: '/settings/password', label: 'Password & Security', icon: Icons.password },
  { href: '/settings/notifications', label: 'Notifications', icon: Icons.notifications },
  { href: '/settings/connected', label: 'Connected Accounts', icon: Icons.connected },
  { href: '/settings/accessibility', label: 'Accessibility & Editor', icon: Icons.accessibility },
  { href: '/settings/privacy', label: 'Privacy', icon: Icons.privacy },
];

/** Which tree a path belongs to. Personal is the closed set; everything else is brand. */
export function treeFor(pathname: string): SettingsTree {
  return PERSONAL_SECTIONS.some((s) => s.href === pathname) ? 'personal' : 'brand';
}
