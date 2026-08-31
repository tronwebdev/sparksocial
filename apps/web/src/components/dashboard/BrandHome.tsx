'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AgentIdentityCard } from '@/components/command-center/AgentIdentityCard';
import { invoke } from '@/lib/tools';
import { openAskSpark } from '@/lib/askSpark';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { AgentActivityFeed } from './AgentActivityFeed';
import { BrandKitChip } from './BrandKitChip';
import { CockpitTabs } from './CockpitTabs';
import { KpiRow } from './KpiRow';
import { TrendingRail } from './TrendingRail';
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
  trends: RankedTrend[] | null;
}

/** Enough rows to be a feed and not a screen. The full lists have their own routes. */
const FEED_LIMIT = 8;

export function BrandHome() {
  const { genome, loading } = useSelectedGenome();
  const genomeId = genome?.genomeId;
  const [snap, setSnap] = useState<Snapshot | null>(null);

  useEffect(() => {
    if (!genomeId) return;
    let cancelled = false;

    void (async () => {
      setSnap(null);

      const [campaigns, agent, gov, runs, series, leads, upcoming, review, trends] = await Promise.all([
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
        invoke<{ trends: RankedTrend[] }>('trend.rank', { genomeId, limit: 5 }),
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
        // Null rather than [] on failure, so the rail can show a skeleton for
        // "not loaded" and prose for "nothing worth joining" — two different
        // facts that an empty array would collapse into one.
        trends: trends.status === 'succeeded' ? trends.output.trends : null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [genomeId]);

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
    <div className="grid grid-cols-1 gap-6">
      {/* ── The header row: what this brand is, and the two primary actions ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold text-ink">{genome?.name ?? 'This brand'}</h1>
          <p className="mt-0.5 text-[13.5px] text-ink-muted">
            {/* The prototype's line is "Your Ai Agents are running campaigns",
                which is false for most of the states this page has to render.
                This says which one it is in. */}
            {snap.paused
              ? 'Your agent is paused.'
              : !hasCampaign
                ? 'No campaign yet, so nothing is going out.'
                : snap.campaign!.status === 'draft'
                  ? 'A campaign is planned and waiting to be activated.'
                  : 'Your agent is running a campaign.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {snap.brandKit ? <BrandKitChip kit={snap.brandKit} /> : null}
          <Button asChild variant="outline">
            {/* `?new=1` — the calendar owns the wizard, and before this the wizard
                was reachable only as that screen's empty state, so a brand with
                one campaign could not start a second one from anywhere. */}
            <Link href="/calendar?new=1">Create campaign</Link>
          </Button>
          <Button onClick={openAskSpark}>Ask Spark</Button>
        </div>
      </div>

      {/* ── The agent, by name. Shared with the Command Center. ───────────── */}
      <AgentIdentityCard
        genomeId={genomeId}
        campaign={snap.campaign ? { name: snap.campaign.name, status: snap.campaign.status } : null}
        paused={snap.paused}
      />

      {/* ── The next best action, when there is one. §8.3's first sentence ──
          survives the cockpit rework: a brand with nothing running has one
          thing to do, and burying it under a dashboard of zeroes would be the
          launcher's failure in reverse. */}
      {!hasCampaign ? (
        <section className="rounded-xl border border-primary/40 bg-surface p-6">
          <h2 className="text-[18px] font-medium text-ink">
            Nothing is posting yet — {genome?.name ?? 'this brand'} needs a campaign
          </h2>
          <p className="mt-1.5 max-w-prose text-[14px] text-ink-muted">
            A campaign is an outcome over a window. Tell SPARK what you want more of and it works out what
            it can make from what you already have, then starts posting to the accounts you choose.
          </p>
          <Button asChild className="mt-4">
            <Link href="/calendar?new=1">Set up your first campaign</Link>
          </Button>
        </section>
      ) : snap.needsReview > 0 ? (
        <section className="rounded-xl border border-warn/40 bg-warn/10 p-4">
          <p className="text-[14px] text-ink">
            <span className="font-medium">
              {snap.needsReview} post{snap.needsReview === 1 ? '' : 's'}
            </span>{' '}
            {snap.needsReview === 1 ? 'is' : 'are'} waiting on you before{' '}
            {snap.needsReview === 1 ? 'it' : 'they'} can go out.
          </p>
          <Button asChild size="sm" variant="outline" className="mt-2">
            <Link href="/calendar">Review them</Link>
          </Button>
        </section>
      ) : null}

      {/* ── How the last week went ───────────────────────────────────────── */}
      {snap.series ? <KpiRow series={snap.series} /> : null}

      {/* ── The two columns. Activity and the tabbed card carry the page; the
             rail is the one panel about the world outside this brand. ────── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <AgentActivityFeed runs={snap.runs} />
          <CockpitTabs
            upcoming={snap.upcoming}
            series={snap.series}
            leads={snap.leads}
            leadCounts={snap.leadCounts}
          />
        </div>
        <div className="min-w-0">
          <TrendingRail trends={snap.trends} />
        </div>
      </div>
    </div>
  );
}
