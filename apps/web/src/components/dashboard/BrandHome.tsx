'use client';

import { useEffect, useState } from 'react';
import { CampaignWizard } from '@/components/campaign/CampaignWizard';
import { Skeleton } from '@/components/ui/skeleton';
import { AgentBanner } from './AgentBanner';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { AgentActivityFeed } from './AgentActivityFeed';
import { BrandKitChip } from './BrandKitChip';
import { TopBar } from '@/components/shell/TopBar';
import { BrandSwitcher } from '@/components/shell/BrandSwitcher';
import { CockpitTabs } from './CockpitTabs';
import { KpiRow } from './KpiRow';
import { RightRail } from './RightRail';
import type { AgentRun, BrandKit, BrandSeries, Lead, RankedTrend, UpcomingPost } from './types';

/**
 * `/home` AS THE COCKPIT — `DASH-B-01` (PRD §8.3), F7, M1, M2.
 *
 * ── What this replaced, and why the count tiles were not enough ────────────
 *
 * Four tiles reading "12 scheduled · 3 need a reply · 2 recipes · Discovery →",
 * plus a next-best-action card. That was the right answer to §8.3's *first*
 * sentence — "drive next best action" — and it stopped there. The decision of 22
 * August was that Home is a cockpit rather than a launcher, which means the page
 * has to be worth staying on: what the agent has been doing, how the last week
 * went, what is about to go out, who is waiting on a person, and what is
 * happening outside the brand that might be worth joining.
 *
 * A count tile cannot answer any of those. It can only tell you a number and
 * point at the screen that would.
 *
 * ── Assembly, with two exceptions ─────────────────────────────────────────
 *
 * Everything here reads existing tools — `agent.run.list`, `content.list`,
 * `trend.rank`, `campaign.list`, `agent.status`, `brand.governance.get`. Two
 * panels needed new reads, and in both cases the *data* existed while the read
 * did not:
 *
 *   - `engage.opportunity.list`. The `opportunities` table shipped with a writer
 *     and no list reader, so the Sales Opportunities tab in the inbox was showing
 *     *messages the classifier put in the category* — a different and larger set
 *     than the leads anybody had actually raised.
 *   - `analytics.brand_series`. `content_metrics` holds a current value per post
 *     per platform, not a history, so the prototype's seven-day impressions line
 *     could not be drawn from it at all. That tool's header argues out what can
 *     be drawn honestly instead, and this page renders exactly that and says so.
 *
 * ── One request per panel, all in parallel, and failures are local ─────────
 *
 * Eight reads, one round. Each panel absorbs its own failure into an empty state
 * rather than failing the page: a cockpit that refuses to render because the
 * trend source is down is worse than one that says "nothing worth joining" while
 * Discovery shows the error. That was the old `BrandHome`'s rule and it survives.
 */

interface Campaign {
  campaignId: string;
  name: string;
  status: string;
}

interface Snapshot {
  campaign: Campaign | null;
  paused: boolean;
  needsReview: number;
  brandKit: BrandKit | null;
  runs: AgentRun[];
  series: BrandSeries | null;
  leads: Lead[];
  leadCounts: { hot: number; warm: number; cold: number };
  upcoming: UpcomingPost[];
  /** The rail's other half. Null while loading, as `trends` is. */
  published: UpcomingPost[] | null;
  trends: RankedTrend[] | null;
}

/** Enough rows to be a feed and not a screen. The full lists have their own routes. */
const FEED_LIMIT = 8;

