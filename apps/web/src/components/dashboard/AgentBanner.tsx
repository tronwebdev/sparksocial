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
 * So this is the dashboard's, built to its own measurements, and
 * `AgentIdentityCard` stays where the Command Center still uses it until that
 * screen gets the same treatment.
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

  return (
    <section
      className="relative overflow-hidden rounded-[30px]"
      style={{
        minHeight: 177,
        background:
          'linear-gradient(117.732deg, rgba(65,139,153,0) 83.25%, rgba(92,197,216,0.37) 92.13%, rgba(245,107,255,0.5) 99.02%), radial-gradient(661.5px 88.5px at 50% 50%, #044956 0%, #0C0C0C 100%)',
      }}
    >
      <div className="flex flex-wrap items-start gap-y-6 py-[28.6px] pl-[39px] pr-[39px]">
        {/* ── identity ─────────────────────────────────────────────────── */}
        {/*
          `min-w`, not `w`. The prototype's identity block is 318 wide and its
          name is `white-space:nowrap` inside a card that does not clip it, so a
          long agent name runs past 318 rather than being cut - which is what a
          fixed width plus `truncate` did here, rendering "Unnamed a...".
        */}
        <div className="flex min-w-[318px] shrink-0 items-start gap-0">
          <span className="block h-[118.94px] w-[118.94px] shrink-0">
            <SparkMark variant="shell" size={118.94} animated />
          </span>

          <span className="ml-[20.06px] flex min-w-0 flex-col">
            <span className="mt-[6.4px] whitespace-nowrap text-[30px] font-semibold leading-[1.27] text-white">
              {name ?? <span style={{ color: WHITE_60 }}>Unnamed agent</span>}
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

            {!name ? (
              <Link
                href="/settings/brand-kit"
                className="mt-[10px] text-[13.53px] font-medium underline underline-offset-2"
                style={{ color: '#6CE8FF' }}
              >
                Give it a name
              </Link>
            ) : null}
          </span>
        </div>

        {/* 1px × 134.5 at x=410, i.e. 53px past the identity block. */}
        <span
          aria-hidden
          className="mx-[53px] hidden w-px self-stretch xl:block"
          style={{ background: 'rgba(255,255,255,0.15)', minHeight: 134.5 }}
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
