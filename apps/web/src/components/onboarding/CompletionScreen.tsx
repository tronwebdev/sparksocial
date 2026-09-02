'use client';

import { useEffect, useState } from 'react';
import { Wordmark } from '@/components/brand/Wordmark';
import { invoke } from '@/lib/tools';
import { HoldButton } from './HoldButton';

/**
 * `L5` / `F6` — "Congratulations on creating your first Agent".
 *
 * The flow used to end by pushing to `/`, which meant setup finished by dropping
 * somebody on a dashboard with nothing on it — L5's exact complaint. This is the
 * screen the prototype ends on, with its press-and-hold, and it does one more
 * thing than congratulate: it says what is still missing.
 *
 * ── Why a completion screen states the gaps ───────────────────────────────
 *
 * Everything after the routing questions is skippable, and skipping is the
 * common path — so the honest end of setup is not a tick, it is a short list of
 * what SPARK can and cannot do yet. A brand with no connected account and no
 * assets will otherwise read "you're all set", find an empty calendar, and
 * conclude the product does not work.
 *
 * The list is read rather than remembered: `brand.governance.get` for the kit's
 * progress and the agent's name, `integration.health` for accounts, `asset.gaps`
 * for what one upload would unlock. Any of those failing costs a line, not the
 * screen.
 */

interface Readiness {
  agentName?: string;
  brandKitPct?: number;
  brandKitNext?: string;
  connected: number;
  unlockableByUpload: number;
}

export function CompletionScreen({ genomeId, brandName, onDone }: { genomeId: string; brandName: string; onDone: () => void }) {
  const [state, setState] = useState<Readiness | null>(null);

  useEffect(() => {
    void (async () => {
      const [gov, health, gaps] = await Promise.all([
        invoke<{
          agentName?: string;
          brandKit?: { pct: number; next?: { label: string } };
        }>('brand.governance.get', {}),
        invoke<{ platforms: Array<{ connected: boolean }> }>('integration.health', {}),
        invoke<{ gaps: Array<{ playbooksBlocked: string[]; unlockedBy: string }> }>('asset.gaps', { genomeId }),
      ]);

      setState({
        ...(gov.status === 'succeeded' && gov.output.agentName ? { agentName: gov.output.agentName } : {}),
        ...(gov.status === 'succeeded' && gov.output.brandKit
          ? {
              brandKitPct: gov.output.brandKit.pct,
              ...(gov.output.brandKit.next ? { brandKitNext: gov.output.brandKit.next.label } : {}),
            }
          : {}),
        connected: health.status === 'succeeded' ? health.output.platforms.filter((p) => p.connected).length : 0,
        unlockableByUpload:
          gaps.status === 'succeeded'
            ? (gaps.output.gaps.find((g) => g.unlockedBy === 'upload')?.playbooksBlocked.length ?? 0)
            : 0,
      });
    })();
  }, [genomeId]);

  const agent = state?.agentName;

  return (
    <div className="relative flex min-h-screen flex-col items-center overflow-hidden bg-[--ss-surface-200] px-6 py-10">
      <img
        src="/auth/bg-onboarding.svg"
        alt=""
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />

      <div className="relative">
        <Wordmark showMark={false} fontSize={28} />
      </div>

      <main className="relative flex w-full flex-1 flex-col items-center pt-[140px] text-center">
        <img
          src="/auth/signup-logo.svg"
          alt=""
          aria-hidden
          className="h-[148px] w-[148px] animate-breathe motion-reduce:animate-none"
        />

        {/* Two lines, and only the first carries the gradient — the capture sets
            "Congratulations" in the brand ramp and the rest in plain ink. */}
        <h1 className="mt-[228px] font-display text-[40px] leading-[1.2] text-ink-muted">
          <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'var(--ss-grad-brand)' }}>
            Congratulations
          </span>{' '}
          On
          <br />
          Creating Your First Agent
        </h1>

        <div className="mt-[60px] flex flex-col items-center">
          <HoldButton
            label="Continue to Dashboard"
            caption="Press &amp; Hold button to continue"
            onComplete={onDone}
          />
        </div>

        {/*
          NOT in `…193247`, and kept deliberately.

          The capture ends on the congratulation alone. Everything after the
          routing questions is skippable and skipping is the common path, so a
          bare tick sends a brand with no connected account and no assets to an
          empty calendar concluding the product is broken — which is the L5
          complaint this screen was built to answer. The lines are facts read
          from `brand.governance.get`, `integration.health` and `asset.gaps`.

          Demoted to a quiet summary under the button rather than the headline
          list it was, so the screen matches the design's hierarchy. Flagged in
          `ui build/MANIFEST.md`; say the word and it goes.
        */}
        <ul className="mx-auto mt-[52px] flex w-full max-w-[460px] flex-col gap-2 text-left">
          <Line
            done
            text={
              agent
                ? `${agent} knows what ${brandName || 'your brand'} does and how it should sound.`
                : 'SPARK knows what your brand does and how it should sound.'
            }
          />
          <Line
            done={(state?.brandKitPct ?? 0) >= 100}
            text={
              (state?.brandKitPct ?? 0) >= 100
                ? 'Your brand kit is complete, so posts will carry your colours and type.'
                : `Brand kit ${state?.brandKitPct ?? 0}% done${
                    state?.brandKitNext ? ` — ${state.brandKitNext.toLowerCase()} next` : ''
                  }. Until it is, posts render on defaults.`
            }
          />
          <Line
            done={(state?.connected ?? 0) > 0}
            text={
              (state?.connected ?? 0) > 0
                ? `${state?.connected} account${state?.connected === 1 ? '' : 's'} connected, so posts can actually go out.`
                : 'No account connected yet — SPARK will plan and draft, and hold everything until one is.'
            }
          />
          <Line
            done={(state?.unlockableByUpload ?? 0) === 0}
            text={
              (state?.unlockableByUpload ?? 0) === 0
                ? 'It has enough to work with to start making posts.'
                : `${state?.unlockableByUpload} more format${
                    state?.unlockableByUpload === 1 ? '' : 's'
                  } unlock the moment you upload a photo or clip.`
            }
          />
        </ul>
      </main>
    </div>
  );
}

function Line({ done, text }: { done: boolean; text: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        aria-hidden
        className={
          done
            ? 'mt-[3px] flex size-4 shrink-0 items-center justify-center rounded-full bg-success/20 text-[10px] text-success'
            : 'mt-[3px] flex size-4 shrink-0 items-center justify-center rounded-full border border-border text-[10px] text-ink-muted'
        }
      >
        {done ? '✓' : ''}
      </span>
      {/* Not a visual-only distinction: a screen reader needs to know which of
          these are outstanding, and the tick is `aria-hidden`. */}
      <span className="text-[14px] text-ink-muted">
        <span className="sr-only">{done ? 'Done: ' : 'Still to do: '}</span>
        {text}
      </span>
    </li>
  );
}
