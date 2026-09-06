'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CommandCenterShell, type CcTab } from '@/components/command-center/CommandCenterShell';
import { CommandCenterOverview } from '@/components/command-center/CommandCenterOverview';
import { SparkRailContainer } from '@/components/command-center/SparkRailContainer';
import { PerformancePanel } from '@/components/command-center/PerformancePanel';
import {
  PerformanceGate,
  PerformanceGateModal,
  usePerformanceEligibility,
} from '@/components/command-center/PerformanceGate';
import { PerformanceHeader } from '@/components/command-center/PerformanceHeader';
import { DraftPanel } from '@/components/command-center/draft-panel/DraftPanel';
import { AgentCalendarTab } from '@/components/command-center/AgentCalendarTab';
import { NeedsAttentionScreen } from '@/components/command-center/NeedsAttentionScreen';
import { NeedsAttentionBanner } from '@/components/command-center/NeedsAttentionBanner';
import { EngagementFeed } from '@/components/engagement/EngagementFeed';
import { EngagementGate } from '@/components/engagement/EngagementGate';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { useCcAgent } from '@/components/command-center/useCcAgent';

/**
 * The Agent Command Center — `SparkSocial Command Center.dc.html`.
 *
 * Four tabs on one screen: Overview, Agent Calendar, Performance & Learning,
 * Engagement Intelligence. The prototype switches them with local state, and so
 * does this: they share the Spark rail and the draft panel, and routing between
 * them would tear both down and rebuild them on every switch.
 *
 * The URL still carries the tab as `?tab=`, so a link to
 * `/agents?tab=engagement` works — `replace` rather than `push`, because four
 * tabs on one screen should not fill the back button with a tab history.
 *
 * ── The Calendar and Engagement tabs are the real screens ─────────────────
 *
 * Both also exist as sidebar destinations, which is the design's own IA — the
 * dashboard's nav lists Calendar and Engagement Intelligence, and the Command
 * Center lists them again as tabs. So these render `CalendarBoard` and
 * `EngagementFeed` directly rather than getting Command-Center-shaped
 * reimplementations: one component per screen, reached from two places. The
 * alternative is two calendars that drift.
 *
 * `?draft=` is read by `CommandCenterOverview`, which is why Ask Spark's draft
 * handoff points here; it forces the Overview tab, since that is where the
 * draft panel lives.
 */

const TABS: readonly CcTab[] = ['overview', 'calendar', 'performance', 'engagement'];

function isTab(v: string | null): v is CcTab {
  return v !== null && (TABS as readonly string[]).includes(v);
}

/**
 * The Suspense boundary `next build` requires.
 *
 * `useSearchParams()` opts a page out of static prerendering unless something
 * above it can suspend; without a boundary the export fails with
 * *"useSearchParams() should be wrapped in a suspense boundary"* and the build
 * exits non-zero. `/forgot-password` hit this first and carries the longer note
 * on why a boundary is right here and the `window.location`-in-an-effect trick
 * (`selectedPlan.ts`) is not: `?tab=` picks which tab renders **first**, so
 * reading it one render late would paint Overview and then jump to whichever
 * tab was actually asked for.
 *
 * The fallback is the shell with the default tab, so the chrome does not move
 * when the boundary resolves.
 */
export default function CommandCenterPage() {
  return (
    <Suspense
      fallback={
        <CommandCenterShell tab="overview" onTab={() => {}}>
          <div className="min-h-[40vh]" />
        </CommandCenterShell>
      }
    >
      <CommandCenter />
    </Suspense>
  );
}