export function BrandHome() {
  const { genome, loading } = useSelectedGenome();
  const genomeId = genome?.genomeId;
  const [snap, setSnap] = useState<Snapshot | null>(null);
  /*
    Pausing the agent from the banner changes `agent.status`, which this page
    already reads - so rather than lifting the whole loader out of the effect
    and memoising it, the banner bumps this and the effect re-runs. One number
    against a `useCallback` whose dependency list would have to be kept in step
    with nine tool calls.
  */
  const [reloads, setReloads] = useState(0);

  /**
   * The Create Campaign flow, hosted here.
   *
   * It used to live on the calendar, reached as `/calendar?new=1` — so pressing
   * Create Campaign on this screen left it, and the wizard opened over a screen
   * the person had not asked for. `SparkSocial Create Campaign.dc.html` draws
   * its backdrop as *this* screen: the sidebar, the Create Campaign button, Ask
   * Spark, the Agent Activity feed. The modal belongs over the screen it is
   * launched from, and this is that screen.
   *
   * `?new=1` still works, so every existing link into the flow — the empty
   * cards, the calendar's own prompt — lands here rather than on the calendar.
   * Read once into state rather than off the URL each render, so cancelling
   * does not get undone by a parameter still sitting in the address bar.
   */
  const [creating, setCreating] = useState(false);

  /*
    Read in an effect rather than through `useSearchParams`, which would make
    `/home` — a server component today — need a Suspense boundary purely to
    read one optional flag. One frame without the modal is the whole cost.
  */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1') setCreating(true);
  }, []);
  /** Remount counter, so Cancel then Create Campaign restarts at step one. */
  const [wizardRun, setWizardRun] = useState(0);

  useEffect(() => {
    if (!genomeId) return;
    let cancelled = false;

    void (async () => {
      setSnap(null);

      const [campaigns, agent, gov, runs, series, leads, upcoming, review, published] = await Promise.all([
        invoke<{ campaigns: Campaign[] }>('campaign.list', { genomeId, limit: 5 }),
        invoke<{ paused: boolean }>('agent.status', {}),
        invoke<{ brandKit?: BrandKit }>('brand.governance.get', {}),
        invoke<{ runs: AgentRun[] }>('agent.run.list', { limit: FEED_LIMIT }),
        invoke<BrandSeries>('analytics.brand_series', { genomeId, windowDays: 7 }),
        invoke<{ items: Lead[]; counts: { hot: number; warm: number; cold: number } }>(
          'engage.opportunity.list',
          { genomeId, limit: 5 },
        ),
        invoke<{ items: UpcomingPost[] }>('content.list', { genomeId, status: 'scheduled', limit: FEED_LIMIT }),
        invoke<{ items: unknown[] }>('content.list', { genomeId, status: 'needs_review', limit: 100 }),
        // The rail's "Post published" half. Cheap, local, and unlike
        // `trend.rank` it does not reach off the machine.
        invoke<{ items: UpcomingPost[] }>('content.list', { genomeId, status: 'published', limit: 10 }),
      ]);
      if (cancelled) return;

      setSnap({
        campaign:
          campaigns.status === 'succeeded'
            ? (campaigns.output.campaigns.find((c) => c.status === 'active') ??
              campaigns.output.campaigns[0] ??
              null)
            : null,
        paused: agent.status === 'succeeded' ? agent.output.paused : false,
        needsReview: review.status === 'succeeded' ? review.output.items.length : 0,
        brandKit: gov.status === 'succeeded' ? (gov.output.brandKit ?? null) : null,
        runs: runs.status === 'succeeded' ? runs.output.runs : [],
        series: series.status === 'succeeded' ? series.output : null,
        leads: leads.status === 'succeeded' ? leads.output.items : [],
        leadCounts:
          leads.status === 'succeeded' ? leads.output.counts : { hot: 0, warm: 0, cold: 0 },
        upcoming: upcoming.status === 'succeeded' ? upcoming.output.items : [],
        published: published.status === 'succeeded' ? published.output.items : [],
        // Null rather than [] on failure, so the rail can show a skeleton for
        // "not loaded" and prose for "nothing worth joining" — two different
        // facts that an empty array would collapse into one. It starts null and
        // is filled by the separate effect below.
        trends: null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [genomeId, reloads]);

  /*
    `trend.rank` is the one call on this page that reaches the open internet -
    Hacker News, Product Hunt, YouTube - and when a source is slow or down it
    takes tens of seconds to give up. It was inside the snapshot's
    `Promise.all`, so a single unreachable trend source held back the agent
    banner, the KPI cards and the activity feed: the whole dashboard sat on
    skeletons waiting for a panel about the world outside the brand.

    Its own effect, writing into the same snapshot field. The rail already
    distinguishes null (not loaded) from an empty array (nothing worth
    joining), so it shows its skeleton until this lands and the rest of the
    page does not wait.
  */
  useEffect(() => {
    if (!genomeId) return;
    let cancelled = false;

    void (async () => {
      const res = await invoke<{ trends: RankedTrend[] }>('trend.rank', { genomeId, limit: 5 });
      if (cancelled) return;
      setSnap((prev) =>
        prev ? { ...prev, trends: res.status === 'succeeded' ? res.output.trends : [] } : prev,
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [genomeId, reloads]);

  if (loading || !snap) {
    return (
      <div className="grid grid-cols-1 gap-6">
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const hasCampaign = Boolean(snap.campaign);

  return (
    <>
      {/*
        The Create Campaign flow — `SparkSocial Create Campaign.dc.html`.

        A fixed overlay over this screen, which is exactly what the design
        draws: its backdrop is this dashboard, blurred. Rendered before the
        header so it reads in source order the way it stacks on screen.
      */}
      {creating && genomeId ? (
        <CampaignWizard
          key={wizardRun}
          genomeId={genomeId}
          onActivated={() => {
            setCreating(false);
            // The banner, the KPI row and the upcoming feed all describe the
            // campaign that was just created, so the screen behind the modal
            // has to be re-read rather than left describing the state before.
            setReloads((n) => n + 1);
          }}
          onCancel={() => {
            setCreating(false);
            // So the next press starts at step one rather than wherever this
            // one was abandoned — a key bump rather than threading a reset
            // through six steps of state.
            setWizardRun((n) => n + 1);
          }}
        />
      ) : null}

      {/*
        One header, and it is the shell's.

        `home/page.tsx` used to render a `TopBar` with the brand switcher while
        this component rendered a second heading with the brand's *name* — the
        same brand, twice, in two type sizes. The prototype has one header row:
        the workspace switcher at 26px/600, the status line at 18px/400 `#838383`
        beneath it, then the brand-kit chip, Create Campaign and Ask Spark on the
        right, over a hairline at y=119.5.

        It lives here rather than on the page because every part of it except the
        switcher is page data — the chip needs the brand kit, the status line
        needs to know whether the agent is paused — and the page is a server
        component that cannot see either.
      */}
      <TopBar
        title={<BrandSwitcher />}
        subtitle={
          /*
            The prototype says "Your Ai Agents are running campaigns", which is
            false in most of the states this screen has to render — no campaign,
            a draft, a paused agent. Same slot, same type, true sentence.
          */
          snap.paused
            ? 'Your agent is paused.'
            : !hasCampaign
              ? 'No campaign yet, so nothing is going out.'
              : snap.campaign!.status === 'draft'
                ? 'A campaign is planned and waiting to be activated.'
                : 'Your Ai Agents are running campaigns'
        }
        actions={
          <>
            {snap.brandKit ? <BrandKitChip kit={snap.brandKit} /> : null}
            {/*
              192x48, radius 12, white with a 1px `rgba(12,12,12,0.35)` ring and
              a 9px gap to its glyph — an outline button, not a filled one.

              Opens the wizard over this screen rather than navigating: the
              design's own backdrop for the Create Campaign modal is this
              dashboard, and sending someone to the calendar to start a campaign
              made the button a navigation rather than an action.
            */}
            {/*
              192x48 at radius 12, white, with an `inset 0 0 0 1px
              rgba(12,12,12,0.35)` ring and a 9px gap. Not the `outline`
              variant: its border is `--ss-border`, which is
              `rgba(131,131,131,0.25)` - a lighter, greyer line than the design's,
              and next to Ask Spark the difference reads as a disabled button.
            */}
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex h-12 w-[192px] shrink-0 items-center justify-center gap-[9px] rounded-md bg-white text-16 font-medium text-ink transition-shadow hover:shadow-card"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.35)' }}
            >
              <PlusGlyph />
              Create Campaign
            </button>
          </>
        }
      />

      {/*
        The prototype's vertical grid, canvas-relative (the canvas card starts
        at 322,18 on the 1728 stage):

          banner        123 .. 300     1323 wide
          KPI row       336 .. 443      846 wide, x 34..880
          activity      474 (label) / 515 .. 876
          upcoming      901 .. 1355
          right rail    336 .. 1355     446 wide, x 911..1357

        The rail's top is 336 - the same y as the KPI cards - and its bottom is
        1355, the same as the upcoming card's. It sits beside the KPI row, not
        below it.
      */}
      {/*
        `p-8` was 32 on all four sides, and three of the four are wrong. The
        canvas card runs 322→1713 and the design's content column starts at 356
        and ends at 1679 — 34 either side, which is also exactly the banner's
        1323 width. Vertically the divider is at 119.5 and the banner top at 141,
        so the top pad is 21.5, not 32; the 10.5px difference was landing on top
        of the header's own 22.5 and moving the whole page down by 33.
      */}
      <div className="flex flex-col gap-dash-band-gap p-6 sm:px-dash-gutter sm:pb-9 sm:pt-dash-band-top">

      {/*
        The agent banner — the dark card the dashboard opens with. This used to
        be `AgentIdentityCard`, shared with the Command Center on the assumption
        both screens open the same way; they do not. See `AgentBanner`.
      */}
      <AgentBanner
        genomeId={genomeId}
        campaign={snap.campaign ? { name: snap.campaign.name, status: snap.campaign.status } : null}
        paused={snap.paused}
        planning={snap.needsReview}
        onChanged={() => setReloads((n) => n + 1)}
      />

      {/*
        Between the banner and the metrics there used to be a full-width card:
        "Nothing is posting yet - <brand> needs a campaign" with a Set up your
        first campaign button, or a "N posts waiting on you" variant when there
        was one. Removed at the design's request, and it had stopped earning its
        place anyway.

        It was written when the cards below it showed nothing but zeroes, so the
        one available action needed saying out loud. Now every one of those cards
        carries `EmptyCard` - "You don't have an active campaign" with the same
        Create Campaign button - so this was the fifth copy of that sentence and
        the only one not attached to the thing it was about.

        The review count it also carried is not lost: `needsReview` still goes to
        `AgentBanner` as `planning`, which says "Planning N posts for the week
        ahead" on the banner directly above.
      */}


      {/* ── The two columns. Activity and the tabbed card carry the page; the
             rail is the one panel about the world outside this brand. ────── */}
      {/*
        846 and 446 with a 31px gutter, straight off the prototype — the left
        column runs 356→1202 and the rail 1233→1679. `2fr / 1fr` at a 24px gap
        was close enough to look deliberate and wrong enough that the rail's
        cards were a different width from the ones they mirror.
      */}
      <div className="grid grid-cols-1 gap-dash-col-gap xl:grid-cols-[minmax(0,846fr)_minmax(0,446fr)]">
        {/*
          25px between the cards, and 6 more under the KPI row to make the 31 the
          prototype has between it and the "Agent Activity" label. Two numbers
          rather than one because they are two different gaps in the design, and
          a single 24 was wrong on both.

          The KPI row is *here* rather than above this grid. Three 270px cards on
          a 288px pitch is 846px — exactly the left column — which is the whole
          reason the rail can start level with them.
        */}
        <div className="flex min-w-0 flex-col gap-dash-card-gap">
          {snap.series ? (
            <div className="mb-[6px]">
              <KpiRow series={snap.series} />
            </div>
          ) : null}
          {/* The upcoming list is already loaded and carries
              contentItemId → summary, which is what lets an activity row name
              the post a goal was about instead of printing its UUID. Free:
              no extra call. */}
          <AgentActivityFeed
            runs={snap.runs}
            /* Scheduled *and* published — both lists are already loaded, and a
               run's goal is at least as likely to name a post that has gone out
               as one still waiting. Anything outside both still reads "a post",
               which is the honest fallback. */
            titles={
              new Map(
                [...snap.upcoming, ...(snap.published ?? [])].map((u) => [u.contentItemId.toLowerCase(), u.summary]),
              )
            }
          />
          <CockpitTabs
            upcoming={snap.upcoming}
            series={snap.series}
            leads={snap.leads}
            leadCounts={snap.leadCounts}
          />
        </div>
        <div className="min-w-0">
          <RightRail trends={snap.trends} published={snap.published} />
        </div>
      </div>
      </div>
    </>
  );
}

/** The 14px cross on Create Campaign. */
function PlusGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
