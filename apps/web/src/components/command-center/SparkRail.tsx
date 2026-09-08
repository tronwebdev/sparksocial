'use client';

import { UNNAMED_AGENT } from '@sparksocial/shared/agentIdentity';
import { useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import { SparkMark } from '@/components/brand/SparkMark';
import { QuickActions } from './QuickActions';
import { AgentIdentityModal } from './AgentIdentityModal';
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
  approvalMode,
  onOpenChat,
  onTogglePause,
  busy,
}: {
  paused: boolean;
  campaign: { name: string; status: string } | null;
  planning?: number;
  /** Passed through to the identity modal's Autonomy row. */
  approvalMode?: string;
  onOpenChat: () => void;
  onTogglePause: () => void;
  busy?: boolean;
}) {
  const [gov, setGov] = useState<Governance | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  /**
   * "View Agent Identity" opens the identity modal.
   *
   * It was an `<a href="/settings/brand-kit">` — a reasonable stand-in when
   * there was no design for the panel, and wrong now that there is one: the
   * button says *view* and it was navigating away from the screen to a page of
   * editable settings. The modal reads the same `brand.governance.get` this
   * rail already has open.
   */
  const [identityOpen, setIdentityOpen] = useState(false);

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
      /*
        453x781 at radius 15, and the header band is a fixed 58 so the glass
        panel starts on the design's 78 (20 of top padding + 58). It was
        content-sized, so the status line's own wrapping decided where the panel
        began — measured 110.7 against 78, with the panel 415 wide against 396
        because the rail's 19px padding applied to it too.
      */
      className="relative overflow-hidden rounded-lg px-[19px] pt-[20px]"
      style={{ background: 'rgba(255,255,255,0.2)', boxShadow: 'inset 0 0 0 1px #FFFFFF', height: 781 }}
    >
      {/* ── rail header ──────────────────────────────────────────────── */}
      <div className="flex h-[58px] items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="ml-[5px] font-display text-[25.28px] leading-[1.1] text-ink">Spark:</p>
          <p className="mt-[7px] whitespace-nowrap text-16 font-medium leading-[1.31] text-ink-muted">
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

      {/*
        ── the glass panel ───────────────────────────────────────────────

        396x660 at radius 33.46, and everything inside it is placed at the
        design's own offsets rather than stacked.

        In flow the panel's five parts each pushed the next one down, so none of
        them was where `Command Center.dc.html` draws it: the white card is
        398x468 starting at y=192 and overhanging the panel by 1px either side,
        the agent header is 353x123 at 21,222, the traits block starts at 18,366
        and the two buttons sit on y=598. Those are all fixed numbers inside a
        fixed box, which is exactly the case for absolute positioning.

        The x insets are stated as left *and* right so the panel still stretches:
        21/22 on the header, 18/18 on the traits, 25/25 on the buttons - which is
        what the design's own left+width pairs work out to in a 396 panel.
      */}
      <div
        className="relative mx-[10px] h-[660px] overflow-hidden rounded-[33.46px]"
        // style={{
        //   background:
        //     'linear-gradient(207.202deg, rgba(108,232,255,0.15) 5.49%, rgba(163,65,255,0.15) 92.87%)',
        //   boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.6)',
        // }}
      >
        {/* The orb on the gradient, above the white card. 166.2 at 110.4,42.2 —
            4.5px left of centre in the design, which reads as centred. */}
        <div className="absolute left-0 right-0 top-[42.2px] flex justify-center">
          <SparkMark variant="shell" size={166.2} animated />
        </div>

        {/*
          The arch behind the card's top edge: a white-to-transparent sweep at
          18.9,215.3, 348.689x159.668. It was missing entirely, and it is what
          separates the orb from the white card instead of leaving a hard seam.
        */}
        <svg
          aria-hidden
          viewBox="0 0 348.689 159.668"
          className="absolute left-[18.9px] right-[28.4px] top-[215.3px] h-[159.668px] w-auto"
          style={{ backdropFilter: 'blur(11.65px)' }}
        >
          <defs>
            <linearGradient id="cc-arch" x1="0" y1="-0.9268" x2="0" y2="0.7386">
              <stop offset="0" stopColor="#FFFFFF" />
              <stop offset="1" stopColor="rgba(255,255,255,0)" />
            </linearGradient>
          </defs>
          <path
            d="M 138.775 0 C 62.11 0 0 61.257 0 136.869 C 0 149.458 10.352 159.668 23.116 159.668 L 325.573 159.668 C 338.338 159.668 348.689 149.458 348.689 136.869 C 348.689 61.257 286.579 0 209.914 0 L 138.775 0 Z"
            fill="url(#cc-arch)"
          />
        </svg>

        {/* 398x468 at radius 20.78 from y=192, 1px wider than the panel on each
            side so its corners are clipped square by the panel's own radius. */}
        <div className="absolute -left-px -right-px top-[292px] h-[668px] rounded-[20.78px] bg-white" />

        {/* agent header: 353x123 at 21,222 on cyan 30% in a pink ring */}
        <div
          className="absolute left-[21px] right-[22px] top-[322px] h-[123px] rounded-[15px]"
          style={{ background: 'rgba(108,232,255,0.3)', boxShadow: 'inset 0 0 0 1px rgba(245,107,255,0.24)' }}
        >
          <span className="absolute left-[19px] top-[15.8px] block h-[92px] w-[92px]">
            <SparkMark variant="shell" size={92} />
          </span>

          <p className="absolute left-[123px] right-[12px] top-[28px] truncate text-[22.58px] font-semibold leading-[1.28] text-ink">
            {id?.named ? id.name : UNNAMED_AGENT}
          </p>

          {/* 180x28.9 at 125,67.6: the word, then a white pill holding the dot
              and the state. */}
          <div className="absolute left-[125px] top-[67.6px] h-[28.9px] w-[180px]">
            <span className="absolute left-0 top-[6.3px] text-[12.65px] leading-none text-ink">Status</span>
            <span className="absolute left-[47px] top-0 h-[28.9px] w-[69.5px] rounded-[90.3px] bg-white" />
            <span
              className="absolute left-[55.5px] top-[9.5px] block h-[10.74px] w-[10.74px] rounded-full"
              style={{ background: paused ? '#F35525' : '#13D711' }}
            />
            <span className="absolute left-[70px] top-[6.3px] text-[12.65px] leading-none text-ink">
              {paused ? 'Paused' : 'Active'}
            </span>
          </div>
        </div>

        {/* ── traits and activity: a flow stack pinned at 18,366 ────────── */}
        <div className="absolute left-[18px] right-[18px] top-[366px]">
          <div className="flex items-center gap-[9px] pl-[17px]">
            <svg width="16" height="20" viewBox="0 0 16 20" fill="none" aria-hidden className="shrink-0">
              <circle cx="8" cy="4" r="4" fill="#2F8291" />
              <path d="M16 15.5C16 18 16 20 8 20S0 18 0 15.5 3.6 11 8 11s8 2 8 4.5Z" fill="#2F8291" />
            </svg>
            <span className="truncate text-16 font-semibold" style={{ color: '#2F8291' }}>
              {id?.voice.length ? id.voice.join(', ') : 'No voice set'}
            </span>
          </div>

          {/*
            `riskBecause` used to render as a line under this row. It is worth
            keeping — a risk level with no reason beside it is a number somebody
            has to take on faith — but as a sixth row it pushed the divider, the
            activity lines and both buttons off their fixed offsets. It is the
            row's tooltip now.
          */}
          <div
            className="mt-5 flex items-center gap-[9px] pl-[17px]"
            title={id?.riskBecause ?? undefined}
          >
            <svg width="16" height="20" viewBox="0 0 16 20" fill="none" aria-hidden className="shrink-0">
              <path
                d="M7.7.04c.21-.06.44-.05.64.03l7 2.75.14.07c.3.18.5.5.5.86v5.5c0 4.9-3.09 9.1-7.67 10.69a1 1 0 0 1-.66 0C3.09 18.35 0 14.15 0 9.25v-5.5l.01-.15c.05-.35.29-.65.62-.78l7-2.75.07-.03Z"
                fill="#8937D6"
              />
            </svg>
            <span className="truncate text-16 font-medium" style={{ color: '#8937D6' }}>
              Risk Tolerance: <b className="font-semibold">{id?.riskTolerance ?? 'Moderate'}</b>
            </span>
          </div>

          <div className="mt-[18px] h-px" style={{ background: 'rgba(131,131,131,0.2)' }} />

          {/*
            The design fades its three lines — `#0C0C0C`, `#838383`, then
            `rgba(131,131,131,0.5)` — so the one happening now reads first and
            the rest recede. Ours are derived, so the fade follows position in
            whatever list we actually have.
          */}
          <div className="flex flex-col gap-[13px] pl-[17px] pt-[17px]">
            {statuses.map((st, i) => {
              const fade = ['#0C0C0C', '#838383', 'rgba(131,131,131,0.5)'][Math.min(i, 2)]!;
              return (
                <div key={st.label} className="flex items-center gap-2.5">
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
                        stroke={fade}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="truncate text-16 font-normal" style={{ color: fade }}>
                    {st.label}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-4 h-px" style={{ background: 'rgba(131,131,131,0.2)' }} />
        </div>

        {/* ── the two buttons, 169x41.3 on y=598 ───────────────────────── */}
        <button
          type="button"
          onClick={onTogglePause}
          disabled={busy}
          className="absolute left-[25px] top-[598px] flex h-[41.3px] w-[169px] items-center justify-center gap-[9px] rounded-[8.37px] text-[15px] font-medium text-ink disabled:opacity-50"
          style={{
            background: 'rgba(131,131,131,0.1)',
            backdropFilter: 'blur(10px)',
            boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.1)',
          }}
        >
          {paused ? (
            <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
              <circle cx="8.5" cy="8.5" r="7.5" stroke="#0C0C0C" strokeWidth="1.3" />
              <path d="M6.8 5.6v5.8L11.4 8.5 6.8 5.6Z" fill="#0C0C0C" />
            </svg>
          ) : (
            <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
              <circle cx="8.5" cy="8.5" r="7.5" stroke="#0C0C0C" strokeWidth="1.3" />
              <path d="M6.6 5.8v5.4M10.4 5.8v5.4" stroke="#0C0C0C" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
          {paused ? 'Resume Agent' : 'Pause Agent'}
        </button>

        <button
          type="button"
          onClick={() => setIdentityOpen(true)}
          className="absolute right-[25px] top-[598px] flex h-[41.3px] w-[169px] items-center justify-center rounded-[8.37px] text-[15px] font-medium text-ink"
          style={{
            background: 'rgba(131,131,131,0.1)',
            backdropFilter: 'blur(10px)',
            boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.1)',
          }}
        >
          View Agent Identity
        </button>
      </div>

      {identityOpen ? (
        <AgentIdentityModal
          paused={paused}
          {...(approvalMode ? { approvalMode } : {})}
          onClose={() => setIdentityOpen(false)}
        />
      ) : null}
    </aside>
  );
}
