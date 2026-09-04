'use client';


import { useCallback, useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { AgentControlBar, type AgentStatusView } from './AgentControlBar';
import { ApprovalModeControl } from './ApprovalModeControl';
import { CampaignFocusCard, type CampaignSummary, type CalendarView } from './CampaignFocusCard';
import { ReviewQueueList, type ReviewItem } from './ReviewQueueList';
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

export function CommandCenterOverview({
  /*
    Opening a draft is the page's job, not this tab's.

    The `DraftPanel` used to live here, which meant it only existed while the
    Overview was mounted — so the Agent Calendar's own "view draft" had to
    `router.replace('?tab=overview&draft=...')` to reach it, throwing you onto
    another tab before the panel opened. The panel is at page level now and every
    tab just calls this.
  */
  onOpenDraft,
}: {
  onOpenDraft: (contentItemId: string) => void;
}) {
  const { genome, loading: genomeLoading, error: genomeError } = useSelectedGenome();

  const [status, setStatus] = useState<AgentStatusView | null>(null);
  const [review, setReview] = useState<ReviewItem[] | null>(null);
  const [campaign, setCampaign] = useState<CampaignSummary | null | undefined>(undefined); // undefined = not checked yet, null = none exists
  const [calendarView, setCalendarView] = useState<CalendarView | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  /* 19px between panels: the design's hero ends at 538 and its Queue card
     starts at 557. */
  return (
    <div className="flex flex-col gap-[19px]">
      {/*
        The title, subtitle and Needs Attention strip used to be a `header` row
        here, and they cannot live in this component.

        The design puts the strip at 831..1680 — past this column's right edge at
        1206, across the rail's own x range. Inside the column it had 1159px to
        share with a 521px title, so it wrapped onto a second line: the header
        row measured 123.5 instead of the design's 63, and the hero and the whole
        Spark rail sat 50px below the 241 they belong on.

        They are the shell's `band` slot now, which spans the card. See
        `(cc)/agents/page.tsx`, which owns the copy because the title is
        per-tab.
      */}
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

        Neither has a home in the design's Overview — and "under the chips",
        where they were, is the one place they must not be: the design puts the
        Queue card at 557, directly under the hero's 538, and these two pushed it
        to 904. So they are `order-last`.

        That keeps both capabilities on the screen and puts the design's own
        sequence back. `order` rather than moving the JSX because they read the
        same state as everything above them, and the flex column is already the
        thing deciding the order.
      */}
      <div className="order-last flex flex-col gap-6">
        <AgentControlBar status={status} onChange={setStatus} />
        <ApprovalModeControl />
      </div>

      {error ? <p className="text-14 text-destructive">{error}</p> : null}

      {/*
        The Queue card — "What is your Agent doing next?".
      */}
      <PlanQueue
        genomeId={genome?.genomeId}
        onOpen={onOpenDraft}
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





    </div>
  );
}
