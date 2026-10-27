'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';

/**
 * The eligibility gate on Performance & Learning.
 *
 * ── What "eligible" means, and why it is this ─────────────────────────────
 *
 * The tab's whole subject is what SPARK has learned from what it published.
 * `learning.confidence` returns one arm per content pillar with an
 * `observations` count and a `qualifies` flag, and that flag is the engine's own
 * threshold — `observations >= EXPLORATION_FLOOR_OBSERVATIONS`, the point below
 * which it refuses to reweight anything because the numbers would be noise
 * (`packages/learning/src/tool.ts`).
 *
 * So the gate is: **at least one pillar has cleared the engine's own floor.**
 * Not a plan, not a flag somebody sets — the same line the mix engine draws for
 * itself. A brand under it would open the tab and see charts drawn from three
 * posts, which is worse than being told to keep publishing: it looks like
 * insight and it is arithmetic on noise.
 *
 * This mirrors `EngagementGate`, which does the same thing for the sibling tab
 * with `engage.eligibility.check` — PRD §8.8's "ineligible (still learning)"
 * state, applied to the tab whose data is literally the learning loop.
 *
 * ── The two panels ────────────────────────────────────────────────────────
 *
 * Neither is in a `.dc.html`; both are built to the screenshots supplied with
 * the request. A ~310px card, radius 16, on a tinted gradient: rose for the
 * blocked state under a warning mark, mint for the unlocked one under a tick.
 *
 * "Great news, you now have access" is a *transition*, not a state — it fires
 * the first time a brand crosses the floor and never again, which is what the
 * `ss-perf-unlocked:` latch in `localStorage` is for. Announcing it on every
 * visit would make the moment meaningless, and there is no server-side "has
 * been told" field to hang it on (adding a column for a one-off toast would be
 * the wrong trade).
 */

interface Arm {
  pillar: string;
  observations: number;
  qualifies: boolean;
}

type GateState =
  | { kind: 'loading' }
  /* Nothing to gate on — no genome selected, or the read was refused. The tab
     renders rather than accusing somebody of being ineligible on no evidence. */
  | { kind: 'unknown' }
  | { kind: 'blocked'; observations: number; needed: number }
  | { kind: 'allowed'; justUnlocked: boolean };

const LATCH = 'ss-perf-unlocked:';

/**
 * The eligibility read, on its own so the tab strip can ask *before* it moves.
 *
 * The gate used to be only a wrapper: you clicked Performance & Learning, the
 * tab switched, and then the card appeared over a blurred panel you had already
 * been taken to. Being told you cannot go somewhere after arriving is the wrong
 * order. The Command Center now calls this hook and refuses the switch, so the
 * card opens over the tab you were on.
 *
 * The wrapper below still exists for the case the tab strip cannot intercept:
 * a link straight to `/agents?tab=performance`.
 */
export function usePerformanceEligibility(genomeId: string | undefined): GateState {
  const [state, setState] = useState<GateState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    if (!genomeId) {
      setState({ kind: 'unknown' });
      return;
    }
    void (async () => {
      const res = await invoke<{ confidence: number; active: boolean; arms: Arm[]; observationFloor?: number }>(
        'learning.confidence',
        { genomeId },
      );
      if (cancelled) return;
      if (res.status !== 'succeeded') {
        setState({ kind: 'unknown' });
        return;
      }

      const arms = res.output.arms ?? [];
      const eligible = arms.some((a) => a.qualifies);
      const best = arms.reduce((n, a) => Math.max(n, a.observations), 0);
      /* The engine's own floor, which the tool returns now. It used to be
         inferred from the smallest qualifying arm — impossible before the first
         one qualifies, which is exactly when somebody asks how many more. */
      const needed = res.output.observationFloor ?? 0;

      if (!eligible) {
        setState({ kind: 'blocked', observations: best, needed });
        return;
      }

      let justUnlocked = false;
      try {
        const key = `${LATCH}${genomeId}`;
        justUnlocked = window.localStorage.getItem(key) !== '1';
        if (justUnlocked) window.localStorage.setItem(key, '1');
      } catch {
        /* Private mode, or storage disabled. Never announcing is the safe side
           of this: a missed celebration beats one on every page load. */
      }
      setState({ kind: 'allowed', justUnlocked });
    })();
    return () => {
      cancelled = true;
    };
  }, [genomeId]);

  return state;
}

