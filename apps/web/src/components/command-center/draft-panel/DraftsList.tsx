'use client';

import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@/lib/tools';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { PostType } from './DraftDrawer';

/**
 * The Drafts List — `DP list.dc.html`, and the tab that did nothing.
 *
 * `drawerTab` was state the drawer set and nobody read, so "Drafts List" was a
 * chip that highlighted and left the Current Draft on screen. Meanwhile
 * `content.list` has carried the comment "the Draft List's (CC-03) source"
 * since it was written, and nothing had ever called it.
 *
 * ── Measured off the rendered prototype at 1728 ───────────────────────────
 *
 * The list is the only state that drops the post-type rail: its header starts
 * at x678, left of the content pane's own x788, so it runs the drawer's full
 * width. `DraftDrawer` hides the rail for this tab.
 *
 *   "Draft List"   x678 y178 · 20/500 ink
 *   subtitle       x678 y209 · 16/500 grey
 *   filter pills   y188 · h39 · r80.75 — active #6CE8FF, rest grey 10%,
 *                  label 14.52/500 (ink active, grey otherwise)
 *   row pitch      114
 *     title        x774 · 18/500 ink
 *     stage        x785 · 15/500, coloured by how far along the post is
 *     time         15/500 grey, on the stage's line
 *     action       right · 16/600, coloured to match the stage
 *   "Page 1 of 4"  x670 y1029 · 16.25/400 grey
 */

/** `content.list`'s row — retyped here, as `types.ts` retypes `DraftView`. */
interface ContentListItem {
  contentItemId: string;
  playbookId: string;
  playbookName: string;
  mediaType?: PostType;
  platform?: string;
  status: string;
  summary: string;
  scheduledAt?: string;
  createdAt: string;
  blockedReason?: string;
  publishAttempts?: number;
}

/**
 * How far along a post is, and what that looks like.
 *
 * The design names six stages — "Generated — needs review", "Storyboard ready",
 * "Outline ready", "Copy drafted", "Prompt drafted", "Intent only". A list row
 * carries `status` and `mediaType` and no beats, so these are the ones those
 * two can actually tell apart; inventing "Outline ready" as distinct from
 * "Copy drafted" would be a label no state ever produces.
 */
function stageOf(item: ContentListItem): { label: string; hue: string; action: string; actionable: boolean } {
  switch (item.status) {
    case 'published':
      return { label: 'Published', hue: 'var(--ss-scene-cta)', action: 'Completed', actionable: false };
    case 'scheduled':
      return { label: 'Scheduled', hue: 'var(--ss-indigo-500, #5E64F4)', action: 'Open', actionable: true };
    case 'needs_review':
      return { label: 'Generated — needs review', hue: 'var(--ss-scene-cta)', action: 'Review', actionable: true };
    case 'blocked':
      return { label: item.blockedReason ? 'Blocked' : 'Blocked', hue: 'var(--ss-scene-override)', action: 'Resume', actionable: true };
    case 'rolled_back':
      return { label: 'Rolled back', hue: 'var(--ss-fg-muted)', action: 'Resume', actionable: true };
    default:
      return {
        label: item.mediaType && item.mediaType !== 'text' ? 'Storyboard ready' : 'Copy drafted',
        hue: item.mediaType && item.mediaType !== 'text' ? 'var(--ss-purple)' : 'var(--ss-fg-muted)',
        action: 'Resume',
        actionable: true,
      };
  }
}

/** "12 min ago", "2 hours ago", "Yesterday", "3 days ago" — the design's words. */
function ago(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

/**
 * "All" and one pill per post type.
 *
 * The design draws four — All, Image, Video, Text — and its own numbers add up
 * because its example has no carousels. The product has four types and the
 * rail lists all four, so leaving Carousel out made the live pills read
 * "All (39) · Image (15) · Video (5) · Text (14)": five drafts with no pill
 * and no way to reach them.
 */
const FILTERS: Array<{ id: 'all' | PostType; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'carousel', label: 'Carousel' },
  { id: 'text', label: 'Text' },
];

/** One page, so "Page 1 of 4" means something rather than being decoration. */
const PAGE_SIZE = 6;

