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
  rail,
  band,
  children,
}: {
  tab: CcTab;
  onTab: (t: CcTab) => void;
  engagementCount?: number;
  /**
   * The Spark rail. `railVisible` is false only on Agent Calendar in the
   * design, so the shell drops it there rather than each tab remembering to.
   */
  rail?: React.ReactNode;
  /**
   * The full-card band above the two columns: the page title, its subtitle, and
   * the "Needs Attention" strip.
   *
   * It is a shell slot rather than part of each tab's body because the design
   * puts the strip at 831..1680 — **past** the content column's right edge at
   * 1206 and across the rail's own x range. Rendered inside the tab (where it
   * was) it had 1159px to live in, so a 521px title beside an 849px strip
   * wrapped, the header row grew from 63 to 123.5, and the hero and the whole
   * rail were pushed 50px below the design's 241.
   */
  band?: React.ReactNode;
  children: React.ReactNode;
}) {
  const labelRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const measure = () => {
      const el = labelRefs.current[tab];
      if (!el?.offsetParent) return;
      /*
        `left - 16` by `width + 32` is the prototype's rule, but its `left` is
        the *item* (icon + label), not the button box. Each button here carries
        `px-[20px]`, so the item starts 20px inside its own box — and once the
        nav's own `px-5` came off (it was doubling the pill's end inset and
        making it 896 against the design's 867) the first tab's box began at 0
        and the thumb landed on -16, hanging outside the pill.

        Stated against the item: left = offsetLeft + 20 - 16, and the width is
        the item's, not the box's, so offsetWidth - 40 + 32.
      */
      setThumb({ left: el.offsetLeft + 4, width: el.offsetWidth - 8 });
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
        {/*
          The blurred arrow, which was missing — and it is most of why the
          background did not match.

          `Command Center.dc.html` puts a 427.556x393 cyan arrow at 766,345
          inside the card at 40% opacity under a 60px blur. The card also carries
          `transform: scaleX(-1)`, and we bake that flip into the gradient angles
          rather than mirroring the DOM (mirroring the node would flip its
          children too). The blob therefore has to be mirrored by hand: 766 from
          the *right* edge, and the shape itself flipped, which is what puts it
          back where the design draws it.
        */}
        <svg
          aria-hidden
          viewBox="0 0 427.556 393"
          className="pointer-events-none absolute right-[766px] top-[345px] hidden h-[393px] w-[427.556px] -scale-x-100 lg:block"
          style={{ opacity: 0.4, filter: 'blur(60px)' }}
        >
          <defs>
            <linearGradient id="cc-arrow-wash" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0.048" stopColor="#6CE8FF" />
              <stop offset="1" stopColor="rgba(108,232,255,0.3)" />
            </linearGradient>
          </defs>
          <path
            d="M 74.014 150.687 L 331.452 18.213 C 352.478 7.393 378.106 11.588 394.586 28.547 L 400.61 34.747 C 416.708 51.313 420.419 76.312 409.83 96.84 L 287.036 334.874 C 271.51 364.97 232.356 373.38 205.841 352.314 L 65.173 240.554 C 34.614 216.275 39.31 168.546 74.014 150.687 Z"
            fill="url(#cc-arrow-wash)"
          />
        </svg>

        {/* ── chrome ───────────────────────────────────────────────────── */}
        {/*
          Four tops, not one line.

          This was `items-center ... px-[32px] pt-[16px]`, which averaged the
          design's four different header tops into a single centred row and put
          everything ~9px low, then pushed the whole chrome 15px right — 32 is
          measured from the *stage*, and this header lives inside a card that
          already starts at 15. Measured against the prototype: wordmark 47,43.5
          where the design has 32,34; Back 203.9,40.8 against 195,30; the nav
          pill 784.6 wide-of-613.

          The design draws the wordmark and Ask Spark on one line (y=34), Back
          4px above it (30) and the nav pill 7px below (41). So the row is
          `items-start` and each child carries its own top, and the header's
          height is stated (99) because the divider under it is at y=117 and the
          page title is measured 26px from that, not from Ask Spark's shadow.
        */}
        <header className="flex flex-wrap items-start gap-4 px-[17px] pt-4 sm:h-cc-chrome-h sm:gap-[22.1px] sm:px-cc-chrome-x sm:pb-0 sm:pr-cc-chrome-r sm:pt-0">
          <span className="font-display text-[27.49px] leading-[1.13] text-ink sm:mt-cc-top-mark">
            Sparksocial
          </span>

          {/* 92x36.4 at radius 7.07 with a hairline ring, back to the dashboard
              — which is where the prototype's own Back goes. */}
          <Link
            href="/home"
            className="flex h-[36.4px] w-[92px] items-center justify-center gap-3 rounded-[7.07px] text-[16.9px] font-medium text-ink-muted transition-colors hover:bg-white hover:text-ink sm:mt-cc-top-back"
            style={{ boxShadow: '0 0 0 0.71px #838383' }}
          >
            <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden>
              <path d="M6 1 1 6l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </Link>

          {/*
            11px between the pill and Ask Spark, and the group stops 37px short
            of the card's right edge — which is what puts the pill's left edge on
            the design's 613 without positioning it there.
          */}
          <div className="ml-auto flex min-w-0 items-start gap-4 sm:gap-cc-chrome-gap">
            <nav
              role="tablist"
              aria-label="Command Center"
              /*
                No `px-5`. Each tab already carries `px-[20px]`, so the nav's own
                padding was doubling the end inset: 40 either side instead of the
                design's 20 and 26.6, which made the pill 896 against its 867.
              */
              className="relative hidden h-[50px] items-center rounded-[92.4px] bg-white pr-[6.6px] lg:flex sm:mt-cc-top-pill"
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

            {/* The design's own 185x66.3 block at 1491,34, delegating to the
                drawer this screen already owns — see `AskSpark`. */}
            <span className="sm:mt-cc-top-mark">
              {/*
                No `delegate`.

                It delegated to `CommandCenterOverview`, which listened on
                `openAskSpark` and mounted its own `ChatDrawer` — so the drawer
                existed on one of four tabs and this button did nothing on the
                other three. That drawer is gone and `AskSpark` owns the only
                one, so the button opens it directly here as it does everywhere
                else.
              */}
              <AskSpark compact />
            </span>
          </div>
        </header>

        {/*
          The 1623px divider at y=117 that closes the chrome. It was missing
          entirely, which is also why the page title measured 33px high of the
          design: with nothing to sit under, the content block was spacing itself
          off the header's own height instead.
        */}
        {/* 38 left, 37 right: the card is 1698, so the rule measures the
            design's 1623 without being given a width. */}
        <div aria-hidden className="ml-[38px] mr-[37px] hidden h-px bg-border sm:block" />

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

        {/*
          1159 and 453 with a 21px gutter — the design's 47..1206 for the
          content and 1227..1680 for the rail. The rail is why the hero and the
          Queue card are not full-bleed, and it goes on the Calendar tab, which
          needs the width for a month grid.
        */}
        {/* 38px in, so the title lands on the design's 53, and 26 under the
            divider at 117. */}
        {band ? <div className="px-[17px] pt-cc-content-top sm:px-cc-band-x">{band}</div> : null}

        <div
          className={cn(
            'gap-[21px] px-[17px] pb-10 sm:px-cc-content-x',
            band ? 'pt-cc-band-gap' : 'pt-cc-content-top',
            rail && tab !== 'calendar'
              ? 'grid grid-cols-1 xl:grid-cols-[minmax(0,1159fr)_minmax(0,453fr)]'
              : 'block',
          )}
        >
          <div className="min-w-0">{children}</div>
          {rail && tab !== 'calendar' ? <div className="min-w-0">{rail}</div> : null}
        </div>
      </div>
    </div>
  );
}
