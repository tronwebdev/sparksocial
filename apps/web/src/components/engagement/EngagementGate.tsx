'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { WhyPopover, type Explanation } from '@/components/explain/WhyPopover';

/**
 * `ENG-01` — the eligibility gate, and PRD §8.8's three states.
 *
 *   *"Eligibility gating: ineligible (campaign still learning); eligible but
 *   inactive (configure now); active state with tabs."*
 *
 * ── Why the feed alone was not enough ─────────────────────────────────────
 *
 * `engage.eligibility.check` has been registered, tested and callable since P4,
 * and no component ever called it — so none of these three states existed on a
 * screen. A brand still inside its learning period opened Engagement
 * Intelligence and saw the four tabs with "Nothing here yet" under each, which
 * is indistinguishable from a brand nobody has ever messaged. Two very
 * different situations, one blank page, and the actionable one ("configure it")
 * had nowhere to be actioned from.
 *
 * The gate reads badly as a hard block, so it is not one: the feed renders
 * underneath in every state. What changes is whether the reason is stated. An
 * ineligible brand is told what it is waiting for and how far along it is,
 * because "SPARK is still learning your voice" is the honest answer and it is a
 * far better answer than silence.
 */

interface Eligibility {
  eligible: boolean;
  daysSinceStart: number;
  publishedCount: number;
  reason: string;
  why?: Explanation;
}

interface Campaign {
  campaignId: string;
  status: string;
}

type GateState =
  | { kind: 'loading' }
  /** No campaign at all — the gate cannot be evaluated, and the fix is upstream. */
  | { kind: 'no_campaign' }
  | { kind: 'ineligible'; eligibility: Eligibility }
  /** Cleared the learning period, but nobody has set the autonomy rules yet. */
  | { kind: 'unconfigured'; eligibility: Eligibility }
  | { kind: 'active'; eligibility: Eligibility };

export function EngagementGate({
  children,
  showLearningNotice = true,
}: {
  children: React.ReactNode;
  /**
   * The "SPARK is still learning your voice" card.
   *
   * Off on the Command Center's Engagement Intelligence tab, at the design's
   * request: that tab already leads with the agent's own status band, and a
   * second card explaining that auto-reply is not on yet reads as a warning
   * about the tab rather than a fact about the brand. It stays on `/engagement`,
   * the standalone inbox, where it is the only thing that explains why nothing
   * is replying — and `state.kind === 'ineligible'` still gates auto-reply
   * either way. Suppressing the notice does not enable anything.
   */
  showLearningNotice?: boolean;
}) {
  const { genome, loading } = useSelectedGenome();
  const genomeId = genome?.genomeId;
  const [state, setState] = useState<GateState>({ kind: 'loading' });

  useEffect(() => {
    if (!genomeId) return;
    let cancelled = false;

    void (async () => {
      const campaigns = await invoke<{ campaigns: Campaign[] }>('campaign.list', { genomeId, limit: 5 });
      if (cancelled) return;
      const active =
        campaigns.status === 'succeeded'
          ? (campaigns.output.campaigns.find((c) => c.status === 'active') ?? campaigns.output.campaigns[0])
          : undefined;

      if (!active) {
        setState({ kind: 'no_campaign' });
        return;
      }

      const [eligibility, policy] = await Promise.all([
        invoke<Eligibility>('engage.eligibility.check', { genomeId, campaignId: active.campaignId }),
        // "Configured" means somebody has made a deliberate choice about the
        // `engage` family's autonomy. `policy.ts` rule 6 reads exactly this, so
        // the screen and the policy engine agree on what configured means
        // rather than each having its own idea.
        invoke<{ familyOverrides: Record<string, string> | null }>('approval.policy.get', {}),
      ]);
      if (cancelled) return;

      if (eligibility.status !== 'succeeded') {
        // A failed check must not hide the inbox. Fall through to the feed and
        // say nothing — a broken gate is not a reason to withhold messages
        // somebody may need to answer.
        setState({ kind: 'active', eligibility: { eligible: true, daysSinceStart: 0, publishedCount: 0, reason: '' } });
        return;
      }

      if (!eligibility.output.eligible) {
        setState({ kind: 'ineligible', eligibility: eligibility.output });
        return;
      }

      const configured =
        policy.status === 'succeeded' && Boolean(policy.output.familyOverrides?.['engage']);
      setState({ kind: configured ? 'active' : 'unconfigured', eligibility: eligibility.output });
    })();

    return () => {
      cancelled = true;
    };
  }, [genomeId]);

  if (loading || state.kind === 'loading') {
    return (
      <div className="grid grid-cols-1 gap-4">
        <Skeleton className="h-28 w-full rounded-xl" />
        {children}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      {/*
        The "Engagement starts with a campaign" card used to be here.

        It was a full card explaining that the inbox needs a campaign, sitting
        above a feed whose own empty state now says the same thing *with the
        button that fixes it*. Two explanations of one blocker, and the outer one
        was the version without the action. Removed at the design's request:
        `no_campaign` falls through to the feed, which is the state it was
        describing.

        The other two states stay. "Still learning your voice" and "eligible but
        not configured" are §8.8's own three states, and each is the honest
        answer to a different question about why the tabs look quiet — neither
        is a blank-page substitute.
      */}

      {state.kind === 'ineligible' && showLearningNotice ? (
        <section className="rounded-xl border border-border bg-surface-muted p-6">
          <h2 className="text-[18px] font-semibold text-ink">SPARK is still learning your voice</h2>
          <p className="mt-1 max-w-prose text-[14px] text-ink-muted">{state.eligibility.reason}</p>

          {/* Concrete progress, not a spinner. "Still learning" with no numbers
              reads as broken; with numbers it reads as a process. */}
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
            <div>
              <dt className="text-[12px] uppercase tracking-wide text-ink-muted">Days running</dt>
              <dd className="text-[20px] font-medium tabular-nums text-ink">
                {state.eligibility.daysSinceStart}
                <span className="text-[14px] text-ink-muted"> / 14</span>
              </dd>
            </div>
            <div>
              <dt className="text-[12px] uppercase tracking-wide text-ink-muted">Posts published</dt>
              <dd className="text-[20px] font-medium tabular-nums text-ink">
                {state.eligibility.publishedCount}
                <span className="text-[14px] text-ink-muted"> / 5</span>
              </dd>
            </div>
          </dl>

          <p className="mt-3 text-[13px] text-ink-muted">
            Messages still arrive below and you can answer them yourself. SPARK will not reply on its own
            until both of these are met.
          </p>
          <WhyPopover why={state.eligibility.why} />
        </section>
      ) : null}

      {state.kind === 'unconfigured' ? (
        <section className="rounded-xl border border-primary/40 bg-surface p-6">
          <h2 className="text-[18px] font-semibold text-ink">Ready — decide how much SPARK may do</h2>
          <p className="mt-1 max-w-prose text-[14px] text-ink-muted">
            {state.eligibility.reason} Until you choose, every reply SPARK drafts waits for your approval.
          </p>
          <Button asChild className="mt-4">
            <Link href="/settings">Configure engagement</Link>
          </Button>
          <WhyPopover why={state.eligibility.why} />
        </section>
      ) : null}

      {children}
    </div>
  );
}
