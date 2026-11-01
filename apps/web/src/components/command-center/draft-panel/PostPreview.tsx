'use client';

import { useRef, useState } from 'react';
import { PLATFORM_LIMITS, platformTakes, type PostFormat } from '@sparksocial/shared';
import { cn } from '@/lib/utils';
import { Busy } from '@/components/brand/SparkLoader';
import { backdropOf, type DraftView } from './types';
import {
  ArrowUpRightIcon,
  CalendarIcon,
  ChevronIcon,
  ClockIcon,
  CommentIcon,
  GeneratedIcon,
  LikeIcon,
  PencilIcon,
  RegenerateIcon,
  ShareIcon,
  SmallPlusIcon,
} from './icons';

/**
 * The preview — `DP prevText.dc.html`, "Review your post".
 *
 * ── What it replaces ──────────────────────────────────────────────────────
 *
 * A bordered box with the caption as plain text and, under it, whichever beats
 * happened to have `kind: 'generated_*'`. Auto-illustration attaches media
 * without changing a beat's kind, so an illustrated post previewed as a
 * paragraph and nothing else — and the composed video, which the render queue
 * had already made, was not shown at all because the panel only ever held
 * renders that came back from a `compose.render` *it* had just called.
 *
 * The design's answer is the post as it will appear: a real post card with the
 * brand's avatar and name, the copy, the media, and the platform's own
 * engagement row beneath it.
 *
 * ── Measured off the rendered prototype at 1728 ───────────────────────────
 *
 *   "Post preview"   x821 y147 · 15/500 grey
 *   card             x817 y183 · 872 wide · r10 · white
 *     avatar         x841 y201 · 63x63 · r76 · #CFFCCF, initials 27.9/500 #13AD12
 *     name           x915 y211 · 18/500 grey
 *     "Sponsored ·"  x915 y239 · 15/500 grey
 *     body           x844 y289 · 647 wide · 18/500 grey
 *     Like/Comment/Share  y543 · x867 / x946 / x1068 · 16/400 grey
 *   "Character count by platform" y609 · 15/500 grey
 *   counts card      x817 y642 · 872x91 · r10 · grey 10%
 *   "Publish to"     y766 · 15/500 grey
 *   platform pills   y797 · h35 · r100 — chosen #B3F3FF, over-limit
 *                    rgba(243,85,37,0.32), unavailable rgba(131,131,131,0.2)
 *   schedule card    x817 y860 · 872x103 · r10 · grey 10%
 *     best time      x830 y908 · 744x41 · r10 · rgba(163,65,255,0.2), 16/600 #A341FF
 *   actions          y1023 — "Publish now" 190x43 ink; "Schedule" 110x44
 *                    rgba(36,116,237,0.1); "Save as Draft" 168x44 white
 */

export interface PostPreviewProps {
  draft: DraftView;
  /** The caption exactly as it will be sent, hashtags and short link included. */
  caption: string;
  /** The brand's display name, for the post card's byline. */
  brandName?: string;
  /** Where this post is going. Empty means no account has been chosen yet. */
  platforms: string[];
  /** Every platform the picker offers. */
  options: readonly string[];
  /** The one currently chosen to publish to. */
  selected: string;
  onSelect: (platform: string) => void;
  /** The brand's posting window for this date, when one is known. */
  bestTime?: string;
  /** "Edit outline" — the storyboard is where a slide is actually changed. */
  onEditOutline?: () => void;
  onPublish: () => void;
  onSchedule?: () => void;
  onSaveDraft: () => void;
  busy?: boolean;
  /** The header's back box — the way to the editor `DP prevText` draws. */
  onBack?: () => void;
  /** When the post is set to go, for the date and time pickers to start from. */
  scheduledAt?: string;
  /**
   * Move the post to a new moment — what the schedule card's calendar and clock
   * boxes do. The panel's own `content.schedule`; absent hides both boxes.
   */
  onReschedule?: (iso: string) => void;
}