/**
 * The blocked / just-unlocked card, on its own so it can be opened by the tab
 * strip as well as by the wrapper.
 */
export function PerformanceGateModal({ state, onClose }: { state: GateState; onClose: () => void }) {
  if (state.kind === 'blocked') {
    return (
      <GateCard
        tone="blocked"
        onClose={onClose}
        /* "Learn More" closed the card, which is a button lying about what it
           does. It opens the explanation inside the card now, and then reads
           "Got it". */
        action={{ label: 'Learn More', onClick: onClose }}
        learnMore={<LearnMore observations={state.observations} needed={state.needed} />}
        detail={
          state.observations > 0
            ? `SPARK has ${state.observations} measured ${state.observations === 1 ? 'outcome' : 'outcomes'} on its strongest content pillar${
                state.needed ? `, and needs ${state.needed}` : ''
              }. Keep publishing — this opens by itself.`
            : 'Nothing has been published and measured yet, so there is nothing to learn from. This opens by itself once there is.'
        }
      >
        <span style={{ color: '#E14A4A' }}>Oops!, you&rsquo;re not eligible</span> to access the
        performance &amp; learning feature
      </GateCard>
    );
  }

  if (state.kind === 'allowed') {
    return (
      <GateCard
        tone="unlocked"
        onClose={onClose}
        action={{ label: 'View Performance & Learning', onClick: onClose }}
      >
        <span style={{ color: '#1E8C42' }}>Great news!</span> You now have access to the performance
        &amp; learning feature.
      </GateCard>
    );
  }

  return null;
}

export function PerformanceGate({
  genomeId,
  children,
}: {
  genomeId: string | undefined;
  children: React.ReactNode;
}) {
  const state = usePerformanceEligibility(genomeId);
  const [dismissed, setDismissed] = useState(false);

  const showBlocked = state.kind === 'blocked' && !dismissed;
  const showUnlocked = state.kind === 'allowed' && state.justUnlocked && !dismissed;

  return (
    <>
      {/* The panel underneath stays rendered and is blurred behind the card,
          exactly as the screenshots draw it — the tab is not a locked door, it
          is a room you are being told is not ready yet. */}
      <div
        className={showBlocked ? 'pointer-events-none select-none blur-[3px]' : undefined}
        aria-hidden={showBlocked || undefined}
      >
        {children}
      </div>

      {showBlocked || showUnlocked ? (
        <PerformanceGateModal state={state} onClose={() => setDismissed(true)} />
      ) : null}
    </>
  );
}

/**
 * What "Learn More" opens: what the tab is, what unlocks it, and what to do
 * meanwhile — in the engine's own terms, with its own threshold.
 */
function LearnMore({ observations, needed }: { observations: number; needed: number }) {
  const left = needed > observations ? needed - observations : 0;
  return (
    <div className="mt-[22px] space-y-[14px] text-left text-15 leading-[1.5] text-ink-muted">
      <div>
        <p className="font-semibold text-ink">What this tab shows</p>
        <p className="mt-[2px]">
          Once posts go out, SPARK measures how each one did — reach, engagement, clicks — and learns which content
          pillars and formats work for this brand. This tab shows those results, and what your agent changed because
          of them.
        </p>
      </div>
      <div>
        <p className="font-semibold text-ink">What unlocks it</p>
        <p className="mt-[2px]">
          {needed
            ? `One content pillar needs ${needed} published and measured posts. Fewer than that and a trend is noise, so SPARK won’t act on it, or show it to you as insight.`
            : 'One content pillar needs enough published and measured posts for a trend to mean something. Fewer than that is noise.'}
          {left ? ` ${left} more to go.` : ''}
        </p>
      </div>
      <div>
        <p className="font-semibold text-ink">What to do meanwhile</p>
        <p className="mt-[2px]">
          Keep your campaign running and posts publishing. Results are measured automatically — there is nothing to
          switch on, and this opens by itself.
        </p>
      </div>
    </div>
  );
}

