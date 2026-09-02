'use client';

import { useSearchParams } from 'next/navigation';

import { useCallback, useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { AgentControlBar, type AgentStatusView } from './AgentControlBar';
import { ApprovalModeControl } from './ApprovalModeControl';
import { NeedsAttentionBanner } from './NeedsAttentionBanner';
import { PendingQuestionsPanel } from './PendingQuestionsPanel';
import { NotificationsPanel } from './NotificationsPanel';
import { CampaignFocusCard, type CampaignSummary, type CalendarView } from './CampaignFocusCard';
import { ReviewQueueList, type ReviewItem } from './ReviewQueueList';
import { ChatDrawer } from './ChatDrawer';
import { DraftPanel } from './draft-panel/DraftPanel';
import { DraftList } from './DraftList';
import { PlanQueue } from './PlanQueue';

/**
 * CC-01 — Command Center Overview (`ui build/SparkSocial Command Center.dc.html`,
 * `data-screen-label="CC Overview"`; PRD §CC-01: "identity bar, focus, upcoming
 * actions, performance, controls, engagement feed entry, calendar entry").
 *
 * Traded prototype pixel-fidelity for real data, the same call `CalendarBoard`
 * and `RunTimeline` already made: this renders from the actual tool registry
 * (`agent.status`, `campaign.list`, `calendar.get`, `queue.review.list`,
 * `approval.decide`) rather than the mockup's placeholder rows.
 *
 * The performance tile is here now (`PerformancePanel`, CC-04). This comment
 * used to say it was *"left out rather than faked"* because nothing real backed
 * it until P4 — correct when written, and `analytics.success_metrics` is that
 * real backing. The engagement feed entry is still the one §CC-01 item absent
 * here, and deliberately: it has its own screen at `/engagement`, and a
 * second copy of a live feed is a second thing that can be wrong.
 *
 * "Upcoming actions" is two lists, not one, because they answer different
 * questions: the review queue is *blocked on a person*; the plan queue is
 * *already scheduled*. Merging them into one row style was the prototype's
 * choice for a mockup with fixed placeholder rows — a real queue needs the
 * distinction visible, because the action is different (approve vs. nothing).
 *
 * With `PlanQueue`, all four of §7.5's first-class queues are reachable: Plan
 * and Review here, Automation on `/automation`, Engagement on
 * `/engagement`. The plan used to count as covered because the *calendar*
 * existed — but a calendar answers "what does the month look like" and a queue
 * answers "what happens next", and only the second one tells you that tomorrow
 * morning is about to go out unwritten.
 */

export function CommandCenterOverview() {
  const { genome, loading: genomeLoading, error: genomeError } = useSelectedGenome();

  const [status, setStatus] = useState<AgentStatusView | null>(null);
  const [review, setReview] = useState<ReviewItem[] | null>(null);
  const [campaign, setCampaign] = useState<CampaignSummary | null | undefined>(undefined); // undefined = not checked yet, null = none exists
  const [calendarView, setCalendarView] = useState<CalendarView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  /**
   * `?draft=<id>` opens the panel on load.
   *
   * Added for the shell's Ask Spark (`F2`), which can produce a draft from a
   * screen that has no draft panel of its own and so navigates here. Useful
   * beyond that button: a draft is now addressable, so a notification or a bug
   * report can link to one.
   */
  const initialDraft = useSearchParams().get('draft') ?? undefined;
  const [draftPanel, setDraftPanel] = useState<{ open: boolean; contentItemId?: string }>(
    initialDraft ? { open: true, contentItemId: initialDraft } : { open: false },
  );
  const [draftListRefresh, setDraftListRefresh] = useState(0);

  const loadStatus = useCallback(async () => {
    const res = await invoke<AgentStatusView>('agent.status', {});
    if (res.status === 'succeeded') setStatus(res.output);
  }, []);

  const loadReview = useCallback(async () => {
    const res = await invoke<{ items: ReviewItem[] }>('queue.review.list', { limit: 25 });
    if (res.status === 'succeeded') setReview(res.output.items);
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadReview();
  }, [loadStatus, loadReview]);

  const loadCampaign = useCallback(async () => {
    if (!genome) return;
    const res = await invoke<{ campaigns: CampaignSummary[] }>('campaign.list', {
      genomeId: genome.genomeId,
      limit: 1,
    });
    if (res.status !== 'succeeded' || res.output.campaigns.length === 0) {
      setCampaign(null);
      return;
    }
    const active = res.output.campaigns[0]!;
    setCampaign(active);

    const cal = await invoke<CalendarView>('calendar.get', { campaignId: active.campaignId });
    if (cal.status === 'succeeded') setCalendarView(cal.output);
  }, [genome]);

  useEffect(() => {
    void loadCampaign();
  }, [loadCampaign]);

  const decide = useCallback(
    async (callId: string, decision: 'approve' | 'reject') => {
      // idempotent: false — approving replays the original held call, so a
      // retried click must not decide it twice. Deterministic on
      // callId+decision (unlike a fresh-take tool) so an accidental double
      // click or a network retry of the same decision dedupes correctly.
      const res = await invoke('approval.decide', { callId, decision }, `approval-decide:${callId}:${decision}`);
      if (res.status !== 'succeeded') {
        setError(res.status === 'failed' ? res.error.message : 'That decision was gated.');
        return;
      }
      setError(null);
      await loadReview();
    },
    [loadReview],
  );

  if (genomeLoading) {
    return (
      <div className="grid grid-cols-1 gap-6">
        <Skeleton className="h-24 w-full rounded" />
        <Skeleton className="h-64 w-full rounded" />
      </div>
    );
  }

  if (genomeError) {
    return (
      <div className="rounded border border-border bg-surface p-6">
        <p className="text-[14px] text-ink-muted">{genomeError}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/*
        The design's header row: the title at 28px/600 on the left and the
        Needs Attention banner on the right of the *same* row — 53,143 against
        831,147 on the stage. The banner used to sit in the body, five panels
        down, which is a strange place for the one thing that says something is
        waiting on you.

        The two buttons that were here are gone. Ask Spark is in the chrome now,
        where the design has it, so a second copy 60px below the first was
        pointing at the same drawer. "New post" was mine; the design starts a
        post from the Queue card's rows and the campaign hero, both of which are
        on this screen.
      */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold leading-[1.27] text-ink">Agent Command Center</h1>
          <p className="mt-[9px] text-16 text-ink-muted">
            Your Ai Agent is running {genome?.name ?? 'this brand'}&rsquo;s social presence for this brand
          </p>
        </div>

        {review && review.length > 0 ? (
          <div className="w-full max-w-[849px] shrink-0 xl:w-[849px]">
            <NeedsAttentionBanner count={review.length} />
          </div>
        ) : null}
      </header>

      <CampaignFocusCard
        campaign={campaign}
        calendarView={calendarView}
        genomeName={genome?.name}
        genomeId={genome?.genomeId}
        onRefresh={() => void loadCampaign()}
      />

      {/*
        These two stay, and I nearly cut them.

        The design's hero carries "Edit Campaign" and "Adjust Frequency", and
        `CampaignFocusCard`'s own docstring says it resolves those to a calendar
        link "plus the frequency control this page already has" - meaning
        `AgentControlBar`. Removing it would have taken `agent.frequency.set`
        off the screen with nothing replacing it. `ApprovalModeControl` owns
        `agent.approval_mode.get/set`, which is the only route to autonomy
        anywhere in the app.

        Neither has a home in the design's Overview, so they sit under the chips
        until the hero grows the two buttons that would absorb them. A control
        in a slightly wrong place beats a capability that silently disappeared.
      */}
      <AgentControlBar status={status} onChange={setStatus} />
      <ApprovalModeControl />

      {error ? <p className="text-14 text-destructive">{error}</p> : null}

      {/*
        The Queue card — "What is your Agent doing next?".
      */}
      <PlanQueue
        genomeId={genome?.genomeId}
        onOpen={(contentItemId) => setDraftPanel({ open: true, contentItemId })}
      />

      {/*
        Below the queue: what needs a person, then the material itself.

        Three panels that used to be here are not any more, because the Command
        Center now has the tabs the design gives it. `PerformancePanel` is the
        Performance & Learning tab and was rendering here as well - the same
        component twice on one screen, one of them behind a tab that already
        shows it. `AgentIdentityCard` is gone from this screen entirely: the
        design's identity band is the *dashboard's* banner, and the Overview
        opens on the campaign. Engagement's panels live on their own tab.
      */}
      <div id="review">
        <ReviewQueueList items={review} onDecide={decide} />
      </div>

      <PendingQuestionsPanel />
      {/*
        Directly below the questions, because the two are one thought: what SPARK
        needs from you, then what it wants you to know.
      */}
      <NotificationsPanel />

      <div id="drafts">
        <DraftList
          genomeId={genome?.genomeId}
          refreshKey={draftListRefresh}
          onOpen={(contentItemId) => setDraftPanel({ open: true, contentItemId })}
        />
      </div>

      {/*
        Still this screen's drawer, and still the reason `AskSpark` defers on
        `/agents` — but it is opened from the chrome now, via `onAskSparkOpen`,
        rather than by a button in the header beside it.
      */}
      <ChatDrawer
        genomeId={genome?.genomeId}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        onOpenDraft={(contentItemId) => setDraftPanel({ open: true, contentItemId })}
      />

      <DraftPanel
        genomeId={genome?.genomeId}
        contentItemId={draftPanel.contentItemId}
        open={draftPanel.open}
        onClose={() => {
          setDraftPanel({ open: false });
          setDraftListRefresh((n) => n + 1);
        }}
      />
    </div>
  );
}
