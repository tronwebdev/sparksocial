'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/tools';
import { WhyPopover } from '@/components/explain/WhyPopover';
import { cn } from '@/lib/utils';
import { pillarStyle } from './pillars';

/**
 * §6.8 Step 6 — "report against the stated outcome, not vanity metrics."
 * On-demand (a button, not a poll): the report reads real slots + real
 * `content_metrics`, neither of which changes fast enough in this alpha to
 * justify fetching it every time the calendar renders.
 */

interface Report {
  daysElapsed: number;
  daysRemaining: number;
  target: { count: number; label: string } | null;
  targetStatus: 'no_target' | 'not_measurable';
  volume: { planned: number; published: number; scheduledRemaining: number };
  mix: Array<{ pillar: string; planned: number; actual: number; ratio: number | null }>;
  engagement: { postsWithMetrics: number; likes: number; comments: number; shares: number; views: number; impressions: number };
  reweightSuggestion: { overDelivered: string | null; underDelivered: string | null; detail: string } | null;
  why: { summary: string };
}

/** `analytics.campaign_report` — plain totals, no plan comparison (that's `report`'s own job above); adds the per-platform/top-posts breakdown `report_vs_outcome` doesn't carry. */
interface PlatformReport {
  postsWithMetrics: number;
  byPlatform: Array<{ platform: string; likes: number; comments: number; shares: number; views: number; impressions: number }>;
  topPosts: Array<{ contentItemId: string; engagement: number }>;
}

export function CampaignReportPanel({ campaignId }: { campaignId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [platformReport, setPlatformReport] = useState<PlatformReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function load() {
    setOpen(true);
    if (report) return; // cached for this mount — re-open doesn't mean re-fetch
    setLoading(true);
    setError(null);
    const [res, platformRes] = await Promise.all([
      invoke<Report>('campaign.report_vs_outcome', { campaignId }),
      invoke<PlatformReport>('analytics.campaign_report', { campaignId }),
    ]);
    setLoading(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    setReport(res.output);
    // Best-effort — a failure here shouldn't hide the report above, which is the primary read.
    if (platformRes.status === 'succeeded') setPlatformReport(platformRes.output);
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => void load()}>
        Report vs. outcome
      </Button>
    );
  }

  return (
    <div className="w-full rounded-lg border border-border bg-surface-muted p-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-ink">Report vs. outcome</p>
        <button type="button" onClick={() => setOpen(false)} className="text-[12px] text-ink-muted hover:text-ink">
          Close
        </button>
      </div>

      {loading ? <p className="mt-2 text-[13px] text-ink-muted">Working it out…</p> : null}
      {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}

      {report ? (
        <div className="mt-3 grid grid-cols-1 gap-3">
          <p className="text-[14px] text-ink">{report.why.summary}</p>
          <WhyPopover why={report.why} label="How this was measured" />

          <div className="flex flex-wrap gap-4 text-[13px] text-ink-muted">
            <span>
              <b className="text-ink">{report.volume.published}</b> of {report.volume.planned} planned posts published
            </span>
            <span>
              <b className="text-ink">{report.daysRemaining}</b> day{report.daysRemaining === 1 ? '' : 's'} left
            </span>
            {report.engagement.postsWithMetrics > 0 ? (
              <span>
                <b className="text-ink">{report.engagement.likes + report.engagement.comments + report.engagement.shares}</b>{' '}
                engagements across {report.engagement.postsWithMetrics} tracked post{report.engagement.postsWithMetrics === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>

          {report.target ? (
            <p className="rounded bg-field px-3 py-2 text-[12.5px] text-ink-muted">
              Target: {report.target.count} {report.target.label}. Not shown as a live count — this account
              isn&apos;t wired to real conversion tracking yet, so a number here would be a guess, not a fact.
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-1.5">
            <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">Mix, actual vs. planned</p>
            <div className="flex flex-wrap gap-2">
              {report.mix.map((m) => (
                <span
                  key={m.pillar}
                  className={cn('rounded border px-2 py-1 text-[12px] font-medium', pillarStyle(m.pillar).chip)}
                >
                  {pillarStyle(m.pillar).label} · {m.actual}/{m.planned}
                  {m.ratio !== null ? ` (${Math.round(m.ratio * 100)}%)` : ''}
                </span>
              ))}
            </div>
          </div>

          {report.reweightSuggestion ? (
            <p className="text-[13px] text-warn">{report.reweightSuggestion.detail}</p>
          ) : null}

          {platformReport && platformReport.byPlatform.length > 0 ? (
            <div className="grid grid-cols-1 gap-1.5 border-t border-border pt-3">
              <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">By platform</p>
              <div className="grid grid-cols-1 gap-1">
                {platformReport.byPlatform.map((p) => (
                  <div key={p.platform} className="flex items-center justify-between text-[13px] text-ink-muted">
                    <span className="capitalize text-ink">{p.platform.replace('_', ' ')}</span>
                    <span>
                      {p.likes} likes · {p.comments} comments · {p.shares} shares
                      {p.views ? ` · ${p.views} views` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {platformReport && platformReport.topPosts.length > 0 ? (
            <div className="grid grid-cols-1 gap-1.5">
              <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">Top posts</p>
              <ol className="grid grid-cols-1 gap-1 text-[13px] text-ink-muted">
                {platformReport.topPosts.map((p, i) => (
                  <li key={p.contentItemId}>
                    {i + 1}. {p.contentItemId.slice(0, 8)}… — <b className="text-ink">{p.engagement}</b> engagements
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
