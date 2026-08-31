'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';

/**
 * `F9` / `CAL-07` — what happens when you click an empty day.
 *
 * ── The inversion this fixes ──────────────────────────────────────────────
 *
 * Clicking an empty day opened the Draft Panel's trigger phase, which asks *you*
 * what the post should be. That is the exact inverse of the design: SPARK
 * proposes and you accept, adjust, or ask for another. The calendar rendered a
 * plan and offered no way to argue with it.
 *
 * Three routes, which is what the prototype's own modal set offers:
 *
 *   **Ask the agent** — `calendar.recommend_slot` answers "what should go here"
 *   for one date. Nothing else in the registry could: `playbook.resolve` ranks
 *   formats for a brand and `calendar.generate` places a whole month.
 *
 *   **Create something specific** — the old behaviour, kept and demoted. It is
 *   the right route when you already know; it was wrong as the only one.
 *
 *   **Move a post here** — reschedule something already planned.
 *
 * ── What this deliberately does not show ──────────────────────────────────
 *
 * A hook. The prototype's preview shows one, and the tool does not return one:
 * showing a hook means either spending a model call on copy nobody has accepted
 * yet, or showing a line the subsequent draft then contradicts. Naming the format
 * and what it is designed to do is knowable without writing anything, and the
 * words arrive with the draft, from the draft. There is a test on the tool
 * asserting the field is absent, so this is a boundary rather than an oversight.
 */

interface Recommendation {
  date: string;
  create?: {
    playbookId: string;
    playbookName: string;
    description: string;
    mediaType: string;
    /** `direct_finish` is filmed through the capture loop rather than written. */
    mode: string;
    platforms: string[];
    pillar: string;
    goal: string;
    cta?: string;
    designedTo: string[];
    readiness: string;
    missingRoles: string[];
    alternativesLeft: number;
    why: { summary: string };
  };
  move?: {
    contentItemId: string;
    playbookName: string;
    pillar: string;
    currentlyAt: string;
    platform?: string;
    alternativesLeft: number;
    why: { summary: string };
  };
  note?: string;
}

export interface DayActionSheetProps {
  day: string;
  campaignId: string;
  genomeId: string;
  open: boolean;
  onClose: () => void;
  /** "Create something specific" — hands off to the Draft Panel's trigger phase. */
  onCreateSpecific: (day: string) => void;
  /** Accepting a recommendation: draft the named playbook onto this day. */
  onAcceptCreate: (day: string, playbookId: string, mode: string) => void;
  /** Accepting a move: reschedule an existing post onto this day. */
  onAcceptMove: (day: string, contentItemId: string) => void;
}