function GateCard({
  tone,
  children,
  detail,
  action,
  learnMore,
  onClose,
}: {
  tone: 'blocked' | 'unlocked';
  children: React.ReactNode;
  detail?: string;
  action: { label: string; onClick: () => void };
  /** When given, the action opens this inside the card instead of running. */
  learnMore?: React.ReactNode;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto px-4 pb-[6vh] pt-[11vh]"
      role="dialog"
      aria-modal="true"
    >
      {/* Dimmed, as every other modal in the product is. It was transparent,
          so the page looked usable while every click on it was being caught. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 animate-fade-in cursor-default border-0 bg-[rgba(40,40,40,0.45)] motion-reduce:animate-none"
      />

      <div
        className="relative w-[520px] max-w-full animate-modal-in rounded-[22px] px-[44px] pb-[38px] pt-[24px] text-center motion-reduce:animate-none"
        style={{
          background:
            tone === 'blocked'
              ? 'linear-gradient(170deg, #FFFFFF 0%, #FFF6F6 46%, #FFE4E4 100%)'
              : 'linear-gradient(170deg, #FFFFFF 0%, #F4FCFB 46%, #DFF6F1 100%)',
          boxShadow: '0 30px 70px -28px rgba(12,12,12,0.45)',
        }}
      >
        <span aria-hidden className="absolute left-[20px] top-[20px] block h-[20px] w-[20px] rounded-full text-13 font-bold leading-[20px]" style={{ color: '#9A9A9A', boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.5)' }}>
          i
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-[18px] top-[18px] flex h-[28px] w-[28px] items-center justify-center rounded-full transition-colors hover:bg-[rgba(131,131,131,0.14)]"
        >
          <svg width="12" height="12" viewBox="0 0 11 11" fill="none" aria-hidden>
            <path d="m1 1 9 9m0-9-9 9" stroke="#838383" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        <span className="mx-auto mt-[14px] flex h-[96px] w-[96px] items-center justify-center">
          {tone === 'blocked' ? (
            <svg width="90" height="81" viewBox="0 0 58 52" fill="none" aria-hidden>
              <path d="M29 4.5 55 47H3L29 4.5Z" fill="#F2A0A0" />
              <path d="M29 4.5 55 47H3L29 4.5Z" stroke="#E14A4A" strokeWidth="2.4" strokeLinejoin="round" />
              <path d="M29 20v11" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" />
              <circle cx="29" cy="38.4" r="2.1" fill="#FFFFFF" />
            </svg>
          ) : (
            <svg width="90" height="81" viewBox="0 0 58 52" fill="none" aria-hidden>
              <circle cx="29" cy="26" r="18" fill="#5AD1B4" />
              <path d="m20.5 26.4 6 6L38 20.6" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M8 12.5 5 8m9-2 1-5m6 6 3-4" stroke="#F5B23C" strokeWidth="2" strokeLinecap="round" />
              <path d="M50 12.5 53 8m-9-2-1-5m-6 6-3-4" stroke="#A46CF0" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </span>

        <p className="mt-[20px] text-24 font-semibold leading-[1.32] text-ink">{children}</p>
        {detail ? <p className="mt-[14px] text-16 leading-[1.5] text-ink-muted">{detail}</p> : null}

        {expanded ? <div className="animate-fade-in motion-reduce:animate-none">{learnMore}</div> : null}

        <button
          type="button"
          onClick={learnMore && !expanded ? () => setExpanded(true) : action.onClick}
          aria-expanded={learnMore ? expanded : undefined}
          className="mt-[26px] h-[48px] rounded-[10px] bg-white px-[28px] text-16 font-medium text-ink transition-colors hover:bg-[#F4F5F7]"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.4)' }}
        >
          {learnMore && expanded ? 'Got it' : action.label}
        </button>
      </div>
    </div>
  );
}
