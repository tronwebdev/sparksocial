'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';

/**
 * CC-03 — the Draft List: everything a genome has in flight, across every
 * status, in one browsable list. Before this, the only way to reach a draft
 * was the message that happened to create it (`ChatDrawer`'s "Open draft"
 * link) — real for the session that made it, gone the moment you navigated
 * away. `content.list` is genome-wide, not per-campaign, so this also
 * surfaces `content.draft`'s ad-hoc path (CC-02's "one brief → draft pack"),
 * which no campaign-scoped read could ever see.
 *
 * `analytics.sync` — real since P4, reached from no screen until this one.
 * Only meaningful for `published` items (it needs the platform receipt
 * `publish.now` records), so the action only appears there.
 */

interface DraftListItem {
  contentItemId: string;
  playbookId: string;
  playbookName: string;
  mediaType?: 'video' | 'image' | 'carousel' | 'text';
  status: string;
  summary: string;
  scheduledAt?: string;
  createdAt: string;
}

interface MetricsSnapshot {
  likes: number;
  comments: number;
  shares: number;
  views: number;
  impressions: number;
}

/** `analytics.post_metrics` — per-platform breakdown (a post can be synced on more than one). */
interface PostMetrics {
  platforms: Array<{ platform: string; likes: number; comments: number; shares: number; views: number; impressions: number }>;
}

/** `analytics.cta_traffic` — click counts for whatever CTA link `link.shorten` attributed to this post, if any. */
interface CtaTraffic {
  links: Array<{ shortUrl: string; destinationUrl: string; clicks: number }>;
  totalClicks: number;
}

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warn'> = {
  draft: 'neutral',
  scheduled: 'warn',
  published: 'success',
  // A guardrail hard-blocked this at its scheduled publish time — see
  // apps/api/src/scheduler.ts. Same tone as `scheduled`: it needs a person's
  // attention, not a red "something is broken" reading.
  blocked: 'warn',
};

