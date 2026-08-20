'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { cn } from '@/lib/utils';

/**
 * `DASH-B-01` — Brand Home, PRD §8.3.
 *
 *   *"Brand Home: drive next best action and show agent value immediately.
 *   Prominent CTA to create first campaign if not active. Preview widgets:
 *   calendar, discovery, engagement, automation, agent status."*
 *
 * ── Why this did not exist ────────────────────────────────────────────────
 *
 * `/` redirected straight to `/agents`, which is the Command Center — a
 * supervision surface for a brand that is already running. A brand with no
 * campaign landed on a screen full of controls for an agent doing nothing, and
 * §8.3's whole point is the opposite: the *first* thing a new brand should see
 * is the one action that unblocks everything else.
 *
 * ── The widgets are counts, and that is deliberate ────────────────────────
 *
 * Each preview reads the same tool its full screen reads, and shows only what a
 * glance can use: how many, and whether anything needs a person. A dashboard
 * that renders four miniature versions of four real screens is four screens
 * that can each be wrong, and it makes the page slower than the thing it is
 * supposed to be a shortcut to.
 */

interface Campaign {
  campaignId: string;
  name: string;
  status: string;
}

interface AgentStatus {
  paused: boolean;
  postsPerWeek: number;
}

interface Snapshot {
  campaign: Campaign | undefined;
  scheduled: number;
  needsReview: number;
  engagementWaiting: number;
  recipes: number;
  agent: AgentStatus | undefined;
}

export function BrandHome() {
  const { genome, loading } = useSelectedGenome();
  const genomeId = genome?.genomeId;
  const [snap, setSnap] = useState<Snapshot | null>(null);

  useEffect(() => {
    if (!genomeId) return;
    let cancelled = false;

    void (async () => {
      setSnap(null);
      /**
       * One round of parallel reads, all of them existing tools. Failures are
       * absorbed into zeros rather than failing the page: a dashboard that
       * refuses to render because the automation count is unavailable is worse
       * than one that says "0 recipes" while the recipes screen shows the error.
       */
      const [campaigns, scheduled, review, engagement, recipes, agent] = await Promise.all([
        invoke<{ campaigns: Campaign[] }>('campaign.list', { genomeId, limit: 5 }),
        invoke<{ items: unknown[] }>('content.list', { genomeId, status: 'scheduled', limit: 100 }),
        invoke<{ items: unknown[] }>('content.list', { genomeId, status: 'needs_review', limit: 100 }),
        invoke<{ items: unknown[] }>('engage.list', { genomeId, category: 'needs_review', limit: 50 }),
        invoke<{ recipes: unknown[] }>('recipe.list', { genomeId }),
        invoke<AgentStatus>('agent.status', {}),
      ]);
      if (cancelled) return;

      const count = (r: { status: string; output?: { items?: unknown[]; recipes?: unknown[] } }) =>
        r.status === 'succeeded' ? (r.output?.items?.length ?? r.output?.recipes?.length ?? 0) : 0;

      setSnap({
        campaign:
          campaigns.status === 'succeeded'
            ? (campaigns.output.campaigns.find((c) => c.status === 'active') ??
              campaigns.output.campaigns[0])
            : undefined,
        scheduled: count(scheduled),
        needsReview: count(review),
        engagementWaiting: count(engagement),
        recipes: count(recipes),
        agent: agent.status === 'succeeded' ? agent.output : undefined,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [genomeId]);

  if (loading || !snap) {
    return (
      <div className="grid grid-cols-1 gap-6">
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const hasCampaign = Boolean(snap.campaign);

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* ── The next best action. Everything else is secondary to it. ───── */}
      {!hasCampaign ? (
        <section className="rounded-xl border border-primary/40 bg-surface p-6">
          <h2 className="text-[20px] font-medium text-ink">
            Nothing is posting yet — {genome?.name ?? 'this brand'} needs a campaign
          </h2>
          <p className="mt-1.5 max-w-prose text-[14px] text-ink-muted">
            A campaign is an outcome over a window. Tell SPARK what you want more of and it works out what
            it can make from what you already have, then starts posting to the accounts you choose.
          </p>
          <Button asChild className="mt-4">
            <Link href="/calendar">Set up your first campaign</Link>
          </Button>
        </section>
      ) : (
        <section className="rounded-xl border border-border bg-surface p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[20px] font-medium text-ink">{snap.campaign!.name}</h2>
              <p className="mt-1 text-[14px] text-ink-muted">
                {snap.agent?.paused
                  ? 'SPARK is paused — nothing will publish until you resume it.'
                  : `SPARK is running, aiming for ${snap.agent?.postsPerWeek ?? 3} posts a week.`}
              </p>
            </div>
            <Badge variant={snap.agent?.paused ? 'warn' : 'success'}>
              {snap.agent?.paused ? 'Paused' : 'Running'}
            </Badge>
          </div>

          {snap.needsReview > 0 ? (
            <div className="mt-4 rounded-lg border border-warn/40 bg-warn/10 p-3">
              <p className="text-[14px] text-ink">
                <span className="font-medium">
                  {snap.needsReview} post{snap.needsReview === 1 ? '' : 's'}
                </span>{' '}
                {snap.needsReview === 1 ? 'is' : 'are'} waiting on you before {snap.needsReview === 1 ? 'it' : 'they'} can go out.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-2">
                <Link href="/calendar">Review them</Link>
              </Button>
            </div>
          ) : null}
        </section>
      )}

      {/* ── Preview widgets. §8.3 names these five. ─────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Widget
          href="/calendar"
          label="Calendar"
          value={String(snap.scheduled)}
          note={snap.scheduled ? 'posts scheduled' : 'nothing scheduled yet'}
        />
        <Widget
          href="/command-center"
          label="Engagement"
          value={String(snap.engagementWaiting)}
          note={snap.engagementWaiting ? 'need a reply' : 'inbox is clear'}
          warn={snap.engagementWaiting > 0}
        />
        <Widget
          href="/automation"
          label="Automation"
          value={String(snap.recipes)}
          note={snap.recipes ? 'recipes running' : 'no recipes yet'}
        />
        <Widget href="/discovery" label="Discovery" value="→" note="trends worth joining" />
      </div>

      <p className="text-[13px] text-ink-muted">
        The Command Center has the full picture — what SPARK is doing next, and why.{' '}
        <Link
          href="/agents"
          className="font-medium text-primary underline decoration-dotted underline-offset-2 hover:no-underline"
        >
          Open it
        </Link>
        .
      </p>
    </div>
  );
}

function Widget({
  href,
  label,
  value,
  note,
  warn,
}: {
  href: string;
  label: string;
  value: string;
  note: string;
  warn?: boolean;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-muted"
    >
      <p className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={cn('mt-1 text-[26px] font-medium tabular-nums', warn ? 'text-warn' : 'text-ink')}>
        {value}
      </p>
      <p className="mt-0.5 text-[12px] text-ink-muted">{note}</p>
    </Link>
  );
}
