'use client';


import { useCallback, useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { CampaignFocusCard, type CampaignSummary, type CalendarView } from './CampaignFocusCard';
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

  const [campaign, setCampaign] = useState<CampaignSummary | null | undefined>(undefined); // undefined = not checked yet, null = none exists
  const [calendarView, setCalendarView] = useState<CalendarView | null>(null);

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
        Three panels that used to sit under the queue are gone from this tab:
        `ReviewQueueList` ("Waiting on you"), `AgentControlBar` and
        `ApprovalModeControl`.

        The design's Overview is the hero and the queue, in that order, and
        nothing else — these pushed the queue from 557 down past 900 and made
        the tab a stack of panels rather than the one thing it is for.

        Neither capability was dropped, because that is the rule:
        `AgentControlBar` (pause/resume, `agent.frequency.set`) and
        `ApprovalModeControl` (`agent.approval_mode.get/set`) moved to
        **Settings → Brand Kit**, beside `GovernancePanel`, which is where every
        other "how autonomous is the agent" control already lives. The review
        queue moved to the **Needs Attention** screen the banner's Review link
        opens — a list of things waiting on a person is exactly that screen's
        subject.
      */}


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






    </div>
  );
}
