'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import { SparkMark } from '@/components/brand/SparkMark';
import { cn } from '@/lib/utils';

/**
 * The dashboard's agent banner — `SparkSocial Dashboard.dc.html`, the dark card
 * at 357,141.
 *
 * ── Why this is not `AgentIdentityCard` ───────────────────────────────────
 *
 * `BrandHome` and the Command Center were rendering the same white identity
 * card, on the assumption that the two screens open the same way. They do not.
 * The dashboard opens with this: 1323×177 at radius 30, a near-black radial
 * ground with a cyan-to-pink sweep across its right edge, the agent's orb at
 * 119px, its name in 30px white, an Agent Status pill, and three live activity
 * lines above three controls. The Command Center opens with a *light* campaign
 * hero — 1159×297 at radius 20 on a warm `#FEDEB5` gradient, headed "Current
 * Focus". Two different cards, and one component cannot be both.
 *
 * So this is the dashboard's, built to its own measurements.
 *
 * `AgentIdentityCard` is no longer rendered anywhere: the Command Center's
 * Overview dropped it when that screen took the design's tab structure, because
 * the design's identity band is *this* banner and its Overview opens on the
 * campaign. The file is still in the tree, unimported - see the note in
 * `CommandCenterOverview`.
 *
 * ── The three activity lines ──────────────────────────────────────────────
 *
 * The prototype hardcodes "Running 2 Campaigns", "Planning contents for next
 * week", "Analyzing engagement signals", each behind a spinner. Rendered
 * literally they are three animated claims that keep spinning when the agent is
 * paused and nothing is running — the single most corrosive thing this card
 * could do, since everything else on the screen asks you to trust it. So the
 * lines are derived, and there may be one rather than three. The spinner only
 * turns on a line that describes something actually in progress.
 *
 * ── Voice and risk tolerance are not here ─────────────────────────────────
 *
 * They were on the old card. The prototype's banner is identity, status and
 * controls, and the voice adjectives live on the settings screens that set them
 * — which is also where they cannot drift from what they describe. The one thing
 * kept beyond the design is a route to naming, shown only while the agent is
 * unnamed: the prototype assumes that already happened, and a build has to
 * render the state before it did.
 */

interface AgentBannerProps {
  /** Changing brand refetches the identity; the value itself is not sent. */
  genomeId: string | undefined;
  paused: boolean;
  campaign: { name: string; status: string } | null;
  /** Posts queued but not yet approved — a real "planning" signal. */
  planning?: number;
  onChanged?: () => void;
}

interface Governance {
  agentIdentity?: { name: string; named: boolean };
}

const WHITE_60 = 'rgba(255,255,255,0.6)';
const WHITE_75 = 'rgba(255,255,255,0.75)';

