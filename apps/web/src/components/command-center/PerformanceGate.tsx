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

export function PerformanceGate({
  genomeId,
  children,
}: {
  genomeId: string | undefined;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<GateState>({ kind: 'loading' });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!genomeId) {
      setState({ kind: 'unknown' });
      return;
    }
    void (async () => {
      const res = await invoke<{ confidence: number; active: boolean; arms: Arm[] }>(
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
      /* The floor is not returned as a number, only as the flag — so it is
         inferred from the smallest qualifying arm when there is one, and shown
         as "keep going" rather than a fake target when there is not. */
      const needed = arms.filter((a) => a.qualifies).reduce((n, a) => Math.min(n, a.observations), Infinity);

      if (!eligible) {
        setState({ kind: 'blocked', observations: best, needed: Number.isFinite(needed) ? needed : 0 });
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

      {showBlocked ? (
        <GateCard
          tone="blocked"
          onClose={() => setDismissed(true)}
          action={{
            label: 'Learn More',
            onClick: () => setDismissed(true),
          }}
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
      ) : null}

      {showUnlocked ? (
        <GateCard
          tone="unlocked"
          onClose={() => setDismissed(true)}
          action={{ label: 'View Performance & Learning', onClick: () => setDismissed(true) }}
        >
          <span style={{ color: '#1E8C42' }}>Great news!</span> You now have access to the performance
          &amp; learning feature.
        </GateCard>
      ) : null}
    </>
  );
}

function GateCard({
  tone,
  children,
  detail,
  action,
  onClose,
}: {
  tone: 'blocked' | 'unlocked';
  children: React.ReactNode;
  detail?: string;
  action: { label: string; onClick: () => void };
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center px-4 pt-[14vh]" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-transparent" />

      <div
        className="relative w-[320px] max-w-full animate-modal-in rounded-[16px] px-[26px] pb-[24px] pt-[16px] text-center motion-reduce:animate-none"
        style={{
          background:
            tone === 'blocked'
              ? 'linear-gradient(170deg, #FFFFFF 0%, #FFF6F6 46%, #FFE4E4 100%)'
              : 'linear-gradient(170deg, #FFFFFF 0%, #F4FCFB 46%, #DFF6F1 100%)',
          boxShadow: '0 30px 70px -28px rgba(12,12,12,0.45)',
        }}
      >
        <span aria-hidden className="absolute left-[14px] top-[14px] block h-[15px] w-[15px] rounded-full text-[10px] font-bold leading-[15px]" style={{ color: '#9A9A9A', boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.5)' }}>
          i
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-[12px] top-[12px] flex h-[20px] w-[20px] items-center justify-center rounded-full transition-colors hover:bg-[rgba(131,131,131,0.14)]"
        >
          <svg width="9" height="9" viewBox="0 0 11 11" fill="none" aria-hidden>
            <path d="m1 1 9 9m0-9-9 9" stroke="#838383" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        <span className="mx-auto mt-[10px] flex h-[62px] w-[62px] items-center justify-center">
          {tone === 'blocked' ? (
            <svg width="58" height="52" viewBox="0 0 58 52" fill="none" aria-hidden>
              <path d="M29 4.5 55 47H3L29 4.5Z" fill="#F2A0A0" />
              <path d="M29 4.5 55 47H3L29 4.5Z" stroke="#E14A4A" strokeWidth="2.4" strokeLinejoin="round" />
              <path d="M29 20v11" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" />
              <circle cx="29" cy="38.4" r="2.1" fill="#FFFFFF" />
            </svg>
          ) : (
            <svg width="58" height="52" viewBox="0 0 58 52" fill="none" aria-hidden>
              <circle cx="29" cy="26" r="18" fill="#5AD1B4" />
              <path d="m20.5 26.4 6 6L38 20.6" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M8 12.5 5 8m9-2 1-5m6 6 3-4" stroke="#F5B23C" strokeWidth="2" strokeLinecap="round" />
              <path d="M50 12.5 53 8m-9-2-1-5m-6 6-3-4" stroke="#A46CF0" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </span>

        <p className="mt-[12px] text-[16px] font-semibold leading-[1.35] text-ink">{children}</p>
        {detail ? <p className="mt-[9px] text-[12.5px] leading-[1.45] text-ink-muted">{detail}</p> : null}

        <button
          type="button"
          onClick={action.onClick}
          className="mt-[16px] h-[34px] rounded-[7px] bg-white px-[16px] text-[13px] font-medium text-ink transition-colors hover:bg-[#F4F5F7]"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.4)' }}
        >
          {action.label}
        </button>
      </div>
    </div>
  );
}
