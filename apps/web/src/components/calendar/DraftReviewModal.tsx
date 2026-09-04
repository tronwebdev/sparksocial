'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import { CalendarModal } from './CalendarModal';
import { postKindLabel } from '@/lib/platforms';

/**
 * Draft Review — `SparkSocial Calendar.dc.html`, what a planned day opens.
 *
 * 1035x760 in the shared shell:
 *
 *   title       28px/700 "Draft Review"
 *   subtitle    18px/400 "Review Sparks generated content before publishing"
 *   status      19px/700 "Draft: Needs Review", then the kind and the slot in
 *               19px/500
 *   caption     50,270  935x196 — "Caption Preview" over the copy in 20px/700
 *   notes       50,534  935x120 — "Agent Notes"
 *   primary     "Approve & Schedule"
 *
 * ── What it can and cannot do ─────────────────────────────────────────────
 *
 * The read is `content.list`, filtered to the one item — there is no
 * `content.get` in the registry. Approving is the honest gap: the design's
 * button approves and schedules in one move, and `approval.decide` is keyed on a
 * held **callId** rather than a content item, so a draft sitting in
 * `needs_review` cannot be approved from here. The button says so instead of
 * failing, and "Open in Draft Panel" is the route that does work — that panel
 * owns editing, regenerating and the stall notice.
 */

interface Item {
  contentItemId: string;
  summary: string;
  status: string;
  platform?: string;
  mediaType?: 'video' | 'image' | 'carousel' | 'text';
  scheduledAt?: string;
  playbookName?: string;
}

const STATUS_WORD: Record<string, string> = {
  needs_review: 'Needs Review',
  scheduled: 'Scheduled',
  approved: 'Approved',
  draft: 'Draft',
  blocked: 'Stopped',
  published: 'Published',
};

export function DraftReviewModal({
  contentItemId,
  genomeId,
  onClose,
  onOpenPanel,
}: {
  contentItemId: string;
  genomeId: string | undefined;
  onClose: () => void;
  /** The Draft Panel, which is where editing actually happens. */
  onOpenPanel: (contentItemId: string) => void;
}) {
  const [item, setItem] = useState<Item | null | 'missing'>(null);

  useEffect(() => {
    if (!genomeId) return;
    let cancelled = false;
    void (async () => {
      /* No `content.get` exists, so the list is filtered down to the one. */
      const res = await invoke<{ items: Item[] }>('content.list', { genomeId, limit: 100 });
      if (cancelled) return;
      if (res.status !== 'succeeded') {
        setItem('missing');
        return;
      }
      setItem(res.output.items.find((i) => i.contentItemId === contentItemId) ?? 'missing');
    })();
    return () => {
      cancelled = true;
    };
  }, [genomeId, contentItemId]);

  const it = item !== null && item !== 'missing' ? item : null;

  return (
    <CalendarModal kind="review" label="Draft review" onClose={onClose}>
      <div className="px-[50px] pt-[44px]">
        <p className="text-center text-[28px] font-bold leading-[1.2] text-ink">Draft Review</p>
        <p className="mt-[14px] text-center text-18 font-normal text-ink-muted">
          Review Sparks generated content before publishing
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-[28px] gap-y-2 px-[50px] pt-[30px]">
        <p className="text-[19px] font-bold text-ink">
          Draft: {it ? (STATUS_WORD[it.status] ?? it.status) : '—'}
        </p>
        {it ? (
          <>
            <p className="text-[19px] font-medium text-ink-muted">
              {postKindLabel(it.platform, it.mediaType)}
            </p>
            <p className="text-[19px] font-medium text-ink-muted">
              {it.scheduledAt
                ? `Scheduled: ${new Date(it.scheduledAt).toLocaleString('en', {
                    month: 'long',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}`
                : 'No slot yet'}
            </p>
          </>
        ) : null}
      </div>

      <div className="px-[50px] pt-[26px]">
        <p className="text-18 font-normal text-ink-muted">Caption Preview</p>
        <div
          className="mt-[12px] max-h-[196px] overflow-y-auto rounded-2xl bg-white px-[26px] py-[22px]"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.08)' }}
        >
          <p className="text-[20px] font-bold leading-[1.35] text-ink">
            {item === null
              ? 'Loading…'
              : item === 'missing'
                ? 'This draft could not be found.'
                : it && it.summary && it.summary !== '(no copy yet)'
                  ? it.summary
                  : 'Not written yet — SPARK writes the copy the morning it goes out.'}
          </p>
        </div>
      </div>

      <div className="px-[50px] pt-[24px]">
        <p className="text-[19px] font-semibold text-ink">Agent Notes</p>
        <div
          className="mt-[12px] max-h-[120px] overflow-y-auto rounded-2xl bg-white px-[26px] py-[18px]"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.08)' }}
        >
          <p className="text-18 font-normal text-ink-muted">
            {it?.playbookName
              ? `Planned from the ${it.playbookName} playbook.`
              : 'No note recorded for this draft.'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-[12px] px-[50px] pb-[32px] pt-[24px]">
        <button
          type="button"
          onClick={() => {
            onOpenPanel(contentItemId);
            onClose();
          }}
          className="flex h-[52px] items-center rounded-xl bg-white px-[22px] text-[17px] font-semibold text-ink"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.2)' }}
        >
          Open in Draft Panel
        </button>
        <button
          type="button"
          disabled
          title="Approving is keyed on the held call, not the post — approval.decide takes a callId, so this cannot approve a draft from here. The review queue on the Command Center can."
          className="flex h-[52px] cursor-not-allowed items-center rounded-xl bg-ink px-[26px] text-[17px] font-semibold text-white opacity-50"
        >
          Approve &amp; Schedule
        </button>
      </div>
    </CalendarModal>
  );
}