export function AgentBanner({ genomeId, paused, campaign, planning = 0, onChanged }: AgentBannerProps) {
  /*
    Read here rather than threaded down from the page's snapshot: the name is
    the agent's own, it changes on a settings screen this component links to,
    and the page has no other use for it. Same call the card it replaces made.
  */
  const [gov, setGov] = useState<Governance | null>(null);
  useEffect(() => {
    void (async () => {
      const res = await invoke<Governance>('brand.governance.get', {});
      if (res.status === 'succeeded') setGov(res.output);
    })();
  }, [genomeId]);
  const identity = gov?.agentIdentity;
  const name = identity?.named ? identity.name : null;

  const [busy, setBusy] = useState(false);
  const [freqOpen, setFreqOpen] = useState(false);
  const [perWeek, setPerWeek] = useState(5);
  const [error, setError] = useState<string | null>(null);

  async function togglePause() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await invoke<{ paused: boolean }>(paused ? 'agent.resume' : 'agent.pause', {});
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That was not allowed.');
      return;
    }
    onChanged?.();
  }

  async function setFrequency() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await invoke('agent.frequency.set', { postsPerWeek: perWeek });
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That was not allowed.');
      return;
    }
    setFreqOpen(false);
    onChanged?.();
  }

  /* Derived, never assumed — see the header. `spin` gates the animation. */
  const lines: Array<{ label: string; spin: boolean }> = paused
    ? [{ label: 'Paused — it will not act until you resume it', spin: false }]
    : !campaign
      ? [{ label: 'No campaign yet, so it is not planning anything', spin: false }]
      : campaign.status === 'draft'
        ? [{ label: `${campaign.name} is planned but not activated`, spin: false }]
        : campaign.status === 'paused'
          ? [{ label: `${campaign.name} is paused`, spin: false }]
          : [
              { label: `Running ${campaign.name}`, spin: true },
              ...(planning > 0
                ? [{ label: `Planning ${planning} post${planning === 1 ? '' : 's'} for the week ahead`, spin: true }]
                : []),
              { label: 'Analyzing engagement signals', spin: true },
            ];

  /*
    No `overflow-hidden` on the card.

    It was clipping the Adjust Frequency popover, which opens 44px below its
    button and so falls outside the 177px card. Nothing needed the clip: the
    card's only decoration is a background gradient, and a background is already
    bounded by `rounded-2xl` — `overflow` governs children, and the only child
    that leaves the box is the popover we want to see.
  */
  return (
    <section className="relative min-h-dash-banner rounded-2xl bg-agent-banner">
      <div className="flex flex-wrap items-start gap-y-6 py-[28.6px] pl-[39px] pr-[39px]">
        {/* ── identity ─────────────────────────────────────────────────── */}
        {/*
          318 exactly, and the name overflows it.

          `min-w-[318px]` was right to refuse `truncate` - the prototype's name
          is `white-space:nowrap` in a card that does not clip, so a long name is
          meant to run past the block rather than be cut - but content-sizing the
          block made the *layout* depend on the name's width. The divider is
          pinned at x=410 and the status column at x=464 in every state of the
          design; with a name wider than the 179px status row underneath it, the
          block grew and carried both of them right, which is what pushed the
          three agent-status lines onto two rows.

          So the box is the design's 318 (118.94 orb + 20.06 + a 179 column) and
          the 30px name paints past its column, unclipped, exactly as the
          prototype's does. Nothing downstream moves, whatever it is called.
        */}
        <div className="flex w-[318px] shrink-0 items-start gap-0">
          <span className="block h-[118.94px] w-[118.94px] shrink-0">
            <SparkMark variant="shell" size={118.94} animated />
          </span>

          <span className="ml-[20.06px] flex w-[179px] shrink-0 flex-col">
            {/*
              The name slot — and where naming lives when there is no name.

              The route to naming was a second line under the status pill. That
              added 27px to a column the 118.94px orb is supposed to measure, so
              the card rendered 191.7 against the design's 177 and the KPI row,
              the feed and the rail all sat 15px low. Moving it beside "Active"
              traded that for a worse fault: it widened the identity block from
              the design's 318 to 421.8 and carried the divider and the entire
              right-hand column 104px right with it.

              So it is the name slot itself. The design's slot holds the agent's
              name; unnamed, it holds the one action that gives it one, in the
              same 30px type and the same box. Nothing moves, and the state the
              design does not draw costs the layout nothing.
            */}
            <span className="mt-[6.4px] whitespace-nowrap text-[30px] font-semibold leading-[1.27] text-white">
              {name ?? (
                <Link
                  href="/settings/brand-kit"
                  className="underline decoration-1 underline-offset-4 transition-colors hover:text-white"
                  style={{ color: WHITE_60 }}
                >
                  Name your agent
                </Link>
              )}
            </span>

            {/* 113×35 pill, then the dot and label outside it. */}
            <span className="mt-[29px] flex items-center">
              <span
                className="flex h-[35px] w-[113px] items-center rounded-[7.38px] pl-[10.6px]"
                style={{ background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(23.78px)' }}
              >
                <span className="text-[14.63px] font-normal leading-[1.36]" style={{ color: WHITE_60 }}>
                  Agent Status
                </span>
              </span>
              <span
                className="ml-[9px] block h-[11.89px] w-[11.89px] rounded-full"
                style={{ background: paused ? '#F35525' : '#13D711' }}
              />
              <span className="ml-[4.11px] text-14 font-normal leading-[1.28]" style={{ color: WHITE_60 }}>
                {paused ? 'Paused' : 'Active'}
              </span>
            </span>
          </span>
        </div>

        {/*
          1px × 134.5 at x=410, i.e. 53px past the identity block.

          The design's rule runs 19.5→154 while the orb beside it runs
          28.6→147.5 — longer than the row it divides, on both ends. As an
          absolutely-positioned element in the prototype that costs nothing; as a
          flex item with `minHeight: 134.5` it became the tallest thing in the
          line and set the card's height to 191.7 against the design's 177,
          which then pushed the KPI row, the feed and the rail down 15px.

          The negative cross-axis margins give it back its real length without
          the height: outer size 134.5 − 9.1 − 6.5 = 118.9, the orb's, so the
          line measures the orb and the rule overhangs it exactly as drawn.
        */}
        <span
          aria-hidden
          className="mx-[53px] hidden h-[134.5px] w-px self-start xl:block"
          style={{ background: 'rgba(255,255,255,0.15)', marginTop: -9.1, marginBottom: -6.5 }}
        />

        {/* ── activity and controls ────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col pt-[15.4px]">
          <div className="flex flex-wrap items-center gap-x-7 gap-y-2">
            {lines.map((l) => (
              <span key={l.label} className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className={cn(
                    'inline-flex h-[19px] w-[19px] shrink-0 items-center justify-center',
                    /* `ss-spin`, 6s linear — only where something is running. */
                    l.spin && 'animate-spin-slow motion-reduce:animate-none',
                  )}
                >
                  <svg width="19" height="19" viewBox="0 0 19 19" fill="none">
                    <circle cx="9.5" cy="9.5" r="8" stroke="rgba(255,255,255,0.25)" strokeWidth="1.6" />
                    <path
                      d="M17.5 9.5a8 8 0 0 0-8-8"
                      stroke="#6CE8FF"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <span className="text-16 font-normal" style={{ color: WHITE_75 }}>
                  {l.label}
                </span>
              </span>
            ))}
          </div>

          <div className="mt-[19px] flex flex-wrap items-center gap-[15px]">
            <button
              type="button"
              onClick={() => void togglePause()}
              disabled={busy}
              className={cn(
                'flex h-[36.6px] w-[150px] items-center justify-center gap-2 rounded-[7.43px]',
                'text-[13.53px] font-medium text-white transition-colors',
                'hover:bg-white/[0.08] disabled:opacity-50',
              )}
            >
              {paused ? (
                <svg width="12" height="14" viewBox="0 0 12 14" fill="none" aria-hidden>
                  <path d="M1 1.2v11.6L11 7 1 1.2Z" fill="currentColor" />
                </svg>
              ) : (
                <svg width="12" height="14" viewBox="0 0 12 14" fill="none" aria-hidden>
                  <path d="M1.5 1h3v12h-3zM7.5 1h3v12h-3z" fill="currentColor" />
                </svg>
              )}
              {busy ? '…' : paused ? 'Resume Agent' : 'Pause Agent'}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setFreqOpen((v) => !v)}
                aria-expanded={freqOpen}
                className="flex h-[36.6px] w-[150px] items-center justify-center rounded-[7.43px] text-[13.53px] font-medium text-white"
                style={{
                  background: 'rgba(255,255,255,0.15)',
                  boxShadow: 'inset 0 0 0 0.57px rgba(255,255,255,0.4)',
                }}
              >
                Adjust Frequency
              </button>

              {/*
                The prototype toasts a mock here. `agent.frequency.set` is real,
                so this is the smallest thing that can actually call it — a
                number and a confirm, in place, rather than a trip to settings.
              */}
              {freqOpen ? (
                <div className="absolute left-0 top-[44px] z-20 w-[236px] rounded-md bg-white p-3 shadow-overlay">
                  <label className="block text-14 text-ink-muted" htmlFor="ss-freq">
                    Posts per week
                  </label>
                  <input
                    id="ss-freq"
                    type="number"
                    min={1}
                    max={21}
                    value={perWeek}
                    onChange={(e) => setPerWeek(Number(e.target.value))}
                    className="mt-1.5 h-10 w-full rounded border border-border px-3 text-16 text-ink outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void setFrequency()}
                    disabled={busy}
                    className="mt-2 h-9 w-full rounded bg-ink text-14 font-medium text-white disabled:opacity-50"
                  >
                    {busy ? 'Saving…' : 'Set frequency'}
                  </button>
                </div>
              ) : null}
            </div>

            <Link
              href="/agents"
              className="flex h-[37px] w-[159px] items-center justify-center gap-2 rounded-[7.43px] text-[13.53px] font-semibold"
              style={{
                background: 'rgba(255,255,255,0.15)',
                boxShadow: '0 0 24.79px 0 rgba(108,232,255,0.32)',
                color: '#6CE8FF',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path
                  d="M7 1.2 12.5 4v6L7 12.8 1.5 10V4L7 1.2Z"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
              Command Center
            </Link>
          </div>

          {error ? (
            <p role="alert" className="mt-2 text-14" style={{ color: '#FF9A7A' }}>
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
