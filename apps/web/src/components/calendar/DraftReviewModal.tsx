'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import { CalendarModal } from './CalendarModal';
import { postKindLabel } from '@/lib/platforms';
import { Busy } from '@/components/brand/SparkLoader';

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
 * ── The picture, which the design does not draw ───────────────────────────
 *
 * The prototype shows a caption, agent notes and a platform icon, and no
 * image — its example is a Reel, where the caption is most of the decision.
 * Followed literally that is what this screen was: a post of kind **Image**,
 * with a finished 1:1 render sitting in R2, asking to be approved for
 * publishing with the picture nowhere on screen. Reported as "I am not seeing
 * the images of the posts that are image type", which is exactly what it was.
 *
 * So this deviates from `SparkSocial Calendar.dc.html` deliberately, and only
 * by addition: the layout, type and spacing below are untouched, and the
 * visual goes above the caption where the design leaves whitespace. Approving
 * an image you have not seen is not a thing to be faithful about.
 *
 * ── What it can and cannot do ─────────────────────────────────────────────
 *
 * The read was `content.list` filtered to the one item, under a comment saying
 * no `content.get` existed. One does — it is what returns `beats` and
 * `renders`, so without it this screen had no picture available to show even
 * if it had wanted to. Approving is the honest gap: the design's
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

/** The half of `content.get` this screen needs: what the post looks like. */
export interface Visuals {
  /** Finished files from `compose.render` — the post as it will go out. */
  renders?: Array<{ aspect: string; url: string; engine: string }>;
  beats?: Array<{
    kind: string;
    url?: string;
    /** Auto-illustration's output, which leaves the beat's kind as `text`. */
    backdrop?: { kind: 'image' | 'video'; urls: string[] };
  }>;
}

/**
 * The one frame worth showing, in the order that answers "what goes out?".
 *
 * A composed render first, because that file *is* the post — square before
 * vertical only because this modal's well is wider than it is tall. Then a
 * beat's own generated media, then auto-illustration's backdrop, which is the
 * case that matters most here: it attaches to a beat without changing the
 * beat's kind, so a post can be fully illustrated while every beat still
 * reads as `text`. That is why checking `kind` alone found nothing.
 *
 * Video is shown with controls rather than autoplaying: this is a review of
 * the decision to publish, and a clip that starts talking when a modal opens
 * is answering a question nobody asked.
 */
export function previewFrame(v: Visuals | null): { url: string; kind: 'image' | 'video' } | undefined {
  const square = v?.renders?.find((r) => r.aspect === '1:1') ?? v?.renders?.[0];
  if (square) return { url: square.url, kind: 'image' };

  for (const beat of v?.beats ?? []) {
    if (beat.kind === 'generated_image' && beat.url) return { url: beat.url, kind: 'image' };
    const first = beat.backdrop?.urls[0];
    if (first) return { url: first, kind: beat.backdrop?.kind === 'video' ? 'video' : 'image' };
  }

  return undefined;
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
  const [visuals, setVisuals] = useState<Visuals | null>(null);

  useEffect(() => {
    if (!genomeId) return;
    let cancelled = false;
    void (async () => {
      /*
       * The list carries the status, slot and kind this header reads;
       * `content.get` carries the beats and renders, which is the only place a
       * picture exists. Both, because neither alone fills the screen.
       *
       * Requested together rather than in sequence: the header does not depend
       * on the picture, so there is nothing to gain by waiting.
       */
      const [list, full] = await Promise.all([
        invoke<{ items: Item[] }>('content.list', { genomeId, limit: 100 }),
        invoke<Visuals>('content.get', { genomeId, contentItemId }),
      ]);
      if (cancelled) return;

      if (list.status !== 'succeeded') {
        setItem('missing');
      } else {
        setItem(list.output.items.find((i) => i.contentItemId === contentItemId) ?? 'missing');
      }

      /* A failed read means no picture, not a broken modal — the caption and
         the route into the Draft Panel are still worth having. */
      setVisuals(full.status === 'succeeded' ? full.output : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [genomeId, contentItemId]);

  const it = item !== null && item !== 'missing' ? item : null;
  const frame = previewFrame(visuals);

  return (
    <CalendarModal kind="review" label="Draft review" onClose={onClose}>
      <div className="px-[50px] pt-[44px]">
        <p className="text-center text-28 font-bold leading-[1.2] text-ink">Draft Review</p>
        <p className="mt-[14px] text-center text-18 font-normal text-ink-muted">
          Review Sparks generated content before publishing
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-[28px] gap-y-2 px-[50px] pt-[30px]">
        <p className="text-19 font-bold text-ink">
          Draft: {it ? (STATUS_WORD[it.status] ?? it.status) : '—'}
        </p>
        {it ? (
          <>
            <p className="text-19 font-medium text-ink-muted">
              {postKindLabel(it.platform, it.mediaType)}
            </p>
            <p className="text-19 font-medium text-ink-muted">
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

      {frame ? (
        <div className="px-[50px] pt-[26px]">
          <p className="text-18 font-normal text-ink-muted">
            {frame.kind === 'video' ? 'Video Preview' : 'Image Preview'}
          </p>
          <div
            className="mt-[12px] overflow-hidden rounded-2xl bg-white"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.08)' }}
          >
            {frame.kind === 'video' ? (
              <video src={frame.url} controls className="mx-auto max-h-[260px]" />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={frame.url}
                alt="How this post will look"
                className="mx-auto max-h-[260px] object-contain"
              />
            )}
          </div>
        </div>
      ) : null}

      <div className="px-[50px] pt-[26px]">
        <p className="text-18 font-normal text-ink-muted">Caption Preview</p>
        <div
          className="mt-[12px] max-h-[196px] overflow-y-auto rounded-2xl bg-white px-[26px] py-[22px]"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.08)' }}
        >
          <p className="text-20 font-bold leading-[1.35] text-ink">
            {item === null
              ? <Busy size={16}>Loading…</Busy>
              : item === 'missing'
                ? 'This draft could not be found.'
                : it && it.summary && it.summary !== '(no copy yet)'
                  ? it.summary
                  : 'Not written yet — SPARK writes the copy the morning it goes out.'}
          </p>
        </div>
      </div>

      <div className="px-[50px] pt-[24px]">
        <p className="text-19 font-semibold text-ink">Agent Notes</p>
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
          className="flex h-[52px] items-center rounded-xl bg-white px-[22px] text-17 font-semibold text-ink"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.2)' }}
        >
          Open in Draft Panel
        </button>
        <button
          type="button"
          disabled
          title="Approve it from Needs Attention on the Command Center."
          className="flex h-[52px] cursor-not-allowed items-center rounded-xl bg-ink px-[26px] text-17 font-semibold text-white opacity-50"
        >
          Approve &amp; Schedule
        </button>
      </div>
    </CalendarModal>
  );
}
