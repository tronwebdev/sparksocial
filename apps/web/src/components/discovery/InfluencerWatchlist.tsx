'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { cn } from '@/lib/utils';
import { WhyPopover, type Explanation } from '@/components/explain/WhyPopover';

/**
 * §8.9's second watchlist — the accounts a brand studies.
 *
 * The keyword watchlist has had a tab since P5. This one had no storage, no tool
 * and no screen, and the reason it is a feature rather than a list of names is
 * the review below it: watching an account has to *mean* something, and what it
 * means here is that their recent posts get scored for relevance and brand
 * safety by exactly the machinery `trend.rank` applies to everything else.
 *
 * ── The refusal is part of the design ─────────────────────────────────────
 *
 * Reading a named account's posts is a listening capability, gated by the same
 * platform approvals as the engagement inbox. `trend.influencer.review` refuses
 * by name when nothing is configured, and this screen shows that refusal as
 * written rather than as an empty state — "your competitors posted nothing" and
 * "we cannot see their posts yet" are completely different facts, and only one
 * of them is true.
 */

type Platform = 'instagram' | 'tiktok' | 'linkedin' | 'x' | 'youtube_shorts';

interface Watch {
  platform: Platform;
  handle: string;
  displayName?: string;
  note?: string;
  createdAt: string;
}

interface ReviewedPost {
  platform: Platform;
  handle: string;
  trendId: string;
  topic: string;
  source: string;
  score: number;
  relevance: number;
  opportunity: number;
  safe: boolean;
  unsafeBecause?: string;
}

interface Review {
  posts: ReviewedPost[];
  quiet: Array<{ platform: Platform; handle: string; because: string }>;
  why: Explanation;
}

