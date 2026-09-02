'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import { SparkMark } from '@/components/brand/SparkMark';
import { QuickActions } from './QuickActions';
import { cn } from '@/lib/utils';

/**
 * The Spark rail — `SparkSocial Command Center.dc.html`, the shared right
 * column at 1227,241, 453x781.
 *
 * `railVisible` is false only on Agent Calendar, so it stands beside Overview,
 * Performance & Learning and Engagement Intelligence. It is also the reason the
 * hero and the Queue card are 1159 wide rather than full-bleed: this is the
 * 453px they leave room for.
 *
 * ── It is where the agent's identity actually lives ───────────────────────
 *
 * Two commits ago I called `AgentIdentityCard` dead code, having taken it off
 * the Overview because the design's Overview opens on the campaign. That was
 * right about the Overview and wrong about the screen: the identity is *here* —
 * the name at 22.58px/600, a status pill, the voice adjectives in `#2F8291`,
 * "Risk Tolerance: Moderate" in `#8937D6`, the spinning activity lines, and
 * Pause / View Agent Identity. I had read the file as far as the Queue card and
 * concluded a component was unused from the part I had not read.
 *
 * So this renders that content, at the design's numbers, from the same
 * `brand.governance.get` call the old card made. `QuickActions` likewise turns
 * out to have a home — the 218x47 button at the rail's top right.
 *
 * ── Structure, because it is three boxes deep ─────────────────────────────
 *
 *   rail        453x781  r15   `rgba(255,255,255,0.2)` in a 1px white ring
 *   glass       396x660  r33.46 cyan-to-purple at 15%, in a 1px black ring
 *   white card  398x468  r20.78 — overlaps the glass, starting 192px down, so
 *                              the orb above it sits on the gradient
 */

interface Governance {
  agentIdentity?: {
    name: string;
    named: boolean;
    voice: string[];
    riskTolerance: string;
    riskBecause: string;
  };
}