/** `CF` from `ClientForce AI` — two letters, the design's own treatment. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '··';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/**
 * Every piece of media the post carries, in order.
 *
 * The composed render first when there is one: that file *is* the post, and a
 * preview that shows the raw ingredients above the finished cut answers a
 * different question than "what goes out". The per-beat media follows for a
 * post that has not been composed yet.
 */
function mediaOf(draft: DraftView): Array<{ kind: 'image' | 'video'; url: string }> {
  const rendered = (draft.renders ?? []).map((r) => ({
    kind: r.url.endsWith('.mp4') ? ('video' as const) : ('image' as const),
    url: r.url,
  }));
  /*
    `.slice(0, 1)` for everything except a carousel, and that exception is the
    whole bug. For a video or an image there is one composed file and it *is*
    the post. A carousel's renders are its slides — six files, one per slide —
    so taking the first one turned a six-slide carousel into a single image,
    which is exactly how it looked on the deployed site.
  */
  if (rendered.length > 0) return draft.mediaType === 'carousel' ? rendered : rendered.slice(0, 1);

  const out: Array<{ kind: 'image' | 'video'; url: string }> = [];
  for (const b of draft.beats) {
    if (b.kind === 'generated_image') out.push({ kind: 'image', url: b.url });
    else if (b.kind === 'generated_video' || b.kind === 'generated_broll') out.push({ kind: 'video', url: b.url });
    else if (b.kind === 'dubbed_media' && b.mediaType === 'video') out.push({ kind: 'video', url: b.url });
    const back = backdropOf(b);
    if (back) for (const u of back.urls) out.push({ kind: back.kind, url: u });
  }
  return out;
}

/**
 * How each platform judges this caption's length.
 *
 * `PLATFORM_LIMITS` is the mechanical number — what the API rejects — and it is
 * the right one here, because this row is answering "will this send", not "is
 * this a good length". A platform the brand has not connected still gets a row:
 * the design shows one greyed out, and knowing X would refuse it is useful
 * before you connect X.
 */
function counts(caption: string): Array<{ platform: string; limit: number; over: boolean }> {
  return Object.entries(PLATFORM_LIMITS).map(([platform, limits]) => ({
    platform,
    limit: limits.maxLength,
    over: caption.length > limits.maxLength,
  }));
}


/**
 * A carousel, previewed as a carousel.
 *
 * ── What it replaces ─────────────────────────────────────────────────────
 *
 * Every slide, stacked vertically, in a one-column grid. That is a contact
 * sheet, not a preview: nobody scrolling Instagram sees six images at once,
 * they see the first one and decide whether to swipe. A reviewer looking at
 * the stack cannot tell whether slide 1 earns the swipe, which is the only
 * question a carousel preview has to answer. It also read as a single image
 * when only one slide had been rendered, which is how this was reported.
 *
 * `DP prevCarousel.dc.html` shows one slide in a 4:5 frame, arrows either
 * side, "Slide 2 of 6" above it and a numbered pager below. That is this.
 *
 * ── The pager is the point ───────────────────────────────────────────────
 *
 * Both controls are here on purpose. The arrows are how you read it in order,
 * the way the post is consumed; the numbered pager is how you jump to the
 * slide somebody has complained about. Keyboard arrows do the same, because a
 * reviewer going through six slides should not have to aim at a 28px target
 * six times.
 */
