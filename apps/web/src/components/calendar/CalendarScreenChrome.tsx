'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * The Calendar screen's frame — `SparkSocial Calendar.dc.html`.
 *
 * Full-bleed, with its own chrome, exactly like the Command Center's: the same
 * 1698-wide card at 15,18 at radius 30 over the same two-gradient wash, the same
 * wordmark at 32,34 and the same 92x36.4 Back button at 195,30. `AppShell`'s
 * `chrome="bare"` exists for precisely this — the screen was rendering inside
 * the 322px sidebar frame with a `TopBar` and a 20px heading, which is a
 * different screen from the one the prototype draws.
 *
 * Its own header, right of Back:
 *
 *   summary     772,40    18px/500 — the range and how many posts are in it
 *   orb         1163,26   64px, a radial blue with two 9px eyes
 *   stat pill   1239,36   h44, radius 22, white on a 26px-blur shadow
 *   hairline    53,117    1623x1
 *   title       64,150    30px/600 "Calendar"
 *   subtitle    64,196    16px/400 `#838383`
 *   timezone    917,172   18px/500, its value in 600 `#5B5B5B`
 *   segmented   1082,156  272x56 — Month / Week / Day, 86px each on an 87 pitch
 *   view toggle 1372,156  304x56 — Calendar Mode 168 wide, List View 122
 *
 * Both controls swap `#9CEFFF` for `#FFFFFF` on `background 0.2s ease`, which
 * is the design's own transition. The segmented control is Calendar-Mode-only:
 * the prototype hides it in List View, because a list has no month to scope.
 */

export type CalendarLayout = 'calendar' | 'list';
export type CalendarSpan = 'month' | 'week' | 'day';

