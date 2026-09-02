'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AskSpark } from '@/components/shell/AskSpark';
import { cn } from '@/lib/utils';

/**
 * The Command Center's frame — `SparkSocial Command Center.dc.html`.
 *
 * Full-bleed, with its own navigation:
 *
 *   background card   15,18  1698 wide, radius 30, warm-over-cyan on `#F7F7F7`
 *   wordmark          32,34  27.49px
 *   Back              195,30 92x36.4, radius 7.07, a 0.71px `#838383` ring
 *   nav pill          613,41 867x50, radius 92.4, white, 24px-blur shadow
 *   active thumb      the tab's box inset by 16 either side, h42 radius 76.4,
 *                     on `#0C0C0C` with the label flipping to white
 *   Ask Spark         1491,34
 *
 * ── The four tabs are one screen, not four routes ─────────────────────────
 *
 * The prototype switches them with local state, and that is right here too:
 * they share the Spark rail (`railVisible` is false only on Agent Calendar) and
 * the draft panel, and a route change would tear both down and rebuild them.
 * So `tab` is state and the URL carries it as `?tab=` — which keeps the screen
 * linkable without making each tab a page.
 *
 * ── The thumb is measured, not tabulated ──────────────────────────────────
 *
 * The prototype hardcodes each tab's `left` and `width` (20/108, 168.3/153.5,
 * 361.8/218.6, 620.4/220) and derives the thumb as `left - 16` by
 * `width + 32`. Those numbers are what its own labels happen to measure at
 * 16.63px; ours differ by a pixel or two, and "Engagement Intelligence" carries
 * a count badge that the design's does not. So the thumb reads the active
 * label's own box and applies the same 16px inset — the rule rather than its
 * output.
 */

export type CcTab = 'overview' | 'calendar' | 'performance' | 'engagement';