function CarouselDeck({
  media,
  label,
  onEditOutline,
}: {
  media: Array<{ kind: 'image' | 'video'; url: string }>;
  label: string;
  /** "Edit outline" — back to the storyboard, which is where slides are changed. */
  onEditOutline?: () => void;
}) {
  const [at, setAt] = useState(0);
  /*
    "All slides", from the design's own button row.

    One slide at a time is how the post is read and how you judge whether slide
    1 earns the swipe. It is the wrong view for "does this hang together" —
    that question is about the sequence, and answering it one slide at a time
    means holding five slides in your head. Both views, one button.
  */
  const [grid, setGrid] = useState(false);
  const total = media.length;
  const current = media[Math.min(at, total - 1)]!;
  const go = (next: number) => setAt(((next % total) + total) % total);

  return (
    <div
      className="mt-[20px]"
      role="group"
      aria-roledescription="carousel"
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(at - 1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); go(at + 1); }
      }}
    >
      {/*
        "Slide 2 of 6" 18/500 grey at the left of a row as wide as the frame,
        the two bare chevrons at its right end, 25 apart — `DP prevCarousel`'s
        arrangement. The frame below carries nothing at its sides.
      */}
      <div className="flex items-center justify-between">
        <p className="text-18 font-medium text-ink-muted" aria-live="polite">
          Slide {at + 1} of {total}
        </p>
        {grid ? null : (
          <div className="flex items-center gap-[25px] text-ink-muted">
            <button type="button" aria-label="Previous slide" onClick={() => go(at - 1)} className="flex items-center">
              <ChevronIcon className="-scale-x-100" />
            </button>
            <button type="button" aria-label="Next slide" onClick={() => go(at + 1)} className="flex items-center">
              <ChevronIcon />
            </button>
          </div>
        )}
      </div>

      {grid ? (
        <div className="mt-[10px] grid grid-cols-2 gap-[10px]">
          {media.map((m, i) => (
            <button
              key={m.url + i}
              type="button"
              aria-label={`Open slide ${i + 1}`}
              onClick={() => {
                setAt(i);
                setGrid(false);
              }}
              className="flex aspect-[4/5] items-center justify-center overflow-hidden rounded-[10px]"
              style={{ background: 'rgba(131,131,131,0.1)' }}
            >
              {m.kind === 'video' ? (
                <video src={m.url} className="h-full w-full object-contain" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={`Slide ${i + 1}`} className="h-full w-full object-contain" />
              )}
            </button>
          ))}
        </div>
      ) : (
      <div
        className="mt-[14px] flex aspect-[4/5] items-center justify-center overflow-hidden rounded-[10px]"
        style={{ background: 'rgba(131,131,131,0.1)', boxShadow: 'inset 0 0 0 0.3px rgba(131,131,131,0.3)' }}
      >
        {current.kind === 'video' ? (
          <video src={current.url} controls className="h-full w-full object-contain" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.url} alt={`Slide ${at + 1} of ${total}`} className="h-full w-full object-contain" />
        )}
      </div>
      )}

      <div className="mt-[12px] flex flex-wrap items-center justify-center gap-[6px]">
        {media.map((m, i) => (
          <button
            key={m.url + i}
            type="button"
            aria-label={`Go to slide ${i + 1}`}
            aria-current={i === at ? 'true' : undefined}
            onClick={() => setAt(i)}
            className="flex h-[28px] w-[28px] items-center justify-center rounded-[6px] text-13 font-medium transition-colors"
            /*
              `DP prevCarousel`'s pager: black numerals throughout, the current
              one on a pale cyan in a hairline of deeper cyan, the rest on grey
              at 10% in a grey hairline. (This read `--ss-ink` and
              `--ss-ink-muted`, neither of which exists, so both fell through to
              whatever colour the button inherited.)
            */
            style={
              i === at
                ? { background: 'rgb(212,248,255)', boxShadow: 'inset 0 0 0 0.226px rgb(38,159,182)', color: 'rgb(0,0,0)' }
                : { background: 'rgba(133,133,133,0.1)', boxShadow: 'inset 0 0 0 0.226px rgb(131,131,131)', color: 'rgb(0,0,0)' }
            }
          >
            {i + 1}
          </button>
        ))}
      </div>

      <p className="mt-[10px] text-center text-13 text-ink-muted">4:5 &middot; 1080&times;1350</p>

      {/*
        The design's two buttons under the frame, at 875,697 and 1030,697 in
        16/500 ink. "Edit outline" is the storyboard — the one place a slide's
        words and picture are actually changed — rather than a second editor
        grown inside the preview.
      */}
      {/* 155x46 chips, r9.04, a 1.07px ink ring at 40% over white at 7% — the
          cycle arrows on one, the pencil on the other, 9 apart. */}
      <div className="mt-[14px] flex flex-wrap items-center justify-center gap-[9px]">
        <button
          type="button"
          onClick={() => setGrid((g) => !g)}
          className="flex h-[46px] w-[155px] items-center justify-center gap-[9.134px] rounded-[9.036px] text-16 font-medium text-ink"
          style={CHIP}
        >
          <RegenerateIcon className="shrink-0" />
          {grid ? 'One at a time' : 'All slides'}
        </button>
        {onEditOutline ? (
          <button
            type="button"
            onClick={onEditOutline}
            className="flex h-[46px] w-[155px] items-center justify-center gap-[8.315px] rounded-[9.036px] text-16 font-medium text-ink"
            style={CHIP}
          >
            <PencilIcon width={14.396} height={14.394} className="shrink-0" />
            Edit outline
          </button>
        ) : null}
      </div>
    </div>
  );
}

