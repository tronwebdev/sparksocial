'use client';

import { useState } from 'react';
import { SparkMark } from '@/components/brand/SparkMark';
import { NeedsAttentionBanner } from './NeedsAttentionBanner';
import { PlanQueue } from './PlanQueue';
import { CalendarMonthGrid } from './CalendarMonthGrid';
import { cn } from '@/lib/utils';

/**
 * The Agent Calendar tab — `SparkSocial Command Center.dc.html`.
 *
 * This tab was mounting `CalendarBoard` alone, which was wrong in a way only
 * rendering the prototype showed. It has three parts the month grid is not:
 *
 *   agent banner  51,141  1625x177 r20, cyan-to-pink over `#EAF7FB`, holding a
 *                         400x149 frosted identity card, the traits and status
 *                         lines, the Needs Attention strip, and Pause / View
 *                         Agent Identity stacked at its right
 *   heading       53,352  28px/600 with the usual subtitle
 *   view toggle   1345,352 333x56 r14 white, two 46px halves at radius 10
 *   queue card    48,442  1629x900 — a *table*: Content, Type, Preview,
 *                         Channel, Status, Action
 *
 * It is also the one tab with no Spark rail, which is why the banner is 1625
 * wide where the Overview's hero is 1159: the identity that lives in the rail
 * on every other tab is inlined here instead. Same content, and the reason it
 * appears twice in the design is that it never appears twice on screen.
 *
 * ── List View and Calendar Mode ───────────────────────────────────────────
 *
 * The toggle is real. List View is the design's six-column table — `PlanQueue`
 * with `layout="table"`. Calendar Mode is `CalendarMonthGrid`, the two
 * 7-column grids at 28,96 and 28,136.
 *
 * It mounted `CalendarBoard` for Calendar Mode, and switching to it rendered no
 * grid at all — no weekday row, no cells. `CalendarBoard` is the `/calendar`
 * *screen*: campaign list, generate flow, its own board. Reshaping it into this
 * card would have rewritten a screen that is not in scope, so the card has its
 * own grid and `/calendar` is untouched.
 */