function CommandCenter() {
  const router = useRouter();
  const params = useSearchParams();
  const { genome } = useSelectedGenome();
  /*
    The Agent Calendar tab inlines the identity the Spark rail carries
    everywhere else — it is the one tab with no rail. Same hook, so the two
    cannot disagree about the agent's name or whether it is paused.
  */
  const agent = useCcAgent(genome?.genomeId);

  /**
   * Performance & Learning eligibility, read here rather than inside the tab.
   *
   * The gate used to wrap the tab's own body: clicking the tab switched to it,
   * and only then did the card appear over a blurred panel. Being told you
   * cannot go somewhere after you have been taken there is the wrong order — so
   * `onTab` checks this first and opens the card without moving.
   */
  const perfEligibility = usePerformanceEligibility(genome?.genomeId);
  const [perfGate, setPerfGate] = useState(false);

  const fromUrl = params.get('tab');
  /**
   * `?attention=1` — the Needs Attention screen.
   *
   * A **view**, not a fifth tab, because the design's nav pill has four and the
   * screenshot shows this state under the same four. The amber banner's
   * "Review" link used to be `href="#review-queue"`, an anchor to a queue that
   * has since moved off the Overview — so it scrolled to nothing. It opens this
   * now, and closing it returns to whichever tab you were on.
   */
  const attention = params.get('attention') === '1';
  const hasDraft = params.get('draft') !== null;
  /* The reporting window. Its control sits in the shell's full-width band and
     the body that reads it sits in the 1159 column, so neither can own it. */
  const [perfWindow, setPerfWindow] = useState(30);
  /*
    The draft panel, at page level so every tab can open it.

    It lived inside `CommandCenterOverview`, so it only existed while that tab
    was mounted — which is why the Agent Calendar's "view draft" navigated to
    `?tab=overview&draft=...` first and threw you onto another tab before the
    panel opened. Seeded from `?draft=` so a link to one still works.
  */
  const [draft, setDraft] = useState<{ open: boolean; contentItemId?: string }>(() => {
    const id = params.get('draft');
    return id ? { open: true, contentItemId: id } : { open: false };
  });
  const [tab, setTab] = useState<CcTab>(hasDraft ? 'overview' : isTab(fromUrl) ? fromUrl : 'overview');

  /*
    A `?draft=` that arrives while mounted should open the panel.

    `AskSpark` on another screen produces a draft and links here with
    `?draft=<id>`; the page seeds its state from that on mount, but a link
    followed while already on `/agents` only changes the query. Without this the
    URL said a draft was open and nothing was.
  */
  const draftParam = params.get('draft');
  useEffect(() => {
    if (draftParam) setDraft({ open: true, contentItemId: draftParam });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftParam]);

  /* A link that changes `?tab=` while mounted should move the tab with it. */
  useEffect(() => {
    if (isTab(fromUrl) && fromUrl !== tab) setTab(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromUrl]);

  const onTab = useCallback(
    (next: CcTab) => {
      /*
        Refused, not deferred: the tab stays where it is and the card explains
        why. `loading` and `unknown` both fall through — a slow or refused
        eligibility read must not lock a tab that might be open to this brand.
      */
      if (next === 'performance' && perfEligibility.kind === 'blocked') {
        setPerfGate(true);
        return;
      }
      setTab(next);
      const q = new URLSearchParams(Array.from(params.entries()));
      q.set('tab', next);
      /*
        `draft` is an Overview-only parameter. Leaving it on the URL while the
        user moves to another tab means a later refresh silently yanks them back
        to Overview with a panel open.
      */
      if (next !== 'overview') q.delete('draft');
      router.replace(`/agents?${q.toString()}`, { scroll: false });
    },
    [params, router, perfEligibility.kind],
  );

  /*
    The band the shell renders across the whole card, above the two columns.

    It lives here rather than in `CommandCenterOverview` because the design puts
    the Needs Attention strip at 831..1680 — past the content column's right edge
    — and because the title is per-tab. Only Overview passes it for now; the
    other three tabs still carry their own headings, and they get the same
    treatment as I work through them.

    `agent.reviewCount` is already loaded for the Calendar tab, so the strip
    costs no extra request.
  */
  const band =
    tab === 'performance' ? (
      <PerformanceHeader windowDays={perfWindow} onWindowDays={setPerfWindow} />
    ) : tab === 'overview' ? (
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold leading-[1.27] text-ink">Agent Command Center</h1>
          {/* `text-16` bakes in `line-height:100%`, so the box measured 16
              where the design's unstyled 16px line is 20.5 — which left the
              two columns starting on 236.5 instead of 241. */}
          <p className="mt-[7px] text-16 font-normal leading-[1.28] text-ink-muted">
            Your Ai Agent is running {genome?.name ?? 'this brand'}&rsquo;s social presence for this brand
          </p>
        </div>

        {/* 849 wide at the band's right edge, 4px below the title's top — the
            design's 831,147 against a title at 53,143. */}
        {agent.reviewCount > 0 ? (
          <div className="mt-[4px] w-full shrink-0 xl:w-[849px]">
            {/* Keeps the tab you were on, so "Back to …" returns there. */}
            <NeedsAttentionBanner count={agent.reviewCount} href={`?tab=${tab}&attention=1`} />
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <CommandCenterShell tab={tab} onTab={onTab} band={band} rail={<SparkRailContainer />}>
      {attention ? (
        <div className="flex flex-col gap-6">
          <button
            type="button"
            onClick={() => {
              const q = new URLSearchParams(params.toString());
              q.delete('attention');
              router.replace(`/agents?${q.toString()}`, { scroll: false });
            }}
            className="flex w-fit items-center gap-[10px] text-16 font-semibold text-ink"
          >
            <svg width="8" height="15" viewBox="0 0 8 16" fill="none" aria-hidden>
              <path d="M7 1 1 8l6 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to {tab === 'overview' ? 'Overview' : tab === 'calendar' ? 'Agent Calendar' : tab === 'performance' ? 'Performance & Learning' : 'Engagement Intelligence'}
          </button>
          <NeedsAttentionScreen onOpenDraft={(id) => setDraft({ open: true, contentItemId: id })} />
        </div>
      ) : null}

      {!attention && tab === 'overview' ? (
        <div className="flex flex-col gap-10">
          <CommandCenterOverview onOpenDraft={(id) => setDraft({ open: true, contentItemId: id })} />

        </div>
      ) : null}

      {!attention && tab === 'calendar' ? (
        <AgentCalendarTab
          genomeId={genome?.genomeId}
          paused={agent.paused}
          agentName={agent.name}
          voice={agent.voice}
          riskTolerance={agent.riskTolerance}
          reviewCount={agent.reviewCount}
          onTogglePause={() => void agent.togglePause()}
          onOpenDraft={(contentItemId) => setDraft({ open: true, contentItemId })}
          busy={agent.busy}
        />
      ) : null}

      {/* Opened by the tab strip, over whichever tab the person is on. */}
      {perfGate ? (
        <PerformanceGateModal state={perfEligibility} onClose={() => setPerfGate(false)} />
      ) : null}

      {!attention && tab === 'performance' ? (
        /* The tab is gated on the learning engine having enough measured
           outcomes to say anything — see `PerformanceGate`. */
        <PerformanceGate genomeId={genome?.genomeId}>
          <PerformancePanel genomeId={genome?.genomeId} windowDays={perfWindow} />
        </PerformanceGate>
      ) : null}

      {/* No "still learning your voice" card on this tab — see `EngagementGate`. */}
      {!attention && tab === 'engagement' ? (
        <EngagementGate showLearningNotice={false}>
          <EngagementFeed />
        </EngagementGate>
      ) : null}

      {/* One panel, for whichever tab asked. */}
      <DraftPanel
        genomeId={genome?.genomeId}
        contentItemId={draft.contentItemId}
        open={draft.open}
        onClose={() => setDraft({ open: false })}
      />
    </CommandCenterShell>
  );
}