const CHIP = { background: 'rgba(255,255,255,0.07)', boxShadow: '0 0 0 1.068px rgba(12,12,12,0.4)' } as const;

/**
 * The post card — `DP prevText.dc.html`, and only that.
 *
 * Avatar, byline, copy, media, and the platform's engagement row: a text post
 * previewed as a post. The media formats do not use it, because their design
 * does not — see the layout note on `PostPreview`.
 */
function PostCard({
  name,
  draft,
  caption,
  media,
}: {
  name: string;
  draft: DraftView;
  caption: string;
  media: Array<{ kind: 'image' | 'video'; url: string }>;
}) {
  return (
    <article className="rounded-[10px] bg-white px-[24px] pt-[18px] pb-[20px] shadow-[0_0_0_1px_rgba(131,131,131,0.2)]">
      <header className="flex items-center gap-[10px]">
        <span
          aria-hidden
          className="flex h-[63px] w-[63px] items-center justify-center rounded-full text-28 font-medium"
          style={{ background: '#CFFCCF', color: '#13AD12' }}
        >
          {initials(name)}
        </span>
        <span>
          <span className="block text-18 font-medium text-ink-muted">{name}</span>
          {/*
            "Sponsored ·" in the design, which this is not — nothing here buys
            placement. The line below it is what the post actually is: an
            organic post, and when it is scheduled, when it goes.
          */}
          <span className="mt-[6px] block text-15 font-medium text-ink-muted">
            {draft.scheduledAt
              ? new Date(draft.scheduledAt).toLocaleString('en', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })
              : 'Not scheduled yet'}
          </span>
        </span>
      </header>

      <p className="mt-[28px] whitespace-pre-wrap text-18 font-medium leading-[1.5] text-ink-muted">
        {caption || '(no written copy)'}
      </p>

      {media.length > 0 ? (
        <div className="mt-[20px] grid grid-cols-1 gap-[10px]">
          {media.map((m, i) =>
            m.kind === 'video' ? (
              <video key={m.url + i} src={m.url} controls className="max-h-[420px] w-full rounded-[10px] bg-black/5" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={m.url + i} src={m.url} alt="" className="max-h-[420px] w-full rounded-[10px] object-contain" />
            ),
          )}
        </div>
      ) : null}

      {/* No rule above the engagement row in `DP prevText`; the border stays,
          transparent, so the row keeps its place. */}
      <footer className="mt-[24px] flex items-center gap-[26px] border-t border-transparent pt-[16px] text-ink-muted">
        {/* Each glyph and its word at the prototype's own offsets: 23, 22, 23
            from the glyph's left edge to the word's. */}
        <span aria-hidden className="flex items-center gap-[4.02px] text-16">
          <LikeIcon className="shrink-0" />
          Like
        </span>
        <span aria-hidden className="flex items-center gap-[5.572px] text-16">
          <CommentIcon className="shrink-0" />
          Comment
        </span>
        <span aria-hidden className="flex items-center gap-[7.123px] text-16">
          <ShareIcon className="shrink-0" />
          Share
        </span>
      </footer>
    </article>
  );
}

/**
 * The media column of the two-column preview — `DP prevImage` / `prevCarousel`.
 *
 * 324x405 at the 1728 stage, which is 4:5 exactly, with the format printed
 * under it in 18/500 grey. A carousel puts its deck here; everything else puts
 * its one composed file.
 */