export function DraftsList({
  genomeId,
  onOpen,
  currentId,
}: {
  genomeId: string | undefined;
  /** Open one draft — the panel switches back to Current Draft on this. */
  onOpen: (contentItemId: string) => void;
  /** The post already open, marked so the list says where you are. */
  currentId?: string;
}) {
  const [items, setItems] = useState<ContentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | PostType>('all');
  const [page, setPage] = useState(0);

  useEffect(() => {
    let live = true;
    if (!genomeId) {
      setItems([]);
      return;
    }
    setItems(null);
    setError(null);
    void (async () => {
      const res = await invoke<{ items: ContentListItem[] }>('content.list', { genomeId, limit: 50 });
      if (!live) return;
      if (res.status !== 'succeeded') {
        setError(res.status === 'failed' ? res.error.message : 'That list was gated.');
        setItems([]);
        return;
      }
      setItems(res.output.items);
    })();
    return () => {
      live = false;
    };
  }, [genomeId]);

  /*
   * "Unfinished" is the subtitle's own word, so the list means it: a published
   * post is not a draft you can come back to. Counted before the type filter,
   * because the header describes the drawer's drafts and not the current view
   * of them.
   */
  const unfinished = useMemo(() => (items ?? []).filter((i) => i.status !== 'published'), [items]);

  const counts = useMemo(() => {
    const by = (t: PostType) => unfinished.filter((i) => i.mediaType === t).length;
    return { all: unfinished.length, image: by('image'), video: by('video'), text: by('text'), carousel: by('carousel') };
  }, [unfinished]);

  const shown = useMemo(
    () => (filter === 'all' ? unfinished : unfinished.filter((i) => i.mediaType === filter)),
    [unfinished, filter],
  );

  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const clamped = Math.min(page, pages - 1);
  const slice = shown.slice(clamped * PAGE_SIZE, clamped * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="px-[30px] pt-[27px] pb-[30px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-20 font-medium text-ink">Draft List</h2>
          <p className="mt-[10px] text-16 font-medium text-ink-muted">
            {items === null
              ? 'Loading…'
              : `${counts.all} unfinished draft${counts.all === 1 ? '' : 's'} · auto-saved`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-[10px]">
          {FILTERS.map((f) => {
            const n = counts[f.id];
            const on = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setFilter(f.id);
                  setPage(0);
                }}
                className={cn(
                  'flex h-[39px] items-center rounded-[80.75px] px-[18px] text-14 font-medium transition-colors',
                  on ? 'text-ink' : 'text-ink-muted hover:text-ink',
                )}
                // Inline for the same reason the rail tiles are — an arbitrary
                // rgba class here rendered the wrong element's colour once.
                style={{ background: on ? 'var(--ss-cyan)' : 'rgba(131,131,131,0.1)' }}
              >
                {f.label} ({n})
              </button>
            );
          })}
        </div>
      </div>

      {error ? <p className="mt-[24px] text-14 text-destructive">{error}</p> : null}

      {items === null ? (
        <div className="mt-[30px] flex flex-col gap-[14px]">
          <Skeleton className="h-[80px] w-full rounded-[12px]" />
          <Skeleton className="h-[80px] w-full rounded-[12px]" />
          <Skeleton className="h-[80px] w-full rounded-[12px]" />
        </div>
      ) : slice.length === 0 ? (
        <p className="mt-[30px] text-16 text-ink-muted">
          {counts.all === 0
            ? 'Nothing unfinished — every post for this brand is scheduled or out.'
            : 'No unfinished drafts of that type.'}
        </p>
      ) : (
        <ul className="mt-[24px] flex flex-col">
          {slice.map((item) => {
            const stage = stageOf(item);
            const here = item.contentItemId === currentId;
            return (
              <li key={item.contentItemId}>
                <button
                  type="button"
                  onClick={() => onOpen(item.contentItemId)}
                  className={cn(
                    'flex w-full items-start justify-between gap-6 border-b border-border/60 py-[22px] text-left transition-colors',
                    here ? 'opacity-60' : 'hover:bg-surface-muted/60',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-18 font-medium text-ink">{item.summary}</span>
                    <span className="mt-[14px] flex flex-wrap items-center gap-[16px]">
                      <span className="text-15 font-medium" style={{ color: stage.hue }}>
                        {stage.label}
                      </span>
                      <span className="text-15 font-medium text-ink-muted">{ago(item.createdAt)}</span>
                      {item.mediaType ? (
                        <span className="rounded-[12.381px] px-[12px] py-[3px] text-12 font-medium text-ink-muted" style={{ background: 'rgba(131,131,131,0.1)' }}>
                          {item.mediaType}
                        </span>
                      ) : null}
                    </span>
                  </span>

                  <span
                    className="shrink-0 text-16 font-semibold"
                    style={{ color: stage.actionable ? stage.hue : 'var(--ss-scene-cta)' }}
                  >
                    {here ? 'Open now' : stage.action}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 ? (
        <div className="mt-[26px] flex items-center gap-[18px]">
          <button
            type="button"
            disabled={clamped === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="text-16 font-medium text-ink-muted hover:text-ink disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-16 text-ink-muted">
            Page {clamped + 1} of {pages}
          </span>
          <button
            type="button"
            disabled={clamped >= pages - 1}
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            className="text-16 font-medium text-ink-muted hover:text-ink disabled:opacity-40"
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