export function DayActionSheet({
  day,
  campaignId,
  genomeId,
  open,
  onClose,
  onCreateSpecific,
  onAcceptCreate,
  onAcceptMove,
}: DayActionSheetProps) {
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Declined suggestions, sent back on the next ask.
   *
   * Held here rather than server-side, matching the tool's own reasoning: a
   * recommendation is not a session, and two people looking at the same day
   * should each see the best answer rather than each other's rejections.
   */
  const [declinedPlaybooks, setDeclinedPlaybooks] = useState<string[]>([]);
  const [declinedItems, setDeclinedItems] = useState<string[]>([]);

  const ask = useCallback(
    async (excludePlaybookIds: string[], excludeContentItemIds: string[]) => {
      setAsking(true);
      setError(null);
      const res = await invoke<Recommendation>('calendar.recommend_slot', {
        campaignId,
        date: day,
        excludePlaybookIds,
        excludeContentItemIds,
      });
      setAsking(false);
      if (res.status !== 'succeeded') {
        setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
        return;
      }
      setRec(res.output);
    },
    [campaignId, day],
  );

  // Reset on reopen, so yesterday's declines do not narrow today's answer.
  useEffect(() => {
    if (!open) return;
    setRec(null);
    setError(null);
    setDeclinedPlaybooks([]);
    setDeclinedItems([]);
  }, [open, day]);

  if (!open) return null;

  const pretty = new Date(`${day}T00:00:00Z`).toLocaleDateString('en', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  function tryAnother() {
    const nextPlaybooks = rec?.create ? [...declinedPlaybooks, rec.create.playbookId] : declinedPlaybooks;
    const nextItems = rec?.move ? [...declinedItems, rec.move.contentItemId] : declinedItems;
    setDeclinedPlaybooks(nextPlaybooks);
    setDeclinedItems(nextItems);
    void ask(nextPlaybooks, nextItems);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Plan ${pretty}`}
      onClick={onClose}
    >
      <div
        className="max-h-full w-full max-w-lg overflow-auto rounded-t-xl border border-border bg-surface p-5 sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-semibold text-ink">{pretty}</h2>
          <button type="button" onClick={onClose} className="text-[13px] text-ink-muted underline">
            Close
          </button>
        </div>

        {rec === null && !asking ? (
          <>
            <p className="mt-1 text-[13px] text-ink-muted">Nothing planned for this day yet.</p>
            <div className="mt-4 grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => void ask([], [])}
                className="rounded-lg border border-border p-3 text-left hover:border-ink-muted"
              >
                <span className="block text-[14px] font-medium text-ink">Ask the agent to plan it</span>
                <span className="mt-0.5 block text-[13px] text-ink-muted">
                  It picks the format that fits this campaign and says what the post is for.
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onCreateSpecific(day);
                }}
                className="rounded-lg border border-border p-3 text-left hover:border-ink-muted"
              >
                <span className="block text-[14px] font-medium text-ink">Create something specific</span>
                <span className="mt-0.5 block text-[13px] text-ink-muted">
                  You say what it is about, and pick the format yourself.
                </span>
              </button>
            </div>
          </>
        ) : null}

        {asking ? (
          <div className="mt-4 grid grid-cols-1 gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : null}

        {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}

        {rec && !asking ? (
          <div className="mt-4 grid grid-cols-1 gap-3">
            {rec.create ? (
              <div className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[15px] font-medium text-ink">{rec.create.playbookName}</p>
                  <Badge variant={rec.create.readiness === 'ready' ? 'success' : 'warn'}>
                    {rec.create.readiness === 'ready' ? 'Ready' : 'Needs something'}
                  </Badge>
                </div>
                <p className="mt-1 text-[13px] text-ink-muted">{rec.create.description}</p>

                <p className="mt-3 text-[11px] uppercase tracking-wide text-ink-muted">This post is designed to</p>
                <ul className="mt-1 grid grid-cols-1 gap-0.5">
                  {rec.create.designedTo.map((line) => (
                    <li key={line} className="text-[13px] text-ink">
                      {line}
                    </li>
                  ))}
                </ul>

                <p className="mt-3 text-[12px] text-ink-muted">
                  {[
                    rec.create.mediaType,
                    rec.create.pillar,
                    rec.create.platforms.join(', ') || undefined,
                    rec.create.cta ? `points at ${rec.create.cta}` : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>

                {/*
                  The unfilled roles, named. `readiness` alone says "needs
                  something" and leaves you to guess what — and the whole point of
                  the Asset Graph refusing to substitute is that the gap is a
                  product signal, not an error to paper over.
                */}
                {rec.create.missingRoles.length > 0 ? (
                  <p className="mt-2 text-[12px] text-warn">
                    Needs {rec.create.missingRoles.join(', ').replace(/_/g, ' ')} — you can still draft it and
                    fill that in.
                  </p>
                ) : null}

                <p className="mt-3 text-[12px] text-ink-muted">{rec.create.why.summary}</p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      onClose();
                      onAcceptCreate(day, rec.create!.playbookId, rec.create!.mode);
                    }}
                  >
                    Use this
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={rec.create.alternativesLeft === 0}
                    onClick={tryAnother}
                    title={
                      rec.create.alternativesLeft === 0
                        ? 'Nothing better to suggest for this day'
                        : undefined
                    }
                  >
                    {rec.create.alternativesLeft === 0
                      ? 'No other suggestions'
                      : `Try another (${rec.create.alternativesLeft} left)`}
                  </Button>
                </div>
              </div>
            ) : null}

            {rec.move ? (
              <div className="rounded-lg border border-border p-4">
                <p className="text-[15px] font-medium text-ink">Move a post here</p>
                <p className="mt-1 text-[13px] text-ink-muted">
                  {rec.move.playbookName} — currently{' '}
                  {new Date(rec.move.currentlyAt).toLocaleDateString('en', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })}
                  {rec.move.platform ? ` on ${rec.move.platform.replace('_', ' ')}` : ''}
                </p>
                <p className="mt-2 text-[12px] text-ink-muted">{rec.move.why.summary}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      onClose();
                      onAcceptMove(day, rec.move!.contentItemId);
                    }}
                  >
                    Move it here
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={rec.move.alternativesLeft === 0}
                    onClick={tryAnother}
                  >
                    {rec.move.alternativesLeft === 0 ? 'Nothing else to move' : 'Try another'}
                  </Button>
                </div>
              </div>
            ) : null}

            {/*
              The honest empty answer. A brand with no assets and no filmable
              formats genuinely has no recommendation for a given day, and the
              tool returns a sentence rather than an empty object so this can say
              so instead of rendering a blank panel.
            */}
            {!rec.create && !rec.move ? (
              <div className="rounded-lg border border-dashed border-border p-4">
                <p className="text-[13px] text-ink">{rec.note ?? 'Nothing to suggest for this day.'}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => {
                    onClose();
                    onCreateSpecific(day);
                  }}
                >
                  Create something specific
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