function MediaPane({
  draft,
  media,
  caption,
  onEditOutline,
}: {
  draft: DraftView;
  media: Array<{ kind: 'image' | 'video'; url: string }>;
  caption: string;
  onEditOutline?: () => void;
}) {
  if (media.length === 0) {
    return (
      <p
        className="rounded-[10px] px-[18px] py-[16px] text-16 text-ink-muted"
        style={{ background: 'rgba(131,131,131,0.1)' }}
      >
        Nothing has been rendered for this post yet — render it from the editor and it appears here.
      </p>
    );
  }

  if (draft.mediaType === 'carousel') {
    return (
      <CarouselDeck
        media={media}
        label={caption.slice(0, 60) || 'Carousel preview'}
        {...(onEditOutline ? { onEditOutline } : {})}
      />
    );
  }

  const one = media[0]!;
  return (
    <div>
      {/* `DP prevImage` / `prevVideo`'s frame: a faint horizontal grey fall
          inside a 30% grey ring, rather than a flat grey. */}
      <div
        className="flex aspect-[4/5] items-center justify-center overflow-hidden rounded-[10px]"
        style={{
          background:
            'linear-gradient(270deg, rgba(224,224,224,0.1) 0%, rgba(29,29,29,0.06) 48.38%, rgba(131,131,131,0.034) 100%)',
          boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)',
        }}
      >
        {one.kind === 'video' ? (
          <video src={one.url} controls className="h-full w-full object-contain" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={one.url} alt="" className="h-full w-full object-contain" />
        )}
      </div>
      <p className="mt-[10px] text-18 font-medium text-ink-muted">4:5 &middot; 1080&times;1350</p>
    </div>
  );
}

