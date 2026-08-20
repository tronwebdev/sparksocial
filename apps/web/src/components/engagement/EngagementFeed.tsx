'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { WhyPopover, type Explanation } from '@/components/explain/WhyPopover';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { cn } from '@/lib/utils';
import { ReplyAction } from './ReplyAction';
import { EngagementCardActions } from './EngagementCardActions';
import { OpportunityActions } from './OpportunityActions';

/**
 * `ENG-02` — the engagement inbox feed: comments, DMs and story replies,
 * sorted into the four tabs PRD §8.8 names, with the "approve & send" loop
 * (`ReplyAction`, PRD §8.8) attached to each card, plus `EngagementCardActions`
 * (`engage.escalate`/`.takeover`) on every card and `OpportunityActions`
 * (`engage.opportunity.create`/`.route`) on the Sales Opportunities tab only.
 * `engage.audit.query` (master plan §3.2) is a deliberate follow-up: no
 * dedicated audit UI here, per its own tool comment.
 *
 * Each tab is a `category` filter on `engage.list`, except **Needs Review**:
 * a message SPARK hasn't classified yet has `category: null`, and there is
 * no fifth tab in the PRD for "unclassified". Rather than invent one, the
 * Needs Review tab fetches with no `category` filter and folds
 * `category == null` rows in alongside `needs_review` ones client-side —
 * the same choice documented on `engage.list`'s own input schema
 * (`packages/engage/src/list.ts`).
 */

type EngagementCategory = 'needs_review' | 'suggested_reply' | 'auto_handled' | 'sales_opportunity';

/** The shape `WhyPopover` renders — `Explanation` as it arrives over HTTP. */
type EngagementWhy = Explanation;

/** Exported for `ReplyAction`, the only other file that needs this shape. */
export interface EngagementItem {
  id: string;
  platform: string;
  kind: string;
  authorHandle: string;
  authorName?: string;
  text: string;
  receivedAt: string;
  status: string;
  category?: EngagementCategory;
  intentScore?: number;
  suggestedReply?: string;
  why?: EngagementWhy;
}

const TABS: { key: EngagementCategory; label: string }[] = [
  { key: 'needs_review', label: 'Needs Review' },
  { key: 'suggested_reply', label: 'Suggested Replies' },
  { key: 'auto_handled', label: 'Auto-Handled' },
  { key: 'sales_opportunity', label: 'Sales Opportunities' },
];

const KIND_LABEL: Record<string, string> = {
  comment: 'Comment',
  dm: 'DM',
  story_reply: 'Story reply',
};

export function EngagementFeed() {
  const { genome, loading, error: genomeError } = useSelectedGenome();
  const genomeId = genome?.genomeId;
  const [tab, setTab] = useState<EngagementCategory>('needs_review');
  const [items, setItems] = useState<EngagementItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!genomeId) return;
    let cancelled = false;
    setItems(null);
    setError(null);
    void (async () => {
      // Needs Review also carries every unclassified row — see the module
      // comment above — so that one tab omits the `category` filter and
      // narrows client-side instead of on the server.
      const input =
        tab === 'needs_review' ? { genomeId, limit: 50 } : { genomeId, category: tab, limit: 50 };
      const res = await invoke<{ items: EngagementItem[] }>('engage.list', input);
      if (cancelled) return;
      if (res.status !== 'succeeded') {
        setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
        setItems([]);
        return;
      }
      const rows =
        tab === 'needs_review'
          ? res.output.items.filter((i) => !i.category || i.category === 'needs_review')
          : res.output.items;
      setItems(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [genomeId, tab]);

  // Once sent — or escalated, or taken over — a message no longer needs
  // anyone's attention in this feed: drop it from whichever tab it was
  // sitting in rather than leaving a stale card behind. A hard refetch would
  // do the same thing less directly and cost a round trip `ReplyAction`/
  // `EngagementCardActions` already know the answer to.
  function handleResolved(messageId: string) {
    setItems((prev) => prev?.filter((i) => i.id !== messageId) ?? prev);
  }

  if (loading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (genomeError || !genomeId) {
    return (
      <section className="rounded-xl border border-border bg-surface p-6">
        <p className="text-[14px] text-ink-muted">{genomeError ?? 'No brand selected.'}</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">Engagement</h2>
      <p className="mt-1 text-[14px] text-ink-muted">Comments, DMs and story replies from the audience.</p>

      <div className="mt-4 flex flex-wrap gap-2 border-b border-border pb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
              tab === t.key ? 'bg-ink text-surface' : 'bg-surface-muted text-ink-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {items === null ? (
        <div className="mt-4 grid grid-cols-1 gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded" />
          ))}
        </div>
      ) : error ? (
        <p className="mt-4 text-[14px] text-ink-muted">{error}</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-[14px] text-ink-muted">Nothing here yet.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-[14px] font-medium text-ink">
                    {item.authorName || item.authorHandle}
                  </p>
                  {item.authorName ? (
                    <span className="truncate text-[13px] text-ink-muted">{item.authorHandle}</span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="neutral" className="capitalize">
                    {item.platform}
                  </Badge>
                  <Badge variant="neutral">{KIND_LABEL[item.kind] ?? item.kind}</Badge>
                  {typeof item.intentScore === 'number' ? (
                    <Badge variant={item.intentScore >= 0.7 ? 'success' : 'neutral'}>
                      Intent {Math.round(item.intentScore * 100)}%
                    </Badge>
                  ) : null}
                </div>
              </div>

              <p className="mt-2 text-[14px] text-ink">{item.text}</p>

              {item.suggestedReply ? (
                <div className="mt-3 rounded border border-border bg-surface-muted p-3">
                  <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">Suggested reply</p>
                  <p className="mt-1 text-[14px] text-ink">{item.suggestedReply}</p>
                </div>
              ) : null}

              {/* PRD §7.3 names engagement classification explicitly as something
                  that must be explainable. The classifier returns weighted
                  factors and its evidence; only the summary was ever shown. */}
              <WhyPopover why={item.why} />

              <ReplyAction item={item} genomeId={genomeId} onReplied={handleResolved} />
              <EngagementCardActions item={item} genomeId={genomeId} onResolved={handleResolved} />
              {tab === 'sales_opportunity' ? <OpportunityActions item={item} genomeId={genomeId} /> : null}

              <p className="mt-2 text-[12px] text-ink-muted">
                {new Date(item.receivedAt).toLocaleString('en', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
