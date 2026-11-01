'use client';

import type { ReactElement, SVGProps } from 'react';
import { cn } from '@/lib/utils';
import { Busy } from '@/components/brand/SparkLoader';
import { TypeIcon, type PostType } from './DraftDrawer';
import { CarouselStoryboard, VideoStoryboard } from './Storyboard';
import { clock, type ResolvedBeat } from './types';
import {
  ArrowUpRightIcon,
  AvatarMusicIcon,
  AvatarPersonIcon,
  ClockIcon,
  GlobeIcon,
  InfoIcon,
  MusicTitleIcon,
  PaletteIcon,
  PremiumIcon,
  RatioIcon,
  RegenerateIcon,
  SlidesIcon,
  SmallPlusIcon,
  SparkleIcon,
  VoiceTitleIcon,
} from './icons';

/**
 * The `DP image` interior — the drawer's single-column form.
 *
 * ── Measured off the rendered prototype at 1728 ───────────────────────────
 *
 * Every number below came from `getBoundingClientRect` against
 * `ui build/DP image.dc.html`, not from a screenshot. The column sits 30px in
 * from the content pane and is 875 wide; there is no preview pane, because the
 * element at x1234 that looked like one turned out to be the Command Center
 * showing through a flattened export.
 *
 *   focus card    y139 · 875x240 · r15 · rgba(100,195,213,0.4)
 *     header      y152 · "Current Focus" 14/500, violet colon, "From:" pill
 *     title       y189 · 26.9/600
 *     facts       y239 · label 16/400 #838383, value 14/600 ink, 4px apart
 *     status      y326 · h35 · r7.78 · white 62%     ← inside the card
 *   "Image Post"  y412 · 22/600
 *   field label   y474 · 18/500 · #838383
 *   field box     y509 · 875x67 · r10.158 · white, value 18/500 ink
 *   concept head  y598 · 18/500, "Regenerate concept" right in #A341FF
 *   concept card  y634 · 875x114 · r10 · rgba(131,131,131,0.1)
 *     "Concept"   y648 · 20/500 ink, body y686 · 18/500 grey
 *   prompt label  y775 · 18/500
 *   prompt box    y814 · 875x111 · r10 · white, body 18/500 grey
 *   chips         y949 · 18/500 · #838383
 *   actions       y1026 · "Generate Post" 190x43 r8.46 ink; "Save as Draft" right
 *
 * ── Where the card's data comes from ──────────────────────────────────────
 *
 * Everything the design draws here is a fact about the *calendar*, not about
 * this draft, so the opener supplies it. The four chips are the four post types
 * in the rail and what each is doing on this date; the circles at y275 read as
 * collaborators in the design and a draft has none, so they show the accounts
 * that date is posting to — the nearest true thing, and real data either way.
 *
 * All of it was read as "a pipeline this product does not have" on the first
 * pass and left as a single chip, which is what made this card look emptier
 * than the design. `CalendarBoard` had every value already.
 *
 * ── "Regenerate concept" and "Save as Draft" ──────────────────────────────
 *
 * Both are props, so a phase that has nothing for them to do passes neither and
 * they do not render — that is the rule this file follows for every control.
 * The trigger phase now passes both, because both have a job there: Generate
 * Post drafts and opens the editor, Save as Draft drafts and closes the drawer,
 * and Regenerate concept rewrites the brief from the same intent.
 */