export function PostPreview({
  draft,
  caption,
  brandName,
  platforms,
  options,
  selected,
  onSelect,
  bestTime,
  onEditOutline,
  onPublish,
  onSchedule,
  onSaveDraft,
  busy,
  onBack,
  scheduledAt,
  onReschedule,
}: PostPreviewProps) {
  /*
    The calendar and clock boxes open the browser's own date and time pickers.
    The inputs are visually hidden rather than absent so `showPicker` has
    something to open; the chosen value lands on the post through
    `onReschedule`, keeping the half that was not changed.
  */
  const dateInput = useRef<HTMLInputElement>(null);
  const timeInput = useRef<HTMLInputElement>(null);
  const base = () => {
    const d = scheduledAt ? new Date(scheduledAt) : new Date();
    if (!scheduledAt) d.setHours(9, 0, 0, 0);
    return d;
  };
  const pick = (input: HTMLInputElement | null) => {
    if (!input) return;
    if (typeof input.showPicker === 'function') input.showPicker();
    else input.click();
  };
  const name = brandName?.trim() || 'Your brand';
  const media = mediaOf(draft);
  const lengths = counts(caption);

  /*
    ── One column or two ──────────────────────────────────────────────────

    This file was built from `DP prevText.dc.html` and applied that layout to
    every format. Half right: the prototypes disagree with each other on
    purpose, and the disagreement is the design.

    Measured at the 1728 stage, `prevText` is one column — "Post preview" at
    821,147, the engagement row at y543, the character counts at y609. But
    `prevImage` and `prevCarousel` are two: the media at 822,184 in a 324x405
    frame (4:5 exactly), and a 493-wide column from x1195 holding the caption,
    the platforms and the schedule. Both media prototypes place their pieces at
    identical coordinates, so it is one layout for both rather than a carousel
    special case.

    Which follows from what each is for. A text post has nothing to look at but
    the words, so the preview is the post. A post with media asks two questions
    — is the picture right, is the copy right — and the design puts one on each
    side so neither answer requires scrolling past the other.
  */
  const twoColumn = draft.mediaType !== 'text';

  /* ── The caption, with the one action the design gives it ───────────── */
  const captionPane = (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-15 font-medium text-ink-muted">AI-written caption</p>
        {/*
          "Rewrite" in the design, in its purple. That control already exists
          one phase back as "Ask for a change", which edits this copy with the
          same tools — so this names where it is instead of offering a second,
          differently-worded version of it.
        */}
        <span
          className="text-14 font-medium"
          style={{ color: '#A341FF' }}
          title="Edit the copy in the editor — Back to editor, then Ask for a change."
        >
          Rewrite in the editor
        </span>
      </div>
      <div className="mt-[14px] max-h-[167px] overflow-y-auto rounded-[10px] bg-white px-[20px] py-[16px] shadow-[0_4px_15px_0_rgba(163,65,255,0.2)]">
        <p className="whitespace-pre-wrap text-16 font-medium leading-[1.5] text-ink-muted">
          {caption || '(no written copy)'}
        </p>
      </div>
    </div>
  );

  /* ── Length, per platform ──────────────────────────────────────────── */
  const countsPane = (
    <div>
      <p className="text-15 font-medium text-ink-muted">Character count by platform</p>
      <div
        className="mt-[14px] flex flex-wrap items-center gap-x-[34px] gap-y-[10px] rounded-[10px] px-[22px] py-[18px]"
        style={{ background: 'rgba(131,131,131,0.1)', boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
      >
        {lengths.map((l) => (
          <span key={l.platform} className={cn('text-16 font-medium', l.over ? 'text-destructive' : 'text-ink-muted')}>
            {l.platform} {caption.length}/{l.limit}
          </span>
        ))}
      </div>
    </div>
  );

  /*
    ── Where it goes ──────────────────────────────────────────────────────

    One row, not two. This used to be a read-only list of the accounts the
    calendar slot had chosen, and the panel rendered a *second* "Publish to"
    underneath it — a row of buttons that actually set the target. Two headings
    with the same words, one inert and one live, on the same screen. The live
    one wins and the slot's accounts moved into the line beneath the row, which
    is where that fact belongs: context for the choice, not a second control.

    Unavailable is a state, not an omission. A platform that cannot carry this
    format stays in the row, greyed and unclickable, with the reason printed
    underneath — the design does exactly this for TikTok on a carousel. Hiding
    it would leave somebody looking for the platform they expected and finding
    nothing to explain its absence.
  */
  const publishPane = (
    <div>
      <p className="text-15 font-medium text-ink-muted">Publish to</p>
      <div className="mt-[14px] flex flex-wrap items-center gap-[11px]">
        {options.map((p) => {
          const limit = PLATFORM_LIMITS[p]?.maxLength;
          const over = limit !== undefined && caption.length > limit;
          const takes = platformTakes(p, draft.mediaType as PostFormat);
          const chosen = p === selected;
          return (
            <button
              key={p}
              type="button"
              disabled={!takes.ok}
              aria-pressed={chosen}
              {...(takes.reason ? { title: takes.reason } : {})}
              onClick={() => onSelect(p)}
              /*
                Four states, each the prototypes' own: chosen is #B3F3FF with
                black type; chosen-but-too-long is orange at 32% in a solid
                orange ring with grey type; available is grey at 10% in a 10%
                grey ring; unavailable is grey at 20% with its type faded to
                40% — the type, not the whole pill.
              */
              className={cn(
                'flex h-[35px] items-center rounded-full px-[18px] text-16 font-medium capitalize transition-colors',
                !takes.ok
                  ? 'cursor-not-allowed text-ink-muted/40'
                  : chosen && !over
                    ? 'text-black'
                    : 'text-ink-muted',
              )}
              style={
                !takes.ok
                  ? { background: 'rgba(131,131,131,0.2)' }
                  : over && chosen
                    ? { background: 'rgba(243,85,37,0.32)', boxShadow: '0 0 0 1px rgb(243,85,37)' }
                    : chosen
                      ? { background: 'rgb(179,243,255)' }
                      : { background: 'rgba(131,131,131,0.1)', boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.1)' }
              }
            >
              {p.replace('_', ' ')}
              {over && chosen ? ' (over limit)' : ''}
            </button>
          );
        })}
      </div>

      {/* The refusals, spelled out. One line per platform this post cannot use. */}
      {options
        .map((p) => ({ p, takes: platformTakes(p, draft.mediaType as PostFormat) }))
        .filter((x) => !x.takes.ok)
        .map((x) => (
          <p key={x.p} className="mt-[8px] text-13 text-ink-muted">
            {x.takes.reason}
          </p>
        ))}

      {/* What the calendar slot already decided, as context rather than a control. */}
      <p className="mt-[10px] text-13 text-ink-muted">
        {platforms.length > 0
          ? `This slot is set to ${platforms.join(', ')}.`
          : 'No account has been connected for this slot yet.'}
      </p>
    </div>
  );

  /* ── When ───────────────────────────────────────────────────────────── */
  /*
    `DP prevText`'s schedule card, 103 tall: its own "Schedule" label inside it
    at 13,16, the violet time pill at 13,48 with a sparkle 7 in, and two 41px
    ringed boxes at its right — a calendar and a clock — 8.9 apart and 17 from
    the edge.
  */
  const schedulePane =
    bestTime || onReschedule ? (
      <div className="rounded-[10px] px-[13px] pb-[14px] pt-[16px]" style={{ background: 'rgba(131,131,131,0.1)' }}>
        <p className="text-15 font-medium text-ink-muted">Schedule</p>
        <div className="mt-[13px] flex items-center gap-[7px] pr-[4px]">
          <div
            className="flex h-[41px] min-w-0 flex-1 items-center gap-[6px] rounded-[10px] pl-[7px] pr-[16px] text-16 font-semibold"
            style={{ background: 'rgba(163,65,255,0.2)', color: 'var(--ss-purple)' }}
          >
            <GeneratedIcon className="shrink-0 text-black" />
            <span className="truncate">{bestTime ?? 'Not scheduled yet'}</span>
          </div>
          {onReschedule ? (
            <>
              <button
                type="button"
                aria-label="Change the date"
                onClick={() => pick(dateInput.current)}
                disabled={busy}
                className="flex h-[41.097px] w-[41.097px] shrink-0 items-center justify-center rounded-[8.251px] text-ink-muted disabled:opacity-50"
                style={{ boxShadow: 'inset 0 0 0 0.636px rgb(131,131,131)' }}
              >
                <CalendarIcon />
              </button>
              <button
                type="button"
                aria-label="Change the time"
                onClick={() => pick(timeInput.current)}
                disabled={busy}
                className="ml-[1.9px] flex h-[41.097px] w-[41.097px] shrink-0 items-center justify-center rounded-[8.251px] text-ink-muted disabled:opacity-50"
                style={{ boxShadow: 'inset 0 0 0 1px rgb(131,131,131)' }}
              >
                <ClockIcon />
              </button>
              <input
                ref={dateInput}
                type="date"
                tabIndex={-1}
                aria-hidden
                className="sr-only"
                onChange={(e) => {
                  const [y, m, d] = e.target.value.split('-').map(Number);
                  if (!y || !m || !d) return;
                  const next = base();
                  next.setFullYear(y, m - 1, d);
                  onReschedule(next.toISOString());
                }}
              />
              <input
                ref={timeInput}
                type="time"
                tabIndex={-1}
                aria-hidden
                className="sr-only"
                onChange={(e) => {
                  const [h, min] = e.target.value.split(':').map(Number);
                  if (h === undefined || min === undefined || Number.isNaN(h) || Number.isNaN(min)) return;
                  const next = base();
                  next.setHours(h, min, 0, 0);
                  onReschedule(next.toISOString());
                }}
              />
            </>
          ) : null}
        </div>
      </div>
    ) : null;

  /*
    ── Actions ────────────────────────────────────────────────────────────

    "Publish now" at the left edge and the quieter pair at the right, which is
    where `prevCarousel` puts them: x828 against x1423 and x1571 on an 868-wide
    pane. The split is doing work — the irreversible one is nowhere near the
    two that are not.
  */
  const actions = (
    /* The rule runs the full 940 pane, 21 above the buttons (y975 / y996). */
    <div className="-mx-[30px] flex flex-wrap items-center justify-between gap-4 border-t border-border px-[30px] pt-[21px]">
      {/* 190x43: the label in its 97px from 17 in, the arrow at 147. */}
      <button
        type="button"
        onClick={onPublish}
        disabled={busy}
        className="flex h-[43px] w-[190px] items-center rounded-[8.457px] bg-ink pl-[17px] text-17 font-medium text-white disabled:opacity-60"
      >
        <span className="w-[97px] text-center">{busy ? <Busy>Publishing…</Busy> : 'Publish now'}</span>
        <ArrowUpRightIcon className="ml-[50px] shrink-0" />
      </button>

      <div className="flex items-center gap-[15px]">
        {onSchedule ? (
          <button
            type="button"
            onClick={onSchedule}
            disabled={busy}
            className="flex h-[44px] w-[110px] items-center justify-center rounded-[8.457px] text-16 font-medium disabled:opacity-60"
            style={{ background: 'rgba(36,116,237,0.1)', color: '#2474ED', boxShadow: '0 0 0 1px rgb(36,116,237)' }}
          >
            Schedule
          </button>
        ) : null}
        <button
          type="button"
          onClick={onSaveDraft}
          disabled={busy}
          className="flex h-[44px] w-[168px] items-center rounded-[8.457px] bg-white pl-[23px] text-16 font-medium text-ink disabled:opacity-60"
        >
          <SmallPlusIcon className="shrink-0" />
          <span className="ml-[9px] w-[102px] text-center">Save as Draft</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="px-[30px] pt-[18px] pb-[30px]">
      {/*
        "Review your post" — 18/600 ink at 867,63, with the state beside it in
        14/600. The design's word is "Generated", which is true of a post that
        has pixels and false of one that does not, so it is read from the post
        rather than printed unconditionally.
      */}
      <div className="flex items-center gap-[17px]">
        {/* The 39x36 back box, r7.07 in a hairline grey ring, 15 left of the title. */}
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to the editor"
            className="mr-[-2px] flex h-[36px] w-[39px] shrink-0 items-center justify-center rounded-[7.072px] text-ink-muted"
            style={{ boxShadow: '0 0 0 0.707px rgb(131,131,131)' }}
          >
            <ChevronIcon className="-scale-x-100" />
          </button>
        ) : null}
        <h2 className="text-18 font-semibold text-ink">Review your post</h2>
        {/*
          124x33, r15.76: green at 15% in a solid green ring, a black sparkle 15
          in. A post with nothing rendered wears the same pill in grey and no
          sparkle — the design only drew the generated case.
        */}
        <span
          className="flex h-[33px] items-center gap-[5.695px] rounded-[15.758px] px-[15px] text-14 font-semibold"
          style={
            media.length > 0
              ? { background: 'rgba(19,215,17,0.15)', boxShadow: '0 0 0 1px rgb(19,215,17)', color: '#13D711' }
              : { background: 'rgba(131,131,131,0.1)', boxShadow: '0 0 0 1px rgba(131,131,131,0.4)', color: '#838383' }
          }
        >
          {media.length > 0 ? <GeneratedIcon className="shrink-0 text-black" /> : null}
          {media.length > 0 ? 'Generated' : draft.mediaType === 'text' ? 'Written' : 'Not rendered'}
        </span>
      </div>

      {twoColumn ? (
        /*
          324 + 49 + 493 = 866 on the design's 868-wide pane. The left column is
          fixed because 4:5 at a fixed width is what the format is; the right
          one takes the rest. Below `canvas` they stack, media first — the order
          the two questions get asked in.
        */
        <div className="mt-[28px] flex items-start gap-[49px] max-canvas:flex-col max-canvas:gap-[24px]">
          <div className="w-[324px] shrink-0 max-canvas:w-full">
            <MediaPane draft={draft} media={media} caption={caption} {...(onEditOutline ? { onEditOutline } : {})} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-[28px] max-canvas:w-full">
            {captionPane}
            {publishPane}
            {schedulePane}
            {countsPane}
          </div>
        </div>
      ) : (
        <div className="mt-[28px] flex flex-col gap-[28px]">
          <PostCard name={name} draft={draft} caption={caption} media={media} />
          {countsPane}
          {publishPane}
          {schedulePane}
        </div>
      )}

      <div className="mt-[40px]">{actions}</div>
    </div>
  );
}
