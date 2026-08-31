'use client';

import { useSearchParams } from 'next/navigation';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
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
import { PerformancePanel } from './PerformancePanel';
import { PlanQueue } from './PlanQueue';
import { AgentIdentityCard } from './AgentIdentityCard';
import { QuickActions } from './QuickActions';

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
    <div className="grid grid-cols-1 gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold text-ink">Agent Command Center</h1>
          <p className="mt-1 text-[16px] text-ink-muted">
            Your AI agent is running {genome?.name ?? 'this brand'}&rsquo;s social presence.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setChatOpen(true)}>
            Ask Spark
          </Button>
          <Button onClick={() => setDraftPanel({ open: true })}>New post</Button>
        </div>
      </header>

      {/* ── The shell band (`F1`) ───────────────────────────────────────
          Who the agent is, what it is working toward, and what you came here to
          do. The prototype keeps these three together and persistent, and it is
          the arrangement eighteen draft-panel prototypes render behind their
          drawer — which is why one missing band looked like eighteen gaps.

          Two columns from `xl`: below that the identity and the campaign each
          want the full width for their own wrapping, and stacking them is
          better than two cramped columns. */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <AgentIdentityCard
          genomeId={genome?.genomeId}
          campaign={campaign ? { name: campaign.name, status: campaign.status } : null}
          paused={Boolean(status?.paused)}
        />
        <CampaignFocusCard
          campaign={campaign}
          calendarView={calendarView}
          genomeName={genome?.name}
          genomeId={genome?.genomeId}
          onRefresh={() => void loadCampaign()}
        />
      </div>

      <QuickActions onOpenChat={() => setChatOpen(true)} />

      <AgentControlBar status={status} onChange={setStatus} />
      <ApprovalModeControl />

      {review && review.length > 0 ? (
        <NeedsAttentionBanner count={review.length} />
      ) : null}

      <PendingQuestionsPanel />
      {/*
        Directly below the questions, because the two are one thought: what SPARK
        needs from you, then what it wants you to know. Until this landed the
        second half was written to a table nothing read.
      */}
      <NotificationsPanel />

      {error ? <p className="text-[13px] text-destructive">{error}</p> : null}

      {/* §7.5's four queues, in the order a person needs them: what happens
          next, then what is blocked on them. `PlanQueue` links to the second by
          anchor, which is why the wrapper carries an id. */}
      <PlanQueue
        genomeId={genome?.genomeId}
        onOpen={(contentItemId) => setDraftPanel({ open: true, contentItemId })}
      />

      <div id="review">
        <ReviewQueueList items={review} onDecide={decide} />
      </div>

      {/* Below the queue, above the drafts: what needs a person comes first,
          then how the brand is doing, then the material itself. */}
      <div id="performance">
        <PerformancePanel genomeId={genome?.genomeId} />
      </div>

      <div id="drafts">
        <DraftList
        genomeId={genome?.genomeId}
        refreshKey={draftListRefresh}
        onOpen={(contentItemId) => setDraftPanel({ open: true, contentItemId })}
        />
      </div>

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