export interface ImageDraftFormProps {
  postType: PostType;
  campaignName?: string;
  goal?: string;
  campaignType?: string;
  duration?: string;
  source?: string;
  status: string;
  /**
   * What each post type is doing on this date — the design's four chips.
   *
   * One entry per type in the rail, in the rail's order. Supplied by whoever
   * opened the panel, because it is a fact about the *calendar* and not about
   * this draft; absent collapses the row to the draft's own status.
   */
  production?: Array<{ label: string; state: string; tone: 'work' | 'done' | 'idle' }>;
  /** The accounts this date is posting to — the design's circles at y275. */
  platforms?: string[];
  intent: string;
  onIntent: (next: string) => void;
  concept?: string;
  prompt: string;
  onPrompt: (next: string) => void;
  onRegenerate?: () => void;
  onGenerate: () => void;
  onSaveDraft?: () => void;
  busy?: boolean;
  /**
   * Why "Generate Post" cannot run yet, if it cannot.
   *
   * Not in the design, and here because of what clicking the button did
   * without it: `createDraft` returns early when no playbook is chosen, so the
   * panel's primary action was live, clickable, and completely silent. A
   * control that looks ready and does nothing is worse than one that says what
   * it is waiting for.
   */
  blockedReason?: string;

  /* ── Video and carousel ─────────────────────────────────────────────────
     `DP video` and `DP carousel` are the same form with a storyboard where the
     image state has a concept and a prompt. These are what fills it; all are
     optional, because the trigger phase has none of them yet. */

  /** The post's scenes or slides. Empty draws the storyboard's empty line. */
  beats?: ResolvedBeat[];
  /** The post's default voice — "Maya", "Warm, conversational". */
  voice?: { name: string; description?: string };
  /** The post's music bed — "Upbeat", "Modern, energetic loop". */
  music?: { name: string; description?: string };
  /** `en-US` and friends, shown in the settings row. */
  language?: string;
  onAddScene?: () => void;
  onRewriteScene?: (beatId: string) => void;
  onAudioOverride?: (beatId: string) => void;
}

/** 30px in from the content edge, 875 of 940 — the prototype's one column. */
const COLUMN = 'px-[30px]';

const TITLE: Record<PostType, string> = {
  image: 'Image Post',
  video: 'Video Post',
  carousel: 'Carousel Post',
  text: 'Text Post',
};

/**
 * The intent field's label, which the design words per state.
 *
 * `DP text` keeps "post" — it is `DP image` with one string changed and was not
 * re-worded — so `text` follows `image` rather than gaining a phrasing the
 * design does not use.
 */
export const ABOUT: Record<PostType, string> = {
  image: 'What is this post about?',
  video: 'What is this video about?',
  carousel: 'What is this carousel about?',
  text: 'What is this post about?',
};

