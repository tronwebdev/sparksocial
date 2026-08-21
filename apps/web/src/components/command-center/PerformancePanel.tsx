'use client';

import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { cn } from '@/lib/utils';
import { WhyPopover, type Explanation } from '@/components/explain/WhyPopover';

/**
 * `CC-04` — Command Center Performance, PRD §5.
 *
 * `analytics.success_metrics` computes all fourteen of §5's metrics across six
 * groups and had no screen: the numbers were reachable only by calling the tool
 * directly. `CommandCenterOverview`'s own doc comment said the performance tile
 * was *"left out rather than faked"* because nothing real backed it — true when
 * it was written, and the reason this exists now.
 *
 * ── Why "—" and not "0" ───────────────────────────────────────────────────
 *
 * Nine of the fourteen are nullable, and the tool is careful about it: a rate
 * with no denominator comes back `null`, not zero. A dashboard that renders that
 * as 0% says "nobody approves your recipe outputs" when the truth is "nobody has
 * looked yet" — confidently wrong, which is worse than blank. So every null
 * renders as an em dash with the reason underneath, and the reason is specific to
 * the metric rather than a generic "no data".
 *
 * ── Why the headline is the tool's, not this component's ──────────────────
 *
 * `why.summary` is already ordered by how much damage the thing does if ignored
 * (see the tool's own comment), and it reads the same numbers. Re-deriving a
 * headline here would give the product two opinions about what matters, which
 * diverge the first time either side changes.
 *
 * ── The two approximations say so where they are read ─────────────────────
 *
 * §5's "draft edits per post" and "clicks for brand CTA" are not exactly
 * computable from what is stored, and the tool documents each on its own field.
 * That note belongs next to the number, not in a legend at the bottom: somebody
 * acting on "12 drafts per post" needs to know it is a ratio over a window
 * before they act, not after.
 */

interface Metrics {
  windowDays: number;
  since: string;
  activation: {
    connectedAccounts: number;
    onboardingComplete: boolean;
    campaignActivated: boolean;
    hoursToFirstPost: number | null;
  };
  production: {
    postsPublishedPerWeek: number;
    draftsPerPublishedPost: number | null;
    postsWithTrackedLink: number;
  };
  discovery: {
    trendToPostRate: number | null;
    postsFromTrends: number;
    repurposeUsageRate: number | null;
  };
  automation: {
    recipeCount: number;
    outputApprovalRate: number | null;
  };
  engagement: {
    replySlaHours: number | null;
    messagesResolvedRate: number | null;
    salesOpportunitiesPerWeek: number;
    nextActionTakenRate: number | null;
  };
  trust: {
    preventedRate: number | null;
    publishAttempts: number;
    blockedOrHeld: number;
    incidents: number;
    awaitingReview: number;
  };
  why: Explanation;
}

