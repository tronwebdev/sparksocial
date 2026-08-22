'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * SETTINGS NAVIGATION — `SET-WS-*`'s missing information architecture.
 *
 * The prototypes model settings as two-level navigation with named sections.
 * The build had a single `/settings` route stacking ten panels with no
 * navigation at all, which had one consequence worth more than the tidiness:
 * **there was nowhere to send anybody.** "Go to Credit & Usage" named a scroll
 * position rather than a place, so a bug report, a support reply and a runbook
 * step could not point at a screen.
 *
 * Every section is a real sub-route, so each one has a URL that can be linked,
 * bookmarked, and cited in a defect report.
 *
 * ── Why two route trees and not one nav ───────────────────────────────────
 *
 * The prototypes put Credit & Usage and Team Roles in the same list as Brand
 * kits. The build deliberately separates them: `/settings` is what is true of
 * *this brand*, `/account` is what is true of the organisation, and the reason
 * is in `settings/layout.tsx`'s own history — an agency operator adding their
 * fourth client had to select the third one first to reach billing.
 *
 * So the nav shows both trees and labels which is which, rather than merging
 * them and reintroducing that. The prototype's flat list is the thing being
 * deviated from, deliberately; the addressable-sections half of its design is
 * what this adopts.
 *
 * ── Wording ───────────────────────────────────────────────────────────────
 *
 * "Brand", not "workspace" — the 22 August naming decision. The prototypes say
 * workspace throughout, so this is one of the places the prototypes are the
 * thing that needs updating.
 */

interface Section {
  href: string;
  label: string;
  /** One line, because a nav item that needs two is a section that needs splitting. */
  hint: string;
}

const BRAND: Section[] = [
  { href: '/settings', label: 'Overview', hint: 'What SPARK knows about this brand' },
  { href: '/settings/brand-kit', label: 'Brand kit', hint: 'Voice, guardrails, logo, colours, knowledge' },
  { href: '/settings/engagement', label: 'Engagement Intelligence', hint: 'Replies, autonomy, sales assist' },
  { href: '/settings/connections', label: 'Account Connection', hint: 'Platforms and publishing health' },
  { href: '/settings/team', label: 'Team Roles', hint: 'Groups, capabilities, approval policy' },
  { href: '/settings/learning', label: 'Learning', hint: 'What the mix has learned, and freezing it' },
];

const ORG: Section[] = [
  { href: '/account', label: 'Organisation', hint: 'Plan, credits, people, transfer, audit' },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings sections" className="flex flex-col gap-6">
      <Group title="Brand settings" sections={BRAND} pathname={pathname} />
      <Group title="Account settings" sections={ORG} pathname={pathname} />
    </nav>
  );
}

function Group({ title, sections, pathname }: { title: string; sections: Section[]; pathname: string }) {
  return (
    <div>
      <p className="px-3 text-[11px] font-medium uppercase tracking-[0.09em] text-ink-muted">{title}</p>
      <ul className="mt-2 flex flex-col gap-0.5">
        {sections.map((s) => {
          /**
           * Exact match for the index, prefix match for the rest. Without the
           * exact case `/settings` stays highlighted on every child route and
           * the nav stops telling you where you are — which is the one job it
           * has.
           */
          const active = s.href === '/settings' ? pathname === '/settings' : pathname.startsWith(s.href);
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block rounded-lg px-3 py-2 transition-colors',
                  active ? 'bg-surface-muted' : 'hover:bg-surface-muted/60',
                )}
              >
                <span className={cn('block text-[13.5px]', active ? 'font-medium text-ink' : 'text-ink')}>
                  {s.label}
                </span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-muted">{s.hint}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