export function DraftList({
  genomeId,
  onOpen,
  refreshKey,
}: {
  genomeId: string | undefined;
  onOpen: (contentItemId: string) => void;
  /** Bumped by the parent when the Draft Panel closes, so a status change or a brand-new draft shows up without a manual refresh. */
  refreshKey?: number;
}) {
  const [items, setItems] = useState<DraftListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Record<string, MetricsSnapshot>>({});
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [postMetrics, setPostMetrics] = useState<Record<string, PostMetrics>>({});
  const [ctaTraffic, setCtaTraffic] = useState<Record<string, CtaTraffic>>({});
  const [metricsLoading, setMetricsLoading] = useState<string | null>(null);
  const [metricsError, setMetricsError] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!genomeId) return;
    let cancelled = false;
    void (async () => {
      const res = await invoke<{ items: DraftListItem[] }>('content.list', { genomeId, limit: 20 });
      if (cancelled) return;
      if (res.status !== 'succeeded') {
        setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
        setItems([]);
        return;
      }
      setItems(res.output.items);
    })();
    return () => {
      cancelled = true;
    };
  }, [genomeId, refreshKey]);

  async function syncMetrics(contentItemId: string) {
    if (!genomeId || syncing) return;
    setSyncing(contentItemId);
    setSyncErrors((e) => ({ ...e, [contentItemId]: '' }));
    const res = await invoke<MetricsSnapshot>('analytics.sync', { genomeId, contentItemId });
    setSyncing(null);
    if (res.status !== 'succeeded') {
      setSyncErrors((e) => ({
        ...e,
        [contentItemId]: res.status === 'failed' ? res.error.message : 'That request was gated.',
      }));
      return;
    }
    setMetrics((m) => ({ ...m, [contentItemId]: res.output }));
  }

  async function toggleMetrics(contentItemId: string) {
    if (expandedId === contentItemId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(contentItemId);
    if (!genomeId || postMetrics[contentItemId]) return; // cached
    setMetricsLoading(contentItemId);
    setMetricsError((e) => ({ ...e, [contentItemId]: '' }));
    const [pm, cta] = await Promise.all([
      invoke<PostMetrics>('analytics.post_metrics', { genomeId, contentItemId }),
      invoke<CtaTraffic>('analytics.cta_traffic', { genomeId, contentItemId }),
    ]);
    setMetricsLoading(null);
    if (pm.status !== 'succeeded') {
      setMetricsError((e) => ({ ...e, [contentItemId]: pm.status === 'failed' ? pm.error.message : 'That request was gated.' }));
      return;
    }
    setPostMetrics((m) => ({ ...m, [contentItemId]: pm.output }));
    // Best-effort — a brand's own attribution gap shouldn't hide the metrics above, which are the primary read.
    if (cta.status === 'succeeded') setCtaTraffic((c) => ({ ...c, [contentItemId]: cta.output }));
  }

  if (!genomeId) return null;

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">Drafts</h2>

      {items === null ? (
        <div className="mt-4 grid grid-cols-1 gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded" />
          ))}
        </div>
      ) : error ? (
        <p className="mt-2 text-[14px] text-ink-muted">{error}</p>
      ) : items.length === 0 ? (
        <p className="mt-2 text-[14px] text-ink-muted">Nothing drafted yet — try "New post" or ask Spark for one.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-2">
          {items.map((item) => {
            const snapshot = metrics[item.contentItemId];
            return (
              <li key={item.contentItemId} className="rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => onOpen(item.contentItemId)}
                  className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-surface-muted"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium text-ink">{item.playbookName}</p>
                    <p className="truncate text-[13px] text-ink-muted">{item.summary}</p>
                  </div>
                  <Badge variant={STATUS_TONE[item.status] ?? 'neutral'} className="shrink-0 capitalize">
                    {item.status}
                  </Badge>
                </button>

                {item.status === 'published' ? (
                  <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
                    {snapshot ? (
                      <p className="text-[12px] text-ink-muted">
                        {snapshot.likes} likes · {snapshot.comments} comments · {snapshot.shares} shares ·{' '}
                        {snapshot.views} views · {snapshot.impressions} impressions
                      </p>
                    ) : (
                      <span className="text-[12px] text-ink-muted">No metrics synced yet</span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={syncing === item.contentItemId}
                      onClick={(e) => {
                        e.stopPropagation();
                        void syncMetrics(item.contentItemId);
                      }}
                    >
                      {syncing === item.contentItemId ? 'Syncing…' : snapshot ? 'Re-sync' : 'Sync metrics'}
                    </Button>
                    {syncErrors[item.contentItemId] ? (
                      <span className="text-[12px] text-destructive">{syncErrors[item.contentItemId]}</span>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={metricsLoading === item.contentItemId}
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleMetrics(item.contentItemId);
                      }}
                    >
                      {metricsLoading === item.contentItemId
                        ? 'Loading…'
                        : expandedId === item.contentItemId
                          ? 'Hide metrics'
                          : 'View metrics'}
                    </Button>
                  </div>
                ) : null}

                {item.status === 'published' && expandedId === item.contentItemId ? (
                  <div className="border-t border-border px-3 py-2">
                    {metricsError[item.contentItemId] ? (
                      <p className="text-[12px] text-destructive">{metricsError[item.contentItemId]}</p>
                    ) : postMetrics[item.contentItemId] ? (
                      postMetrics[item.contentItemId]!.platforms.length > 0 ? (
                        <div className="grid grid-cols-1 gap-1">
                          {postMetrics[item.contentItemId]!.platforms.map((p) => (
                            <div key={p.platform} className="flex items-center justify-between text-[12px] text-ink-muted">
                              <span className="capitalize text-ink">{p.platform.replace('_', ' ')}</span>
                              <span>
                                {p.likes} likes · {p.comments} comments · {p.shares} shares
                                {p.views ? ` · ${p.views} views` : ''}
                                {p.impressions ? ` · ${p.impressions} impressions` : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[12px] text-ink-muted">No synced snapshot yet — try Sync metrics above first.</p>
                      )
                    ) : null}
                    {ctaTraffic[item.contentItemId] && ctaTraffic[item.contentItemId]!.links.length > 0 ? (
                      <p className="mt-1 text-[12px] text-ink-muted">
                        {ctaTraffic[item.contentItemId]!.totalClicks} link click
                        {ctaTraffic[item.contentItemId]!.totalClicks === 1 ? '' : 's'}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