/** 7 / 30 / 90, matching the tool's own 7-day floor and the default campaign window. */
const WINDOWS = [7, 30, 90] as const;

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Hours read badly past a couple of days, and §5's activation target is measured in hours. */
function duration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round(hours / 24)} days`;
}

export function PerformancePanel({ genomeId }: { genomeId: string | undefined }) {
  const [windowDays, setWindowDays] = useState<number>(30);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!genomeId) return;
    let cancelled = false;

    void (async () => {
      setMetrics(null);
      setError(null);
      const res = await invoke<Metrics>('analytics.success_metrics', { genomeId, windowDays });
      if (cancelled) return;
      if (res.status !== 'succeeded') {
        setError(
          res.status === 'failed'
            ? res.error.message
            : 'Performance is not visible to this role.',
        );
        return;
      }
      setMetrics(res.output);
    })();

    return () => {
      cancelled = true;
    };
  }, [genomeId, windowDays]);

  if (!genomeId) return null;

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">Performance</h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            {metrics
              ? `Since ${new Date(metrics.since).toLocaleDateString('en', { day: 'numeric', month: 'long' })}.`
              : 'How this brand is actually doing.'}
          </p>
        </div>

        <div className="flex shrink-0 gap-1" role="group" aria-label="Reporting window">
          {WINDOWS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setWindowDays(d)}
              aria-pressed={windowDays === d}
              className={cn(
                'rounded-full border px-3 py-1 text-[12px]',
                windowDays === d
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-ink hover:bg-surface-muted',
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}

      {!metrics && !error ? <Skeleton className="mt-4 h-64 w-full rounded-lg" /> : null}

      {metrics ? (
        <>
          {/* The tool's own headline, not a second opinion computed here. */}
          <WhyPopover why={metrics.why} label={metrics.why.summary} className="mt-3" />

          <div className="mt-5 grid grid-cols-1 gap-5">
            <Group title="Getting started">
              <Metric
                label="Connected accounts"
                value={String(metrics.activation.connectedAccounts)}
                warn={metrics.activation.connectedAccounts === 0}
                note={metrics.activation.connectedAccounts === 0 ? 'Nothing can publish yet.' : undefined}
              />
              <Metric
                label="Campaign running"
                value={metrics.activation.campaignActivated ? 'Yes' : 'No'}
                warn={!metrics.activation.campaignActivated}
              />
              <Metric
                label="Time to first post"
                value={metrics.activation.hoursToFirstPost === null ? null : duration(metrics.activation.hoursToFirstPost)}
                empty={
                  metrics.activation.campaignActivated
                    ? 'Nothing has published since the campaign started.'
                    : 'Measured from campaign activation.'
                }
              />
            </Group>

            <Group title="Production">
              <Metric label="Posts a week" value={String(metrics.production.postsPublishedPerWeek)} />
              <Metric
                label="Drafts per post"
                value={metrics.production.draftsPerPublishedPost === null ? null : String(metrics.production.draftsPerPublishedPost)}
                empty="Nothing published in this window."
                note="A ratio over the window, not a per-post count."
              />
              <Metric
                label="Posts with a tracked link"
                value={String(metrics.production.postsWithTrackedLink)}
                note="Clicks live in Dub, per link — see a post's own traffic."
              />
            </Group>

            <Group title="Discovery">
              <Metric
                label="Trend to post"
                value={metrics.discovery.trendToPostRate === null ? null : pct(metrics.discovery.trendToPostRate)}
                empty="No trends have been ranked yet."
                note="Against trends offered, not trends that exist."
              />
              <Metric label="Posts from trends" value={String(metrics.discovery.postsFromTrends)} />
              <Metric
                label="Repurpose used"
                value={metrics.discovery.repurposeUsageRate === null ? null : pct(metrics.discovery.repurposeUsageRate)}
                empty="No trends have been ranked yet."
              />
            </Group>

            <Group title="Automation">
              <Metric label="Recipes" value={String(metrics.automation.recipeCount)} />
              <Metric
                label="Output approved"
                value={metrics.automation.outputApprovalRate === null ? null : pct(metrics.automation.outputApprovalRate)}
                empty="Nothing has been approved or rejected yet."
                note="Over decided outputs — pending ones are not counted against you."
              />
            </Group>

            <Group title="Engagement">
              <Metric
                label="Reply time"
                value={metrics.engagement.replySlaHours === null ? null : duration(metrics.engagement.replySlaHours)}
                empty="Nothing has been answered yet."
              />
              <Metric
                label="Inbox resolved"
                value={metrics.engagement.messagesResolvedRate === null ? null : pct(metrics.engagement.messagesResolvedRate)}
                empty="No messages in this window."
                warn={metrics.engagement.messagesResolvedRate !== null && metrics.engagement.messagesResolvedRate < 0.5}
              />
              <Metric label="Leads a week" value={String(metrics.engagement.salesOpportunitiesPerWeek)} />
              <Metric
                label="Next action taken"
                value={metrics.engagement.nextActionTakenRate === null ? null : pct(metrics.engagement.nextActionTakenRate)}
                empty="No leads in this window."
              />
            </Group>

            <Group title="Trust">
              <Metric
                label="Incidents"
                value={String(metrics.trust.incidents)}
                /* A rollback is the only signal that something reached a feed and
                   should not have. Any number above zero is worth the colour. */
                warn={metrics.trust.incidents > 0}
                note={metrics.trust.incidents > 0 ? 'Posts rolled back after publishing.' : 'Nothing has been rolled back.'}
              />
              <Metric
                label="Stopped before publishing"
                value={String(metrics.trust.blockedOrHeld)}
                note={
                  metrics.trust.preventedRate === null
                    ? 'No publish attempts in this window.'
                    : `${pct(metrics.trust.preventedRate)} of ${metrics.trust.publishAttempts} attempts.`
                }
              />
              <Metric
                label="Awaiting review"
                value={String(metrics.trust.awaitingReview)}
                warn={metrics.trust.awaitingReview > 0}
              />
            </Group>
          </div>
        </>
      ) : null}
    </section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] uppercase tracking-wide text-ink-muted">{title}</h3>
      <dl className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{children}</dl>
    </div>
  );
}

/**
 * `value: null` is the whole reason this is a component rather than a `<dd>`:
 * the em-dash-plus-reason case has to be impossible to get wrong, because
 * getting it wrong means printing a confident 0% for something nobody has done
 * yet. `empty` is therefore required whenever a caller can pass null.
 */
function Metric({
  label,
  value,
  empty,
  note,
  warn,
}: {
  label: string;
  value: string | null;
  empty?: string;
  note?: string;
  warn?: boolean;
}) {
  return (
    <div>
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-[22px] font-medium tabular-nums',
          value === null ? 'text-ink-muted' : warn ? 'text-warn' : 'text-ink',
        )}
      >
        {value ?? '—'}
      </dd>
      {value === null && empty ? <p className="mt-0.5 text-[11px] text-ink-muted">{empty}</p> : null}
      {value !== null && note ? <p className="mt-0.5 text-[11px] text-ink-muted">{note}</p> : null}
    </div>
  );
}