export function ImageDraftForm({
  postType,
  campaignName,
  goal,
  campaignType,
  duration,
  source,
  production,
  platforms,
  status,
  intent,
  onIntent,
  concept,
  prompt,
  onPrompt,
  onRegenerate,
  onGenerate,
  onSaveDraft,
  busy,
  blockedReason,
  beats,
  voice,
  music,
  language,
  onAddScene,
  onRewriteScene,
  onAudioOverride,
}: ImageDraftFormProps) {
  const scenes = beats ?? [];
  return (
    // 16 below the tab row's hairline: the focus card's top is y112 of the
    // pane in every `DP` form, and the hairline is y95.
    <div className={cn(COLUMN, 'pt-[16px] pb-[30px]')}>
      {/* ── Focus card — y139, 240 tall ─────────────────────────────────── */}
      {/* A cyan wash at 8% inside a 1px sky ring at 40%. The 40% sky was being
          used as the fill, which painted the card several shades too dark. */}
      <section
        className="flex min-h-[240px] flex-col rounded-[15px] px-[25px] pt-[13px] pb-[18px]"
        style={{ background: 'rgba(108,232,255,0.08)', boxShadow: 'inset 0 0 0 1px rgba(100,195,213,0.4)' }}
      >
        <div className="flex flex-wrap items-center gap-[8px]">
          <span className="text-14 font-medium text-ink">Current Focus</span>
          {/* The separator is a violet colon, not a dot — `--ss-violet` is in
              the token file for exactly this label. */}
          <span className="text-16 font-medium text-violet">:</span>
          {/* Only when the opener said where this came from. The design's
              "From: Spark Chat" is the label for one entry point, not a default
              — printing it for a post opened from the calendar would be the
              card stating something untrue. */}
          {source ? (
            /* 27 tall, r8.79, the label 9px in — `DP video`'s pill, not a capsule. */
            <span
              className="flex h-[27px] items-center rounded-[8.786px] bg-white px-[9px] text-14 font-medium text-ink"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)' }}
            >
              From: {source}
            </span>
          ) : null}
        </div>

        <h2 className="mt-[7px] text-26 font-semibold leading-[1.26] text-ink">
          {campaignName ?? 'This post'}
        </h2>

        {/*
          Three columns, not a packed row.

          The design's facts start at x843, x1013 and x1180 — a fixed ~168px
          pitch — so they line up whatever the values say. Built as a flex row
          with a gap first, which looked right with the design's copy and
          bunched everything against the left edge the moment a real campaign
          had a short objective.
        */}
        <dl className="mt-[17px] grid grid-cols-[168px_167px_1fr] gap-y-[8px]">
          <Fact label="Goal" value={goal} />
          <Fact label="Type" value={campaignType} />
          <Fact label="Duration" value={duration} />
        </dl>

        {/*
          The circles at y275 — 30px, r50%, #F8F8F8, 44px pitch.

          They read as collaborators in the design, and a draft has none. What
          this date *does* have is the accounts its posts are going to, which
          the calendar knows slot by slot — so the row shows the channels this
          post will land on. Absent when the day has no platform chosen yet,
          which `content.list` treats as a real state rather than a blank.
        */}
        {platforms && platforms.length > 0 ? (
          <div className="mt-[16px] flex items-center gap-[14px]">
            {platforms.slice(0, 4).map((p) => (
              <span
                key={p}
                title={p}
                className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-11 font-semibold uppercase text-ink-muted"
                style={{ background: 'var(--ss-surface-100)', boxShadow: 'inset 0 0 0 0.761px rgba(120,120,120,0.28)' }}
              >
                {p.slice(0, 2)}
              </span>
            ))}
          </div>
        ) : null}

        {/*
          Pinned to the card's foot — y326 in the design, 18px above its edge.

          The design draws four chips: "Generating", "Completed", "No post",
          "No post". They are the four post types in the rail, and what each one
          is doing on this date — which the calendar already knows, slot by
          slot. When the caller has no such view (a post opened from somewhere
          with no campaign behind it) the row falls back to the one status this
          draft genuinely carries, rather than four slots of invention.
        */}
        <div className="mt-auto flex flex-wrap items-center gap-[6px] pt-[24px]">
          {production && production.length > 0 ? (
            production.map((p) => (
              <StatusChip key={p.label} label={p.state} tone={p.tone} type={p.label as PostType} />
            ))
          ) : (
            <StatusChip label={statusLabel(status)} tone={statusTone(status)} />
          )}
        </div>
      </section>

      {/* ── The form ────────────────────────────────────────────────────── */}
      <h3 className="mt-[33px] text-22 font-semibold text-ink">{TITLE[postType]}</h3>

      <label className="mt-[29px] block text-18 font-medium text-ink-muted" htmlFor="dp-intent">
        {ABOUT[postType]}
      </label>
      <input
        id="dp-intent"
        value={intent}
        onChange={(e) => onIntent(e.target.value)}
        placeholder="Announce the new pricing plan"
        className={cn(
          'mt-[12px] h-[67px] w-full rounded-[10.158px] bg-white px-[25px] text-18 font-medium text-ink outline-none placeholder:text-ink-placeholder focus:shadow-[0_0_0_2px_var(--ss-ring)]',
          /* The prototypes split here: image and text lift the field on a
             violet glow, video and carousel outline it in grey at 30%. */
          postType === 'video' || postType === 'carousel'
            ? 'shadow-[inset_0_0_0_1px_rgba(131,131,131,0.3)]'
            : 'shadow-[0_4px_15px_0_rgba(163,65,255,0.2)]',
        )}
      />

      {/*
        Video: the settings card, then the storyboard.

        `DP video` replaces the concept/prompt pair with a card of post-wide
        defaults — aspect, running time, language, and the voice and music every
        scene inherits — followed by the scene list. Both are measured in
        `Storyboard.tsx`; this is the card above it.
      */}
      {postType === 'video' ? (
        <>
          <div
            className="mt-[18px] rounded-[10px] px-[21px] py-[19px]"
            style={{ background: 'rgba(131,131,131,0.05)', boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
          >
            <div className="flex flex-wrap items-center gap-[36px]">
              <Chip label="9:16" mark="ratio" />
              <Chip label={`${clock(totalSeconds(scenes))} total`} mark="clock" />
              {language ? <Chip label={language} mark="globe" /> : null}
            </div>

            <div className="mt-[24px] grid grid-cols-1 gap-[16px] md:grid-cols-2">
              <DefaultCard title="Voice (default)" pill="Ai Voice" value={voice} kind="voice" />
              {/*
                The design titles this card "Voice (default)" too and fills it
                with "Upbeat / Modern, energetic loop". Two cards with one title
                and different contents is an authoring slip in the export, not a
                spec — so the music card is titled for what it holds.
              */}
              <DefaultCard title="Music (default)" pill="Ai Music" value={music} kind="music" ringed />
            </div>

            <p className="mt-[14px] flex items-center gap-[3.277px] text-14 font-medium text-ink-muted">
              <InfoIcon className="shrink-0" />
              Each scene below uses these defaults — override per scene as needed
            </p>
          </div>

          {/* The full-width rule 25 below the card, then 34 to the heading —
              y828 and y863 in `DP video`. */}
          <Rule className="mt-[25px]" />
          <h4 className="mt-[34px] text-18 font-medium text-ink">AI storyboard</h4>
          <VideoStoryboard
            beats={scenes}
            voiceName={voice?.name}
            onAddScene={onAddScene}
            onRewrite={onRewriteScene}
            onAudioOverride={onAudioOverride}
            busy={busy}
          />
        </>
      ) : null}

      {/*
        Carousel: a chip row, then the slides. No settings card — the design
        gives a carousel three chips and goes straight to the storyboard.
      */}
      {postType === 'carousel' ? (
        <>
          <div className="mt-[22px] flex flex-wrap items-center gap-[37px]">
            <Chip label="4:5" mark="ratio" />
            <Chip label="Brand template" mark="palette" />
            <Chip label={scenes.length === 1 ? '1 slide' : `${scenes.length} slides`} mark="slides" />
          </div>

          {/* `DP carousel`'s rule at y610: 18 under the chips, 22 over the heading. */}
          <Rule className="mt-[18px]" />
          <div className="mt-[22px] flex items-baseline justify-between gap-4">
            <span className="text-18 font-medium text-ink">AI storyboard</span>
            {onRegenerate ? (
              <button
                type="button"
                onClick={onRegenerate}
                disabled={busy}
                className="flex items-center gap-[9.063px] text-18 font-medium text-brand-purple hover:underline disabled:opacity-50"
              >
                <RegenerateIcon className="shrink-0" />
                Regenerate concept
              </button>
            ) : null}
          </div>

          <CarouselStoryboard beats={scenes} onAddScene={onAddScene} busy={busy} />
        </>
      ) : null}

      {/* Image and text: the concept card and the editable prompt. */}
      {postType === 'image' || postType === 'text' ? (
        <>
      <div className="mt-[22px] flex items-baseline justify-between gap-4">
        <span className="text-18 font-medium text-ink">AI image concept</span>
        {onRegenerate ? (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={busy}
            className="flex items-center gap-[9.063px] text-18 font-medium text-brand-purple hover:underline disabled:opacity-50"
          >
            <RegenerateIcon className="shrink-0" />
            Regenerate concept
          </button>
        ) : null}
      </div>

      <div
        className="mt-[13px] min-h-[114px] rounded-[10px] px-[19px] py-[14px]"
        style={{ background: 'rgba(131,131,131,0.1)', boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
      >
        {/* The card has a heading of its own — 20/500 ink at y648, above the
            grey body at y686. */}
        <p className="text-20 font-medium text-ink">Concept</p>
        <p className="mt-[13px] text-18 font-medium leading-[1.28] text-ink-muted">
          {concept ?? 'No concept yet — generating the post writes one.'}
        </p>
      </div>

      <label className="mt-[27px] block text-18 font-medium text-ink" htmlFor="dp-prompt">
        Prompt (editable)
      </label>
      <textarea
        id="dp-prompt"
        value={prompt}
        onChange={(e) => onPrompt(e.target.value)}
        rows={3}
        placeholder="Describe the shot: subject, light, framing."
        /* White and unringed, as `DP image` draws it — the design separates
           this box from the pane by its label alone. */
        className="mt-[12px] min-h-[111px] w-full resize-y rounded-[10px] bg-white px-[25px] py-[18px] text-18 font-medium leading-[1.28] text-ink-muted outline-none placeholder:text-ink-placeholder focus:shadow-[0_0_0_2px_var(--ss-ring)]"
      />

      <div className="mt-[17px] flex flex-wrap items-center gap-[22px]">
        <Chip label="4:5" mark="ratio" />
        <Chip label="Brand colors" mark="palette" />
        <Chip label="Premium" mark="premium" />
      </div>
        </>
      ) : null}

      {/*
        The rule over the actions, 20 above them — y979 / y999 in `DP image`,
        y1749 / y1769 in `DP carousel`. It sits 34 under the image chips and 17
        under the carousel's last strip. `DP video` draws none: its actions
        follow the storyboard card 22 below it.
      */}
      {postType === 'video' ? null : <Rule className={postType === 'carousel' ? 'mt-[17px]' : 'mt-[34px]'} />}
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-4',
          postType === 'video' ? 'mt-[22px]' : 'mt-[19px]',
        )}
      >
        {/*
          190x43: the sparkle at 11,11, the label centred in the next 115px,
          and the up-right arrow 9 after it — the prototype's own row. The
          export paints the sparkle #000 on the #0C0C0C button, which is
          invisible; it takes the label's white here.
        */}
        <button
          type="button"
          onClick={onGenerate}
          disabled={busy || Boolean(blockedReason)}
          title={blockedReason}
          className="flex h-[43px] w-[190px] items-center rounded-[8.457px] bg-ink pl-[11px] text-17 font-medium text-white disabled:opacity-60"
        >
          <SparkleIcon className="shrink-0" />
          <span className="ml-[7.421px] w-[115px] text-center">
            {busy ? <Busy>Generating…</Busy> : 'Generate Post'}
          </span>
          <ArrowUpRightIcon className="ml-[9px] shrink-0" />
        </button>

        {/* 168x44 white, the plus 27 in and the label centred in 102 after it. */}
        {onSaveDraft ? (
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={busy}
            className="flex h-[44px] w-[168px] items-center rounded-[8.457px] bg-white pl-[27px] text-16 font-medium text-ink hover:underline disabled:opacity-50"
          >
            <SmallPlusIcon className="shrink-0" />
            <span className="ml-[9px] w-[102px] text-center">Save as Draft</span>
          </button>
        ) : null}
      </div>

      {blockedReason ? <p className="mt-[10px] text-14 text-ink-muted">{blockedReason}</p> : null}
    </div>
  );
}

/**
 * `Goal - Get more leads` — label #838383 16/400, value ink 14/600, 5px apart.
 *
 * Renders its column even with no value, so the three stay aligned; an absent
 * fact shows an em dash rather than collapsing and dragging the next one left.
 */
function Fact({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-baseline gap-[5px]">
      <dt className="text-16 text-ink-muted">{label} -</dt>
      <dd className="text-14 font-semibold text-ink">{value ?? '—'}</dd>
    </div>
  );
}

/**
 * A post-wide default — the voice and music cards in `DP video`.
 *
 * 409x122 r13.84 white, a 15.27/500 title with a tinted pill on the right, and
 * an inner 387x64 r10 card carrying a 48px avatar, a name and a description.
 * Renders nothing when the post has no such default rather than an empty card,
 * since the settings block above it already says the post has none.
 *
 * `ringed` because the two cards differ: every video prototype draws the voice
 * card bare and the music card inside a 1px grey ring at 20%. The inner card
 * carries that ring in both.
 *
 * The prototype's inner card also carries a chevron at its right edge, which
 * reads as "pick another voice". There is no voice picker behind it — the
 * default voice is the brand's, set in the kit — so it is not drawn.
 */
function DefaultCard({
  title,
  pill,
  value,
  kind,
  ringed,
}: {
  title: string;
  pill: string;
  value?: { name: string; description?: string };
  /** Which glyph the title and the avatar carry — a mic, or a note. */
  kind: 'voice' | 'music';
  ringed?: boolean;
}) {
  return (
    <div
      className="rounded-[13.839px] bg-white px-[10px] pb-[10px] pt-[13px]"
      style={ringed ? { boxShadow: '0 0 0 1px rgba(131,131,131,0.2)' } : undefined}
    >
      <div className="flex items-center justify-between gap-3 px-[22px]">
        {/* The glyph hangs left of the 32px text edge — 15.75 in for the mic,
            15 for the note — so the title keeps its column. Black, as drawn. */}
        <span
          className={cn(
            'flex items-center text-15 font-medium text-ink',
            kind === 'voice' ? '-ml-[16.249px] gap-[4.751px]' : '-ml-[17px] gap-[4px]',
          )}
        >
          {kind === 'voice' ? (
            <VoiceTitleIcon className="shrink-0 text-black" />
          ) : (
            <MusicTitleIcon className="shrink-0 text-black" />
          )}
          {title}
        </span>
        <span
          className="flex h-[26px] items-center rounded-[12.381px] px-[12px] text-12 font-medium"
          style={{ color: 'var(--ss-purple)', background: 'rgba(163,65,255,0.2)' }}
        >
          {pill}
        </span>
      </div>

      {value ? (
        <div
          className="mt-[14px] flex items-center gap-[10px] rounded-[10px] bg-white px-[9px] py-[8px]"
          style={{ boxShadow: '0 0 0 1px rgba(131,131,131,0.2)' }}
        >
          <span
            aria-hidden
            className="relative h-[48px] w-[48px] shrink-0 rounded-[13.331px]"
            style={{ background: 'rgba(108,232,255,0.4)' }}
          >
            {kind === 'voice' ? (
              <AvatarPersonIcon className="absolute left-[14.769px] top-[12.305px] text-ink" />
            ) : (
              <AvatarMusicIcon className="absolute left-[12px] top-[13.773px] text-black" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-18 font-medium text-ink-muted">{value.name}</p>
            {value.description ? (
              <p className="text-15 font-medium text-ink-muted">{value.description}</p>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mt-[14px] px-[22px] pb-[10px] text-15 font-medium text-ink-muted">
          Not set — this post uses the brand default.
        </p>
      )}
    </div>
  );
}

/** The storyboard's running time, from the scenes that declare one. */
function totalSeconds(beats: ResolvedBeat[]): number {
  return beats.reduce((sum, b) => sum + (b.durationSec ?? 0), 0);
}

/**
 * A settings chip — the prototype's glyph, then its label.
 *
 * Different glyphs, not three squares. A repeated bordered square next to a
 * label is a checkbox everywhere else in this app, and these are statements
 * about the post, not toggles.
 */
function Chip({ label, mark }: { label: string; mark: ChipMarkKind }) {
  const { Icon, slot } = MARK[mark];
  return (
    <span className="flex items-center text-18 font-medium text-ink-muted">
      {/* The glyph sits in a slot as wide as the prototype's label offset, so
          the words start exactly where they do there. */}
      <span className="flex shrink-0 items-center" style={{ width: slot }}>
        <Icon />
      </span>
      {label}
    </span>
  );
}

type ChipMarkKind = 'ratio' | 'palette' | 'slides' | 'premium' | 'clock' | 'globe';

/**
 * Each chip's glyph and where its label starts — the prototypes' own pairs:
 * `9:16` / `4:5` at +27, the clock and globe at +25, the palette at +22, the
 * slide stack at +27, Premium's badge at +24.
 */
const MARK: Record<ChipMarkKind, { Icon: (props: SVGProps<SVGSVGElement>) => ReactElement; slot: number }> = {
  ratio: { Icon: RatioIcon, slot: 27 },
  clock: { Icon: ClockIcon, slot: 25 },
  globe: { Icon: GlobeIcon, slot: 25 },
  palette: { Icon: PaletteIcon, slot: 22 },
  slides: { Icon: SlidesIcon, slot: 27 },
  premium: { Icon: PremiumIcon, slot: 24 },
};

/**
 * A full-width hairline — 25% grey across the whole 940 content pane, not just
 * the 875 column, which is how every `DP` form draws its section rules.
 */
function Rule({ className }: { className?: string }) {
  return <div aria-hidden className={cn('-mx-[30px] h-px', className)} style={{ background: 'rgba(131,131,131,0.25)' }} />;
}

/**
 * A status chip — 35 tall, r7.78.
 *
 * Two grounds, as the design draws them: a chip with something happening sits
 * on white at 62% inside a 10% ink ring, in black ("Generating") or the
 * design's #1FAF13 green ("Completed"); an idle "No post" sits on sky at 21%
 * inside a 10% grey ring, in grey. The green is the prototype's, not
 * `--ss-success` (#13D711) — the two are visibly different side by side, and
 * #1FAF13 is already this panel's green (`--ss-scene-cta`). The glyph takes the
 * chip's text colour.
 */
function StatusChip({
  label,
  tone,
  type,
}: {
  label: string;
  tone: 'work' | 'done' | 'idle';
  type?: PostType;
}) {
  return (
    <span
      className={cn(
        'flex h-[35px] items-center gap-[7px] rounded-[7.776px] px-[14px] text-14 font-medium',
        tone === 'done' ? 'text-[color:var(--ss-scene-cta)]' : tone === 'work' ? 'text-black' : 'text-ink-muted',
      )}
      style={
        tone === 'idle'
          ? { background: 'rgba(105,186,201,0.21)', boxShadow: 'inset 0 0 0 0.885px rgba(131,131,131,0.1)' }
          : { background: 'rgba(255,255,255,0.62)', boxShadow: 'inset 0 0 0 0.885px rgba(12,12,12,0.1)' }
      }
      // Four chips reading "No post" are indistinguishable without it. The
      // design gives each one a leading glyph and this is which type it is.
      title={type ? `${type[0]!.toUpperCase()}${type.slice(1)}` : undefined}
    >
      {type ? (
        <span className="shrink-0 [&>svg]:h-[17px] [&>svg]:w-[17px]">
          <TypeIcon type={type} active={tone !== 'idle'} stroke="currentColor" />
        </span>
      ) : (
        <span aria-hidden className="h-[9px] w-[9px] rounded-full bg-current" />
      )}
      {label}
    </span>
  );
}

function statusLabel(status: string): string {
  if (status === 'published') return 'Published';
  if (status === 'scheduled') return 'Scheduled';
  if (status === 'blocked') return 'Blocked';
  if (status === 'failed') return 'Failed';
  if (status === 'needs_review') return 'Waiting for approval';
  return 'Draft';
}

function statusTone(status: string): 'work' | 'done' | 'idle' {
  if (status === 'published') return 'done';
  if (status === 'scheduled' || status === 'needs_review') return 'work';
  return 'idle';
}
