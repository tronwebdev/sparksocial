'use client';

import { useState } from 'react';
import { SparkMark } from '@/components/brand/SparkMark';
import { NeedsAttentionBanner } from './NeedsAttentionBanner';
import { PlanQueue } from './PlanQueue';
import { CalendarBoard } from '@/components/calendar/CalendarBoard';
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
 * The toggle is real. List View is `PlanQueue` — already the design's queue,
 * already reading `content.list` — and Calendar Mode is `CalendarBoard`, the
 * month grid. The design's List View is a six-column table rather than
 * `PlanQueue`'s rows; that is a presentation difference over the same data, and
 * a second table over one dataset is how two views start disagreeing. Noted
 * rather than duplicated.
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
      {/* ── agent banner ─────────────────────────────────────────────── */}
      <section
        className="overflow-hidden rounded-xl p-[14px]"
        style={{
          background:
            'linear-gradient(103deg, rgba(108,232,255,0.35) 0%, rgba(194,244,254,0.5) 38%, rgba(245,107,255,0.18) 100%), #EAF7FB',
        }}
      >
        <div className="flex flex-wrap items-start gap-[38px]">
          {/* 400x149 frosted identity card */}
          <div
            className="flex w-[400px] shrink-0 items-center gap-6 rounded-[15px] p-[24px]"
            style={{
              background: 'rgba(255,255,255,0.75)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.9)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <span className="block h-[100px] w-[100px] shrink-0">
              <SparkMark variant="shell" size={100} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[30px] font-semibold leading-[1.27] text-ink">
                {agentName ?? 'Unnamed agent'}
              </p>
              <div className="mt-[18px] flex items-center gap-2">
                <span className="text-16 text-ink">Status</span>
                <span className="inline-flex h-[31px] items-center gap-[7px] rounded-full bg-white px-[13px]">
                  <span
                    className="block h-[11px] w-[11px] rounded-full"
                    style={{ background: paused ? '#F35525' : '#13D711' }}
                  />
                  <span className="text-14 text-ink">{paused ? 'Paused' : 'Active'}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-[14px]">
            <div className="flex flex-wrap items-center gap-x-[26px] gap-y-2">
              <span className="flex items-center gap-[9px]">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                  <path d="M9 1.5 11 6.4l5.3.4-4 3.5 1.2 5.2L9 12.8 4.5 15.5l1.2-5.2-4-3.5 5.3-.4L9 1.5Z" stroke="#2F8291" strokeWidth="1.4" strokeLinejoin="round" />
                </svg>
                <span className="text-18 font-semibold" style={{ color: '#2F8291' }}>
                  {voice.length ? voice.join(', ') : 'No voice set'}
                </span>
              </span>
              <span className="flex items-center gap-[9px]">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                  <path d="M9 1.8 16 5v5.4c0 3.2-2.9 5.4-7 6.8-4.1-1.4-7-3.6-7-6.8V5l7-3.2Z" stroke="#8937D6" strokeWidth="1.4" strokeLinejoin="round" />
                </svg>
                <span className="text-18 font-medium" style={{ color: '#8937D6' }}>
                  Risk Tolerance: <b className="font-semibold">{riskTolerance}</b>
                </span>
              </span>
            </div>

            {reviewCount > 0 ? <NeedsAttentionBanner count={reviewCount} /> : null}
          </div>

          {/* Two 190x48 buttons, stacked at the banner's right. */}
          <div className="flex shrink-0 flex-col gap-[14px]">
            <button
              type="button"
              onClick={onTogglePause}
              disabled={busy}
              className="flex h-12 w-[190px] items-center justify-center gap-[9px] rounded-md bg-white text-16 font-medium text-ink disabled:opacity-50"
              style={{ boxShadow: '0 8px 22px -12px rgba(12,12,12,0.3)' }}
            >
              {paused ? (
                <svg width="11" height="13" viewBox="0 0 12 14" fill="none" aria-hidden>
                  <path d="M1 1.2v11.6L11 7 1 1.2Z" fill="currentColor" />
                </svg>
              ) : (
                <svg width="11" height="13" viewBox="0 0 12 14" fill="none" aria-hidden>
                  <path d="M1.5 1h3v12h-3zM7.5 1h3v12h-3z" fill="currentColor" />
                </svg>
              )}
              {paused ? 'Resume Agent' : 'Pause Agent'}
            </button>
            <a
              href="/settings/brand-kit"
              className="flex h-12 w-[190px] items-center justify-center rounded-md bg-white text-16 font-medium text-ink"
              style={{ boxShadow: '0 8px 22px -12px rgba(12,12,12,0.3)' }}
            >
              View Agent Identity
            </a>
          </div>
        </div>
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
                'flex h-[46px] items-center justify-center gap-[9px] rounded-[10px] px-5 text-16 text-ink transition-colors',
                view === id ? 'font-semibold' : 'font-medium',
              )}
              style={view === id ? { background: 'rgba(108,232,255,0.35)' } : undefined}
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

      {view === 'list' ? <PlanQueue genomeId={genomeId} onOpen={onOpenDraft} /> : <CalendarBoard />}
    </div>
  );
}