export function AgentCalendarTab({
  genomeId,
  paused,
  agentName,
  voice,
  riskTolerance,
  reviewCount,
  onTogglePause,
  onOpenDraft,
  busy,
}: {
  genomeId: string | undefined;
  paused: boolean;
  agentName: string | null;
  voice: string[];
  riskTolerance: string;
  reviewCount: number;
  onTogglePause: () => void;
  onOpenDraft: (contentItemId: string) => void;
  busy?: boolean;
}) {
  const [view, setView] = useState<'list' | 'calendar'>('list');

  return (
    <div className="flex flex-col gap-8">
      {/*
        ── agent banner ─────────────────────────────────────────────────

        1625x177 at radius 20, and everything in it is placed at the design's
        own offsets rather than stacked in a flex row.

        It was `flex flex-wrap gap-[38px]`, which put the frosted card, the
        traits and the two buttons wherever they happened to fit and let the
        banner size to its tallest child — measured 176 at 47,144 against
        51,141, with the three activity lines at 452,66 missing altogether.

        Inside a fixed 177 box:

          glass card   14,14    400x149 r15, white at 75% under a 12px blur
          traits       452,26   voice at 18/600, risk at 18/500
          activity     452,66   three 17px spinners at 16/400
          attention    452,107  830 wide
          buttons      1408,28 and 1408,90 — 190x48 r10

        The buttons are right-anchored (1625 - 1408 - 190 = 27) so they hold to
        the edge at any width; everything else is left-pinned, as drawn.
      */}
      <section
        className="relative h-[177px] overflow-hidden rounded-xl"
        style={{
          background:
            'linear-gradient(103deg, rgba(108,232,255,0.35) 0%, rgba(194,244,254,0.5) 38%, rgba(245,107,255,0.18) 100%), #EAF7FB',
        }}
      >
        {/* 400x149 frosted identity card, its own children on its own offsets */}
        <div
          className="absolute left-[14px] top-[14px] h-[149px] w-[400px] rounded-[15px]"
          style={{
            background: 'rgba(255,255,255,0.75)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.9)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <span className="absolute left-[26px] top-[24px] block h-[100px] w-[100px]">
            <SparkMark variant="shell" size={100} />
          </span>
          <p className="absolute left-[150px] right-[14px] top-[34px] truncate text-[30px] font-semibold leading-[1.27] text-ink">
            {agentName ?? 'Unnamed agent'}
          </p>
          <span className="absolute left-[152px] top-[92px] text-16 leading-none text-ink">Status</span>
          <span className="absolute left-[210px] top-[86px] inline-flex h-[31px] items-center gap-[7px] rounded-[90px] bg-white px-[13px]">
            <span
              className="block h-[11px] w-[11px] rounded-full"
              style={{ background: paused ? '#F35525' : '#13D711' }}
            />
            <span className="text-14 leading-none text-ink">{paused ? 'Paused' : 'Active'}</span>
          </span>
        </div>

        {/* traits — 452,26 with a 26px gap */}
        <div className="absolute left-[452px] right-[240px] top-[26px] flex items-center gap-x-[26px] overflow-hidden">
          <span className="flex shrink-0 items-center gap-[9px]">
            <svg width="16" height="20" viewBox="0 0 16 20" fill="none" aria-hidden>
              <circle cx="8" cy="4" r="4" fill="#2F8291" />
              <path d="M16 15.5C16 18 16 20 8 20S0 18 0 15.5 3.6 11 8 11s8 2 8 4.5Z" fill="#2F8291" />
            </svg>
            <span className="truncate text-18 font-semibold" style={{ color: '#2F8291' }}>
              {voice.length ? voice.join(', ') : 'No voice set'}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-[9px]">
            <svg width="16" height="20" viewBox="0 0 16 20" fill="none" aria-hidden>
              <path
                d="M7.7.04c.21-.06.44-.05.64.03l7 2.75.14.07c.3.18.5.5.5.86v5.5c0 4.9-3.09 9.1-7.67 10.69a1 1 0 0 1-.66 0C3.09 18.35 0 14.15 0 9.25v-5.5l.01-.15c.05-.35.29-.65.62-.78l7-2.75.07-.03Z"
                fill="#8937D6"
              />
            </svg>
            <span className="whitespace-nowrap text-18 font-medium" style={{ color: '#8937D6' }}>
              Risk Tolerance: <b className="font-semibold">{riskTolerance}</b>
            </span>
          </span>
        </div>

        {/*
          activity — 452,66, three 17px spinners at 16/400 in `#0C0C0C`.

          The design hardcodes "Running 2 Campaigns / Planning contents for next
          week / Analyzing engagement signals" and spins all three. This tab is
          handed `paused` and `reviewCount` and nothing about campaigns, so the
          lines are derived from what it actually knows — and the spinner only
          turns on a line describing something in progress, the same rule the
          dashboard banner and the Spark rail follow. A row of animated claims
          that keep spinning while the agent is paused is the one thing a status
          strip must not do.
        */}
        <div className="absolute left-[452px] right-[240px] top-[66px] flex items-center gap-x-[24px] overflow-hidden">
          {(paused
            ? [{ label: 'Paused — it will not act until you resume', spin: false }]
            : [
                { label: 'Analyzing engagement signals', spin: true },
                ...(reviewCount > 0
                  ? [
                      {
                        label: `${reviewCount} waiting on your approval`,
                        spin: false,
                      },
                    ]
                  : []),
              ]
          ).map((st) => (
            <span key={st.label} className="flex shrink-0 items-center gap-[9px]">
              <span
                aria-hidden
                className={cn(
                  'inline-flex h-[17px] w-[17px] shrink-0 items-center justify-center',
                  st.spin && 'animate-spin-slow motion-reduce:animate-none',
                )}
              >
                <svg width="17" height="17" viewBox="0 0 19 19" fill="none">
                  <path
                    d="M16.6 9.5a7.1 7.1 0 1 1-2.05-5M16.9 1.6v3.3h-3.3"
                    stroke="#0C0C0C"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="whitespace-nowrap text-16 font-normal text-ink">{st.label}</span>
            </span>
          ))}
        </div>

        {/* attention — 452,107, 830 wide */}
        {reviewCount > 0 ? (
          <div className="absolute left-[452px] top-[107px] w-[830px] max-w-[calc(100%-692px)]">
            <NeedsAttentionBanner count={reviewCount} />
          </div>
        ) : null}

        {/* Two 190x48 buttons at 1408,28 and 1408,90 — 27 from the right edge. */}
        <button
          type="button"
          onClick={onTogglePause}
          disabled={busy}
          className="absolute right-[27px] top-[28px] flex h-12 w-[190px] items-center justify-center gap-[9px] rounded-[10px] bg-white text-16 font-medium text-ink disabled:opacity-50"
          style={{ boxShadow: '0 8px 22px -12px rgba(12,12,12,0.3)' }}
        >
          <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
            <circle cx="8.5" cy="8.5" r="7.5" stroke="#0C0C0C" strokeWidth="1.3" />
            {paused ? (
              <path d="M6.8 5.6v5.8L11.4 8.5 6.8 5.6Z" fill="#0C0C0C" />
            ) : (
              <path d="M6.6 5.8v5.4M10.4 5.8v5.4" stroke="#0C0C0C" strokeWidth="1.5" strokeLinecap="round" />
            )}
          </svg>
          {paused ? 'Resume Agent' : 'Pause Agent'}
        </button>
        <a
          href="/settings/brand-kit"
          className="absolute right-[27px] top-[90px] flex h-12 w-[190px] items-center justify-center rounded-[10px] bg-white text-16 font-medium text-ink"
          style={{ boxShadow: '0 8px 22px -12px rgba(12,12,12,0.3)' }}
        >
          View Agent Identity
        </a>
      </section>

      {/* ── heading and the view toggle ──────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold leading-[1.27] text-ink">Agent Command Center</h1>
          <p className="mt-[9px] text-16 text-ink-muted">
            Your Ai Agent is running your social presence for this brand
          </p>
        </div>

        {/* 333x56 at radius 14, two halves at radius 10 — the active one tinted. */}
        <div
          className="flex h-14 shrink-0 items-center gap-1 rounded-[14px] bg-white p-[5px]"
          style={{ boxShadow: '0 10px 28px -18px rgba(12,12,12,0.28)' }}
          role="group"
          aria-label="Calendar view"
        >
          {(
            [
              ['list', 'List View'],
              ['calendar', 'Calendar Mode'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              onClick={() => setView(id)}
              className={cn(
                /*
                  `#9CEFFF` active and `#FFFFFF` inactive — the design's own
                  pair, on its own `background 0.2s ease`. This was a 35%
                  cyan tint with the inactive half left transparent, so the
                  active edge read soft against a white track that was only
                  white by inheritance, and `transition-colors` ran it at 0.15s
                  over six properties instead of 0.2s over one.
                */
                'flex h-[46px] items-center justify-center gap-[9px] rounded-[10px] px-5 text-16 text-ink',
                'transition-[background] duration-200 ease-in-out motion-reduce:transition-none',
                view === id ? 'font-semibold' : 'font-medium',
              )}
              style={{ background: view === id ? '#9CEFFF' : '#FFFFFF' }}
            >
              {id === 'list' ? (
                <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden>
                  <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden>
                  <rect x="2" y="3.2" width="14" height="12.6" rx="2.2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M2 7h14M6 1.8v2.6M12 1.8v2.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === 'list' ? (
        <PlanQueue
          genomeId={genomeId}
          onOpen={onOpenDraft}
          layout="table"
          title="Upcoming action queue"
        />
      ) : (
        <CalendarMonthGrid genomeId={genomeId} onOpenDraft={onOpenDraft} />
      )}
    </div>
  );
}
