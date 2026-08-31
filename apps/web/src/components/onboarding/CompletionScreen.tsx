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
    <div className="flex min-h-screen flex-col bg-background px-6 py-8 md:px-16">
      <header>
        <Wordmark />
      </header>

      <main className="mx-auto flex w-full max-w-[620px] flex-1 flex-col justify-center py-10 text-center">
        <p className="text-[15px] text-ink-muted">{brandName || 'Your brand'} is set up</p>
        <h1 className="mt-3 text-balance text-[34px] font-semibold leading-tight text-ink">
          {agent ? (
            <>
              Congratulations on creating <span className="text-brand-purple">{agent}</span>, your first
              agent
            </>
          ) : (
            'Congratulations on creating your first agent'
          )}
        </h1>

        {/* What is true, in the order it matters. Each line is a fact read from a
            tool, and the ones that are already done say so rather than being
            hidden — a checklist of only failures reads as a telling-off. */}
        <ul className="mx-auto mt-8 flex w-full max-w-[460px] flex-col gap-2 text-left">
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

        <p className="mt-8 text-[14px] text-ink-muted">
          Next: a campaign. It is one screen, and it is where {agent ?? 'SPARK'} works out what it can make
          from what you have.
        </p>

        <div className="mt-6 flex justify-center">
          <HoldButton label="Continue to your dashboard" caption="Press and hold" onComplete={onDone} />
        </div>
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
