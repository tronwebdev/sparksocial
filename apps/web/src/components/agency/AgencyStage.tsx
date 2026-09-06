'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { useUser } from '@clerk/nextjs';
import { NotificationBell } from '@/components/notifications/NotificationBell';

/**
 * The Agency Portal's stage — `ui build/SparkSocial Agency Portal.dc.html`.
 *
 * ── Why this screen has its own page rather than the shared card ──────────
 *
 * Calendar, Discovery, Command Center and Settings all sit on one 1698 card at
 * 15,18 over a common wash. This one does not: its ground is a flat `#E7F3F6`
 * and its content is a **1728 stage** centred and scaled by
 * `min(1, viewport / 1728)`, exactly as the prototype's own script does it. The
 * stage height is also per-view rather than per-viewport, because the design
 * sizes the page to its content:
 *
 *   home           1330, or 1430 with a workspace row expanded, +75 pre-launch
 *   client finder   760 not connected · 1180 connected
 *   job finder     1200
 *   wizard open    max(view, 30 + wizard height + 40)
 *
 * Scaling rather than reflowing is the same decision the campaign wizard made,
 * and for the same reason: every element here is placed absolutely against
 * neighbours it overlaps, so there is no flow layout underneath to recover.
 *
 * ── Chrome ────────────────────────────────────────────────────────────────
 *
 *   wordmark   46,48 · 26/800
 *   scope pill 1000,40 · 378x56 r28 white, shadow
 *              `0 10px 26px -16px rgba(12,12,12,0.3)`; the active half 44 tall
 *              r22 on `#0C0C0C` at 15.5/600
 *   bell       1398,40 · 56x56 r50%
 *   profile    1472,40 · 210x56 r28 — a 40px avatar, a `#13D711` presence dot
 *              ringed 2px white, and the name at 16.5/700
 *
 * A tool view adds Back at 46,100 · 96x44 r11 on `rgba(255,255,255,0.7)`, its
 * title at 212,106 · 25/700, and a 1636x1 rule at 46,164.
 */