const TABS: ReadonlyArray<{ id: CcTab; label: string; icon: React.ReactNode }> = [
  {
    id: 'overview',
    label: 'Overview',
    icon: (
      <svg width="21" height="21" viewBox="0 0 22 22" fill="none" aria-hidden>
        <rect x="2.5" y="2.5" width="7.5" height="7.5" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <rect x="12" y="2.5" width="7.5" height="7.5" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <rect x="2.5" y="12" width="7.5" height="7.5" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <rect x="12" y="12" width="7.5" height="7.5" rx="2" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ),
  },
  {
    id: 'calendar',
    label: 'Agent Calendar',
    icon: (
      <svg width="21" height="21" viewBox="0 0 22 22" fill="none" aria-hidden>
        <rect x="2.5" y="4" width="17" height="15.5" rx="2.6" stroke="currentColor" strokeWidth="1.6" />
        <path d="M2.5 8.6h17M7 2.5V5.5M15 2.5V5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'performance',
    label: 'Performance & Learning',
    icon: (
      <svg width="21" height="21" viewBox="0 0 22 22" fill="none" aria-hidden>
        <path d="M3 18.5V9M8.3 18.5V3.5M13.7 18.5v-6M19 18.5V7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'engagement',
    label: 'Engagement Intelligence',
    icon: (
      <svg width="21" height="21" viewBox="0 0 22 22" fill="none" aria-hidden>
        <path
          d="M19 10.4a7.6 7.6 0 0 1-8.2 7.6L5 19.5l1.6-4.2A7.6 7.6 0 1 1 19 10.4Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

export function CommandCenterShell({
  tab,
  onTab,
  /** Shown on the Engagement Intelligence tab's label, as the design does not. */
  engagementCount = 0,
  children,
}: {
  tab: CcTab;
  onTab: (t: CcTab) => void;
  engagementCount?: number;
  children: React.ReactNode;
}) {
  const labelRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const measure = () => {
      const el = labelRefs.current[tab];
      if (!el?.offsetParent) return;
      // `left - 16` by `width + 32`, the prototype's own rule.
      setThumb({ left: el.offsetLeft - 16, width: el.offsetWidth + 32 });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [tab, engagementCount]);

  return (
    <div className="min-h-screen bg-white p-[15px] pt-[18px]">
      {/*
        The card's two gradients with `scaleX(-1)` baked into the angles — the
        mirror is horizontal, so each angle is negated rather than subtracted
        from 180. Getting that backwards is what had the dashboard's wash
        running bottom-to-top.
      */}
      <div
        className="relative min-h-[calc(100vh-36px)] overflow-hidden rounded-[30px]"
        style={{
          background:
            'linear-gradient(-151.005deg, rgba(245,107,255,0.2) 3.02%, rgba(255,255,255,0) 63.11%), linear-gradient(-210.896deg, rgba(108,232,255,0.3) 3.17%, rgba(255,255,255,0) 67.52%), #F7F7F7',
        }}
      >
        {/* ── chrome ───────────────────────────────────────────────────── */}
        <header className="flex flex-wrap items-center gap-4 px-[17px] pt-4 sm:px-[32px] sm:pt-[16px]">
          <span className="font-display text-[27.49px] leading-[1.13] text-ink">Sparksocial</span>

          {/* 92x36.4 at radius 7.07 with a hairline ring, back to the dashboard
              — which is where the prototype's own Back goes. */}
          <Link
            href="/home"
            className="flex h-[36.4px] w-[92px] items-center justify-center gap-3 rounded-[7.07px] text-[16.9px] font-medium text-ink-muted transition-colors hover:text-ink"
            style={{ boxShadow: '0 0 0 0.71px #838383' }}
          >
            <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden>
              <path d="M6 1 1 6l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </Link>

          <div className="ml-auto flex min-w-0 items-center gap-4">
            <nav
              role="tablist"
              aria-label="Command Center"
              className="relative hidden h-[50px] items-center rounded-[92.4px] bg-white px-5 lg:flex"
              style={{ boxShadow: '0 24px 40px -24px rgba(0,0,0,0.12)' }}
            >
              {thumb ? (
                <span
                  aria-hidden
                  className="absolute top-1 h-[42px] rounded-[76.4px] transition-[left,width] duration-200 ease-shell motion-reduce:transition-none"
                  style={{ left: thumb.left, width: thumb.width, background: '#0C0C0C' }}
                />
              ) : null}

              {TABS.map((t) => (
                <button
                  key={t.id}
                  ref={(el) => {
                    labelRefs.current[t.id] = el;
                  }}
                  role="tab"
                  type="button"
                  aria-selected={tab === t.id}
                  onClick={() => onTab(t.id)}
                  className={cn(
                    'relative z-10 flex h-[23px] items-center gap-2 whitespace-nowrap bg-transparent px-[20px] text-[16.63px] font-medium leading-none transition-colors',
                    tab === t.id ? 'text-white' : 'text-ink-muted hover:text-ink',
                  )}
                >
                  <span className="inline-flex h-[21px] w-[21px] shrink-0 items-center justify-center">
                    {t.icon}
                  </span>
                  {t.label}
                  {t.id === 'engagement' && engagementCount > 0 ? (
                    <span
                      className={cn(
                        'ml-0.5 rounded-full px-1.5 text-[12px] font-semibold tabular-nums',
                        tab === t.id ? 'bg-white/20 text-white' : 'bg-warn/15 text-warn',
                      )}
                    >
                      {engagementCount}
                    </span>
                  ) : null}
                </button>
              ))}
            </nav>

            <AskSpark />
          </div>
        </header>

        {/* Under `lg` the pill does not fit — 867px of tabs beside a wordmark, a
            Back button and Ask Spark — so it becomes a select. Same four
            destinations, same state. */}
        <div className="px-[17px] pt-4 lg:hidden">
          <label className="sr-only" htmlFor="cc-tab">
            Command Center section
          </label>
          <select
            id="cc-tab"
            value={tab}
            onChange={(e) => onTab(e.target.value as CcTab)}
            className="h-11 w-full rounded-full bg-white px-4 text-16 font-medium text-ink outline-none"
            style={{ boxShadow: '0 24px 40px -24px rgba(0,0,0,0.12)' }}
          >
            {TABS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="px-[17px] pb-10 pt-[26px] sm:px-[47px]">{children}</div>
      </div>
    </div>
  );
}