export function CalendarScreenChrome({
  layout,
  onLayout,
  span,
  onSpan,
  summary,
  headline,
  children,
}: {
  layout: CalendarLayout;
  onLayout: (l: CalendarLayout) => void;
  span: CalendarSpan;
  onSpan: (s: CalendarSpan) => void;
  /** "7 Post from 1st April 2026 to 30th April 2026" — the real range. */
  summary?: string;
  /** The stat pill's sentence, when there is a comparison to make. */
  headline?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white p-[15px] pt-[18px]">
      {/*
        The same wash as the Command Center's card, with `scaleX(-1)` baked into
        the angles rather than applied as a transform — mirroring the node would
        flip its children too. Horizontal mirror negates the angle; it does not
        subtract it from 180.
      */}
      <div
        className="relative min-h-[calc(100vh-36px)] overflow-hidden rounded-[30px]"
        style={{
          background:
            'linear-gradient(-151.005deg, rgba(245,107,255,0.2) 3.02%, rgba(255,255,255,0) 63.11%), linear-gradient(-210.896deg, rgba(108,232,255,0.3) 3.17%, rgba(255,255,255,0) 67.52%), #F7F7F7',
        }}
      >
        {/* ── chrome ───────────────────────────────────────────────────── */}
        {/*
          99 tall, so the hairline lands on the design's 117 (the card starts at
          18). The design's header height comes from its 64px orb at 26..90; with
          the orb and the stat pill hidden — see the page on why the 89% claim is
          not rendered — the row would otherwise collapse to the wordmark and
          pull the divider and the title up 30px with it.

          `px-[17px]` because the design's wordmark is at 32 on the stage and the
          card's left edge is 15. Every inset here is an x minus 15.
        */}
        <header className="flex h-[99px] flex-wrap items-start gap-4 px-[17px] pt-[16px] sm:px-[17px]">
          <span className="font-display text-[27.49px] leading-[1.13] text-ink">Sparksocial</span>

          <Link
            href="/home"
            className="-mt-[4px] flex h-[36.4px] w-[92px] items-center justify-center gap-3 rounded-[7.07px] text-[16.9px] font-medium text-ink-muted transition-colors hover:bg-white hover:text-ink"
            style={{ boxShadow: '0 0 0 0.71px #838383' }}
          >
            <svg width="8" height="16" viewBox="0 0 8 16" fill="none" aria-hidden>
              <path d="M7 1 1 8l6 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </Link>

          {summary ? (
            <span className="hidden text-18 font-medium text-ink lg:block lg:pl-[60px]">{summary}</span>
          ) : null}

          {/* The orb and the stat pill are one thought: a face, then what it is
              telling you. Both hidden under `xl`, where the row cannot hold them
              beside the summary. */}
          <div className="ml-auto hidden items-center gap-[12px] xl:flex">
            {headline ? (
              <>
                <span
                  aria-hidden
                  className="relative block h-[64px] w-[64px] shrink-0 rounded-full"
                  style={{
                    background: 'radial-gradient(circle at 50% 42%, #D6F1FF 0%, #A6D8FF 60%, #8FC8FF 100%)',
                    boxShadow: '0 8px 22px -10px rgba(36,116,237,0.5)',
                  }}
                >
                  <span className="absolute left-[18px] top-[27px] block h-[9px] w-[9px] rounded-full bg-white" />
                  <span className="absolute left-[37px] top-[27px] block h-[9px] w-[9px] rounded-full bg-white" />
                </span>
                <span
                  className="flex h-[44px] items-center rounded-[22px] bg-white px-5 text-16 font-semibold text-ink"
                  style={{ boxShadow: '0 10px 26px -14px rgba(12,12,12,0.3)' }}
                >
                  {headline}
                </span>
              </>
            ) : null}
          </div>
        </header>

        {/* 53,117 on the stage — 38 inside the card, and flush under the header. */}
        <div className="h-px" style={{ background: 'rgba(131,131,131,0.25)', marginLeft: 38, marginRight: 37 }} />

        {/* ── title row ────────────────────────────────────────────────── */}
        {/* Title on 150: 33 under the divider. 64 on the stage is 49 in. */}
        <div className="flex flex-wrap items-start gap-4 px-[17px] pt-[33px] sm:pl-[49px] sm:pr-[37px]">
          <div className="min-w-0">
            <h1 className="text-[30px] font-semibold leading-[1.27] text-ink">Calendar</h1>
            <p className="mt-[8px] text-16 text-ink-muted">
              A sleek and intuitive calendar interface for easy scheduling and management.
            </p>
          </div>

          {/* 156 against the title's 150. */}
          <div className="ml-auto mt-[6px] flex flex-wrap items-center gap-[18px]">
            {/* Timezone, shown in Calendar Mode only — the design hides it with
                the segmented control, both being month-scoping. */}
            {layout === 'calendar' ? (
              <>
                <span className="hidden text-18 font-medium text-ink-muted 2xl:block">
                  Timezone:{' '}
                  <b className="font-semibold" style={{ color: '#5B5B5B' }}>
                    {/* The viewer's own zone, not a hardcoded UTC: a slot is a
                        wall-clock promise and this is the clock it is read on. */}
                    {Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'}
                  </b>
                </span>

                <div
                  className="flex h-[56px] w-[272px] shrink-0 items-center rounded-[14px] bg-white px-[6px]"
                  style={{ boxShadow: '0 10px 28px -18px rgba(12,12,12,0.28)' }}
                >
                  {(['month', 'week', 'day'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={span === s}
                      onClick={() => onSpan(s)}
                      className={cn(
                        'flex h-[44px] w-[86px] items-center justify-center rounded-[10px] text-16 capitalize text-ink',
                        'transition-[background] duration-200 ease-in-out motion-reduce:transition-none',
                        span === s ? 'font-semibold' : 'font-medium',
                      )}
                      style={{ background: span === s ? '#9CEFFF' : 'transparent' }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            <div
              className="flex h-[56px] w-[304px] shrink-0 items-center gap-[4px] rounded-[14px] bg-white px-[5px]"
              style={{ boxShadow: '0 10px 28px -18px rgba(12,12,12,0.28)' }}
            >
              <button
                type="button"
                aria-pressed={layout === 'calendar'}
                onClick={() => onLayout('calendar')}
                className="flex h-[46px] w-[168px] items-center justify-center gap-[9px] rounded-[10px] text-16 font-semibold text-ink transition-[background] duration-200 ease-in-out motion-reduce:transition-none"
                style={{ background: layout === 'calendar' ? '#9CEFFF' : '#FFFFFF' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 25" fill="none" aria-hidden>
                  <rect x="2.7" y="4.1" width="18.6" height="18.4" rx="4" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M2.9 9.9h18.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <path d="M8.1 1.9v3.8M18.5 1.9v3.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                Calendar Mode
              </button>
              <button
                type="button"
                aria-pressed={layout === 'list'}
                onClick={() => onLayout('list')}
                className="flex h-[46px] w-[122px] items-center justify-center gap-[9px] rounded-[10px] text-16 font-semibold text-ink transition-[background] duration-200 ease-in-out motion-reduce:transition-none"
                style={{ background: layout === 'list' ? '#9CEFFF' : '#FFFFFF' }}
              >
                <svg width="19" height="16" viewBox="0 0 19 16" fill="none" aria-hidden>
                  <path d="M6 2h12M6 8h12M6 14h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <circle cx="1.6" cy="2" r="1.5" fill="currentColor" />
                  <circle cx="1.6" cy="8" r="1.5" fill="currentColor" />
                  <circle cx="1.6" cy="14" r="1.5" fill="currentColor" />
                </svg>
                List View
              </button>
            </div>
          </div>
        </div>

        {/* The card sits at 48,250 — 38 under the subtitle's baseline. */}
        {/* The card is at 48,250 — 33 in, 38 under the subtitle. */}
        <div className="px-[17px] pb-10 pt-[38px] sm:px-[33px]">{children}</div>
      </div>
    </div>
  );
}