const PLATFORMS: Array<{ value: Platform; label: string }> = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'x', label: 'X' },
  { value: 'youtube_shorts', label: 'YouTube' },
];

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function InfluencerWatchlist({ genomeId }: { genomeId: string | undefined }) {
  const [watchlist, setWatchlist] = useState<Watch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [platform, setPlatform] = useState<Platform>('instagram');
  const [handle, setHandle] = useState('');
  const [note, setNote] = useState('');

  const [review, setReview] = useState<Review | null>(null);
  /** The tool's own refusal text when listening access is not configured. Kept apart from `error` because it is not a failure of this screen. */
  const [reviewBlocked, setReviewBlocked] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(async () => {
    if (!genomeId) return;
    const res = await invoke<{ watchlist: Watch[] }>('trend.influencer.watch', { genomeId, action: 'list' });
    if (res.status === 'succeeded') {
      setWatchlist(res.output.watchlist);
      setError(null);
    } else {
      setError(
        res.status === 'failed'
          ? res.error.message
          : 'Only an owner, admin or editor can see which accounts this brand watches.',
      );
      setWatchlist([]);
    }
  }, [genomeId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!genomeId || !handle.trim()) return;
    setBusy('add');
    setError(null);
    const res = await invoke<{ watchlist: Watch[] }>('trend.influencer.watch', {
      genomeId,
      action: 'add',
      platform,
      handle: handle.trim(),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setBusy(null);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    setWatchlist(res.output.watchlist);
    setHandle('');
    setNote('');
  }

  async function remove(w: Watch) {
    if (!genomeId) return;
    setBusy(`${w.platform}:${w.handle}`);
    const res = await invoke<{ watchlist: Watch[] }>('trend.influencer.watch', {
      genomeId,
      action: 'remove',
      platform: w.platform,
      handle: w.handle,
    });
    setBusy(null);
    if (res.status === 'succeeded') setWatchlist(res.output.watchlist);
  }

  async function runReview() {
    if (!genomeId) return;
    setReviewing(true);
    setReview(null);
    setReviewBlocked(null);
    const res = await invoke<Review>('trend.influencer.review', { genomeId, postsPerAccount: 5, limit: 15 });
    setReviewing(false);
    if (res.status === 'succeeded') {
      setReview(res.output);
      return;
    }
    // Shown as written. The tool explains why it cannot look — paraphrasing it
    // into "no results" is precisely the lie this branch exists to avoid.
    setReviewBlocked(res.status === 'failed' ? res.error.message : 'That request was gated.');
  }

  if (!genomeId) return null;

  return (
    <div className="mt-4 grid grid-cols-1 gap-4">
      <p className="text-[14px] text-ink-muted">
        Accounts worth studying — competitors, customers, anyone whose formats you want to learn from. SPARK
        scores what they post the same way it scores any other trend: by whether you could credibly make
        something like it.
      </p>

      {error ? <p className="text-[13px] text-destructive">{error}</p> : null}

      {/* ── Add ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-4">
        <div>
          <label className="block text-[12px] text-ink-muted" htmlFor="inf-platform">
            Where
          </label>
          <select
            id="inf-platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
            className="mt-1 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink"
          >
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[160px]">
          <label className="block text-[12px] text-ink-muted" htmlFor="inf-handle">
            Handle
          </label>
          <Input
            id="inf-handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@competitor"
            className="mt-1"
          />
        </div>
        <div className="min-w-[180px] flex-1">
          <label className="block text-[12px] text-ink-muted" htmlFor="inf-note">
            Why (optional)
          </label>
          <Input
            id="inf-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Their before/afters do well"
            className="mt-1"
          />
        </div>
        <Button disabled={busy !== null || !handle.trim()} onClick={() => void add()}>
          {busy === 'add' ? 'Adding…' : 'Watch'}
        </Button>
      </div>

      {/* ── The list ────────────────────────────────────────────────────── */}
      {watchlist === null ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : watchlist.length === 0 ? (
        <p className="text-[14px] text-ink-muted">
          No accounts watched yet. Add the two or three whose posts you already check by hand.
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {watchlist.map((w) => (
              <li
                key={`${w.platform}:${w.handle}`}
                className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium text-ink">@{w.handle}</p>
                  <p className="text-[12px] capitalize text-ink-muted">{w.platform.replace('_', ' ')}</p>
                  {w.note ? <p className="mt-1 text-[12px] text-ink-muted">{w.note}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => void remove(w)}
                  disabled={busy !== null}
                  className="shrink-0 text-[12px] text-ink-muted hover:text-ink disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <div>
            <Button variant="outline" disabled={reviewing} onClick={() => void runReview()}>
              {reviewing ? 'Looking…' : 'What have they been posting?'}
            </Button>
          </div>
        </>
      )}

      {/* ── The review ──────────────────────────────────────────────────── */}
      {reviewBlocked ? (
        <div className="rounded-lg border border-warn/40 bg-warn/10 p-3">
          <p className="text-[13px] font-medium text-ink">SPARK cannot read their posts yet</p>
          <p className="mt-1 text-[13px] text-ink-muted">{reviewBlocked}</p>
        </div>
      ) : null}

      {review ? (
        <div className="rounded-lg border border-border p-4">
          <WhyPopover why={review.why} label={review.why.summary} className="mt-0" />

          {review.posts.length > 0 ? (
            <ul className="mt-3 grid grid-cols-1 gap-2">
              {review.posts.map((p) => (
                <li key={`${p.handle}:${p.trendId}`} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[14px] text-ink">{p.topic}</p>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-[12px] text-ink-muted">@{p.handle}</span>
                      <Badge variant={p.score >= 0.5 ? 'success' : 'neutral'}>{pct(p.score)} match</Badge>
                      {/* Flagged, not filtered — same choice `trend.rank` makes.
                          A competitor doing something this brand must not do is
                          genuinely useful to see. */}
                      {!p.safe ? <Badge variant="warn">Do not copy</Badge> : null}
                    </div>
                  </div>
                  {p.unsafeBecause ? (
                    <p className={cn('mt-1 text-[12px] text-warn')}>{p.unsafeBecause}</p>
                  ) : null}
                  <p className="mt-1 text-[12px] text-ink-muted">
                    Relevance {pct(p.relevance)} · opportunity {pct(p.opportunity)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[14px] text-ink-muted">Nothing they posted scored high enough to suggest.</p>
          )}

          {review.quiet.length > 0 ? (
            <div className="mt-3 rounded-lg border border-border bg-surface-muted p-3">
              <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">
                {review.quiet.length} account{review.quiet.length === 1 ? '' : 's'} with nothing to show
              </p>
              <ul className="mt-1 grid grid-cols-1 gap-1">
                {review.quiet.map((q) => (
                  <li key={`${q.platform}:${q.handle}`} className="text-[13px] text-ink-muted">
                    <span className="text-ink">@{q.handle}</span> — {q.because}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