export function AgencyStage({
  height,
  /** Absent on Portal Home; present turns on the Back row. */
  toolTitle,
  /** The design glyphs the Client Finder title and nothing else. */
  toolIcon = false,
  onBack,
  children,
}: {
  height: number;
  toolTitle?: string;
  toolIcon?: boolean;
  onBack?: () => void;
  children: ReactNode;
}) {
  const [vw, setVw] = useState(1728);

  useEffect(() => {
    const measure = () => setVw(window.innerWidth || 1728);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const scale = Math.min(1, vw / 1728);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-ag-page">
      <div
        className="relative mx-auto overflow-hidden"
        style={{ height: Math.round(height * scale), width: Math.round(1728 * scale) }}
      >
        <div
          className="absolute left-0 top-0 w-ag-stage origin-top-left bg-ag-stage"
          style={{ transform: `scale(${scale})`, height }}
        >
          {/* ── chrome ─────────────────────────────────────────────────── */}
          <Link
            href="/home"
            className="absolute left-[46px] top-[48px] text-[26px] font-extrabold leading-none text-ink"
          >
            Sparksocial
          </Link>

          <div
            className="absolute left-[1000px] top-[40px] h-[56px] w-[378px] rounded-[28px] bg-white"
            style={{ boxShadow: '0 10px 26px -16px rgba(12,12,12,0.3)' }}
            role="tablist"
            aria-label="Scope"
          >
            <Link
              href="/settings"
              role="tab"
              aria-selected={false}
              className="absolute left-[6px] top-[6px] flex h-[44px] items-center gap-[9px] rounded-[22px] px-[15px] text-[15.5px] font-medium transition-colors hover:bg-[rgba(131,131,131,0.08)]"
              style={{ color: 'rgb(91,91,91)' }}
            >
              <svg width="17" height="17" viewBox="0 0 22 22" fill="none" aria-hidden className="block">
                <circle cx="9" cy="7" r="2.8" stroke="#5B5B5B" strokeWidth="1.6" />
                <path d="M3 17c1-2.7 3.2-4.2 6-4.2 1 0 1.9.2 2.7.5" stroke="#5B5B5B" strokeWidth="1.6" strokeLinecap="round" />
                <path d="m15.8 12.6.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5.5-1.4Z" stroke="#5B5B5B" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
              <span className="whitespace-nowrap">Account Settings</span>
            </Link>
            <span
              role="tab"
              aria-selected
              className="absolute left-[194px] top-[6px] flex h-[44px] items-center gap-[9px] rounded-[22px] bg-ink px-[16px] text-[15.5px] font-semibold text-white"
            >
              <svg width="16" height="15" viewBox="0 0 16 15" fill="none" aria-hidden className="block">
                <rect x="1" y="4" width="14" height="10" rx="2.4" stroke="#FFFFFF" strokeWidth="1.4" />
                <path d="M5.5 4V2.8A1.8 1.8 0 0 1 7.3 1h1.4a1.8 1.8 0 0 1 1.8 1.8V4" stroke="#FFFFFF" strokeWidth="1.4" />
              </svg>
              <span className="whitespace-nowrap">Agency Portal</span>
            </span>
          </div>

          {/* The bell is the app's real notification centre, not a mock. */}
          <div className="absolute left-[1398px] top-[40px]">
            <AgencyBell />
          </div>

          <AgencyProfile />

          {/* ── the Back row, on tool views only ───────────────────────── */}
          {toolTitle ? (
            <>
              <button
                type="button"
                onClick={onBack}
                className="absolute left-[46px] top-[100px] flex h-[44px] w-[96px] items-center justify-center gap-[8px] rounded-[11px] text-[15.5px] font-medium transition-colors hover:bg-white"
                style={{ background: 'rgba(255,255,255,0.7)', boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.25)', color: 'rgb(131,131,131)' }}
              >
                <svg width="7" height="13" viewBox="0 0 8 14" fill="none" aria-hidden>
                  <path d="M7 1 1 7l6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Back
              </button>
              {/* The design glyphs the Client Finder views only — `toolIsCf`. */}
              {toolIcon ? (
                <span aria-hidden className="absolute left-[170px] top-[108px] block">
                  <svg width="30" height="30" viewBox="0 0 26 26" fill="none" className="block">
                    <circle cx="10" cy="8" r="3.4" stroke="#0C0C0C" strokeWidth="1.8" />
                    <path d="M3 20c1.2-3.2 3.9-5 7-5 .9 0 1.8.15 2.6.45" stroke="#0C0C0C" strokeWidth="1.8" strokeLinecap="round" />
                    <circle cx="17.4" cy="16.4" r="3.4" stroke="#0C0C0C" strokeWidth="1.8" />
                    <path d="m20 19 3 3" stroke="#0C0C0C" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </span>
              ) : null}
              <h1 className="absolute left-[212px] top-[106px] whitespace-nowrap text-[25px] font-bold leading-none text-ink">
                {toolTitle}
              </h1>
              <div aria-hidden className="absolute left-[46px] top-[164px] h-px w-ag-tool-wide" style={{ background: 'rgba(131,131,131,0.2)' }} />
            </>
          ) : null}

          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * The 56px bell.
 *
 * The prototype toasts "Notification center — mock" here. `NotificationBell` is
 * the app's own, wired to `human.notifications`, and it is on every other
 * screen — so this is the real one inside the design's circle rather than a
 * drawn glyph that would do nothing.
 */
function AgencyBell() {
  return (
    <span
      className="flex h-[56px] w-[56px] items-center justify-center rounded-full bg-white"
      style={{ boxShadow: '0 10px 26px -16px rgba(12,12,12,0.3)' }}
    >
      <NotificationBell compact />
    </span>
  );
}

/**
 * 1472,40 · 210x56 r28 — avatar, presence dot, name, kebab.
 *
 * The design's "Godswill" is the signed-in user, so this reads Clerk rather
 * than printing a label: the same `#BDEBFA url(...)` avatar treatment the
 * workspaces screen already uses, falling back to the tinted disc when the
 * account has no image. The kebab opens account settings, which is where every
 * item the prototype's menu toasts actually lives.
 */
function AgencyProfile() {
  const { user } = useUser();
  const name = user?.firstName || user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Account';

  return (
    <Link
      href="/settings/profile"
      className="absolute left-[1472px] top-[40px] flex h-[56px] w-[210px] items-center rounded-[28px] bg-white"
      style={{ boxShadow: '0 10px 26px -16px rgba(12,12,12,0.3)' }}
    >
      <span className="relative ml-[8px] block h-[40px] w-[40px] shrink-0">
        <span
          aria-hidden
          className="block h-[40px] w-[40px] rounded-full"
          style={{
            background: user?.imageUrl
              ? `#BDEBFA url('${user.imageUrl}') center / cover no-repeat`
              : 'radial-gradient(circle at 40% 34%, #EAF6FF, #BDEBFA)',
          }}
        />
        <span
          aria-hidden
          className="absolute left-[28px] top-[24px] block h-[14px] w-[14px] rounded-full"
          style={{ background: 'var(--ss-green-500)', boxShadow: '0 0 0 2px #FFFFFF' }}
        />
      </span>
      <span className="ml-[12px] max-w-[92px] truncate text-[16.5px] font-bold text-ink">{name}</span>
      <svg width="4" height="17" viewBox="0 0 4 17" fill="rgb(91,91,91)" className="ml-auto mr-[18px] shrink-0" aria-hidden>
        <circle cx="2" cy="2" r="1.8" />
        <circle cx="2" cy="8.5" r="1.8" />
        <circle cx="2" cy="15" r="1.8" />
      </svg>
    </Link>
  );
}
