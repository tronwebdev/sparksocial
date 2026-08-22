import type { ReactNode } from 'react';
import { TopBar } from '@/components/shell/TopBar';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import { UserMenu } from '@/components/shell/UserMenu';
import { SettingsNav } from '@/components/settings/SettingsNav';

/**
 * `SET-WS-01` — the brand layer of §8.12's two, now with an actual information
 * architecture.
 *
 * ── What this replaced, and why it mattered ───────────────────────────────
 *
 * One route stacking ten panels, no navigation. The tidiness was the smaller
 * problem: with no sections there was **nowhere to send anybody**. A runbook
 * step, a support reply and a bug report could not name a screen, only a scroll
 * position. Every section below is a sub-route with a URL.
 *
 * ── The split, and why the org half is elsewhere ──────────────────────────
 *
 * Billing, the plan, SSO and the multi-brand roster live at `/account`. They are
 * not settings *of a brand*, and keeping them here meant an agency operator
 * adding client #4 had to pick client #3 first to find the button. Moved rather
 * than duplicated, because a setting reachable from two screens is one two
 * people disagree about the location of, and eventually one copy stops being
 * updated.
 *
 * The prototypes put both trees in one flat list. That half is deliberately not
 * adopted; the nav names both and says which is which.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TopBar title={<WorkspaceSwitcher />} actions={<UserMenu />} />
      {/* Single column below `lg`: a 200px rail beside a form is unusable on a
          phone, and settings is a screen people genuinely open on one. */}
      <div className="grid grid-cols-1 gap-8 p-8 lg:grid-cols-[232px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <SettingsNav />
        </aside>
        <div className="min-w-0 grid grid-cols-1 gap-6">{children}</div>
      </div>
    </>
  );
}