export function SparkRail({
  paused,
  campaign,
  planning = 0,
  onOpenChat,
  onTogglePause,
  busy,
}: {
  paused: boolean;
  campaign: { name: string; status: string } | null;
  planning?: number;
  onOpenChat: () => void;
  onTogglePause: () => void;
  busy?: boolean;
}) {
  const [gov, setGov] = useState<Governance | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await invoke<Governance>('brand.governance.get', {});
      if (res.status === 'succeeded') setGov(res.output);
    })();
  }, []);

  const id = gov?.agentIdentity;

  /*
    The design's three activity lines, derived rather than transcribed — same
    reasoning as the dashboard's banner. A spinner that keeps turning while the
    agent is paused is the most corrosive thing a panel like this can do.
  */
  const statuses: Array<{ label: string; spin: boolean }> = paused
    ? [{ label: 'Paused — it will not act until you resume', spin: false }]
    : !campaign
      ? [{ label: 'No campaign yet, so nothing is planned', spin: false }]
      : campaign.status === 'draft'
        ? [{ label: `${campaign.name} is planned, not activated`, spin: false }]
        : [
            { label: `Running ${campaign.name}`, spin: true },
            ...(planning > 0 ? [{ label: `Planning ${planning} post${planning === 1 ? '' : 's'}`, spin: true }] : []),
            { label: 'Analyzing engagement signals', spin: true },
          ];

  return (
    <aside
      className="relative overflow-hidden rounded-lg px-[19px] pb-[43px] pt-[20px]"
      style={{ background: 'rgba(255,255,255,0.2)', boxShadow: 'inset 0 0 0 1px #FFFFFF' }}
    >
      {/* ── rail header ──────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-display text-[25.28px] leading-[1.1] text-ink">Spark:</p>
          <p className="mt-[10px] text-16 font-medium leading-[1.31] text-ink-muted">
            {/* The design's "✨ Freshly Activated". True on day one and a lie
                after that, so it says which state the agent is in. */}
            {paused ? '⏸ Paused' : campaign ? '✨ Running your presence' : '✨ Freshly Activated'}
          </p>
        </div>

        {/*
          The design's Quick Actions is a 218x47 *button* with an icon and a
          chevron - a disclosure. `QuickActions` is the expanded list, and
          dropping it straight into that slot rendered a five-row panel with its
          own heading where a button belongs. So the button is the button, and it
          toggles the list underneath.
        */}
        <button
          type="button"
          onClick={() => setActionsOpen((v) => !v)}
          aria-expanded={actionsOpen}
          className="flex h-[47px] w-[218px] shrink-0 items-center gap-2.5 rounded-xl bg-white px-4 text-16 font-semibold text-ink"
          style={{ boxShadow: '0 6px 18px -8px rgba(12,12,12,0.25)' }}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M10 1.6 12.2 7l5.8.4-4.4 3.8 1.3 5.7L10 13.9 5.1 16.9l1.3-5.7L2 7.4 7.8 7 10 1.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          <span className="flex-1 text-left">Quick Actions</span>
          <svg
            width="11"
            height="7"
            viewBox="0 0 12 8"
            fill="none"
            aria-hidden
            className={cn('transition-transform', actionsOpen && 'rotate-180')}
          >
            <path d="m1 1 5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {actionsOpen ? (
        <div className="mt-3">
          <QuickActions onOpenChat={onOpenChat} />
        </div>
      ) : null}

      {/* ── the glass panel ──────────────────────────────────────────── */}
      <div
        className="relative mt-[11px] overflow-hidden rounded-[33.46px] pb-[1px]"
        style={{
          background:
            'linear-gradient(207.202deg, rgba(108,232,255,0.15) 5.49%, rgba(163,65,255,0.15) 92.87%)',
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.6)',
        }}
      >
        {/* The orb, on the gradient above the white card. 166.2px in the design. */}
        <div className="flex justify-center pt-[42px]">
          <SparkMark variant="shell" size={166.2} animated />
        </div>

        {/* 398x468 at radius 20.78, starting 192px into the panel. */}
        <div className="mt-[42px] rounded-[20.78px] bg-white px-[21px] pb-[25px] pt-[30px]">
          {/* agent header: 353x123 at radius 15 on cyan 30% in a pink ring */}
          <div
            className="flex items-center gap-4 rounded-[15px] p-[15.8px]"
            style={{ background: 'rgba(108,232,255,0.3)', boxShadow: 'inset 0 0 0 1px rgba(245,107,255,0.24)' }}
          >
            <span className="block h-[92px] w-[92px] shrink-0">
              <SparkMark variant="shell" size={92} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[22.58px] font-semibold leading-[1.28] text-ink">
                {id?.named ? id.name : 'Unnamed agent'}
              </p>
              <div className="mt-[14px] flex items-center gap-2">
                <span className="text-[12.65px] text-ink">Status</span>
                <span className="flex h-[28.9px] items-center gap-2 rounded-full bg-white px-[9px]">
                  <span
                    className="block h-[10.74px] w-[10.74px] rounded-full"
                    style={{ background: paused ? '#F35525' : '#13D711' }}
                  />
                  <span className="text-[12.65px] text-ink">{paused ? 'Paused' : 'Active'}</span>
                </span>
              </div>
            </div>
          </div>

          {/* ── traits ─────────────────────────────────────────────── */}
          <div className="mt-[21px]">
            <div className="flex items-center gap-[9px]">
              <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden>
                <path d="M9 1.5 11 6.4l5.3.4-4 3.5 1.2 5.2L9 12.8 4.5 15.5l1.2-5.2-4-3.5 5.3-.4L9 1.5Z" stroke="#2F8291" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
              <span className="truncate text-16 font-semibold" style={{ color: '#2F8291' }}>
                {id?.voice.length ? id.voice.join(', ') : 'No voice set'}
              </span>
            </div>

            <div className="mt-5 flex items-center gap-[9px]">
              <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden>
                <path d="M9 1.8 16 5v5.4c0 3.2-2.9 5.4-7 6.8-4.1-1.4-7-3.6-7-6.8V5l7-3.2Z" stroke="#8937D6" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
              <span className="text-16 font-medium" style={{ color: '#8937D6' }}>
                Risk Tolerance: <b className="font-semibold">{id?.riskTolerance ?? 'Moderate'}</b>
              </span>
            </div>

            {/* The `because` is not in the design and is kept: a risk level with
                no reason beside it is a number somebody has to take on faith. */}
            {id?.riskBecause ? (
              <p className="mt-1.5 pl-[26px] text-[12.5px] text-ink-muted">{id.riskBecause}</p>
            ) : null}

            <div className="mt-[18px] h-px" style={{ background: 'rgba(131,131,131,0.2)' }} />

            <div className="flex flex-col gap-[13px] pl-[17px] pt-[17px]">
              {statuses.map((st) => (
                <div key={st.label} className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className={cn(
                      'inline-flex h-[17px] w-[17px] shrink-0 items-center justify-center',
                      st.spin && 'animate-spin-slow motion-reduce:animate-none',
                    )}
                  >
                    <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
                      <circle cx="9" cy="9" r="7.4" stroke="rgba(12,12,12,0.15)" strokeWidth="1.5" />
                      <path d="M16.4 9A7.4 7.4 0 0 0 9 1.6" stroke="#6CE8FF" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span className="truncate text-16 text-ink-muted">{st.label}</span>
                </div>
              ))}
            </div>

            <div className="mt-4 h-px" style={{ background: 'rgba(131,131,131,0.2)' }} />
          </div>

          {/* ── the two rail buttons ───────────────────────────────── */}
          <div className="mt-[18px] flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onTogglePause}
              disabled={busy}
              className="flex h-[41.3px] flex-1 items-center justify-center gap-[9px] rounded-lg text-[15px] font-medium text-ink disabled:opacity-50"
              style={{ background: 'rgba(131,131,131,0.1)', boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.1)' }}
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
              className="flex h-[41.3px] flex-1 items-center justify-center rounded-lg text-[15px] font-medium text-ink"
              style={{ background: 'rgba(131,131,131,0.1)', boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.1)' }}
            >
              View Agent Identity
            </a>
          </div>
        </div>
      </div>
    </aside>
  );
}
