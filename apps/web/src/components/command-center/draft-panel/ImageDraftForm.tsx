'use client';

import { cn } from '@/lib/utils';
import { TypeIcon, type PostType } from './DraftDrawer';
import { CarouselStoryboard, VideoStoryboard } from './Storyboard';
import { clock, type ResolvedBeat } from './types';

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
const ABOUT: Record<PostType, string> = {
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
    <div className={cn(COLUMN, 'pt-[27px] pb-[30px]')}>
      {/* ── Focus card — y139, 240 tall ─────────────────────────────────── */}
      <section
        className="flex min-h-[240px] flex-col rounded-[15px] px-[25px] pt-[13px] pb-[18px]"
        style={{ background: 'rgba(100,195,213,0.4)' }}
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
            <span className="rounded-full bg-white/60 px-[12px] py-[4px] text-14 font-medium text-ink">
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
                style={{ background: 'var(--ss-surface-100)' }}
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
        className="mt-[12px] h-[67px] w-full rounded-[10.158px] bg-white px-[25px] text-18 font-medium text-ink shadow-[0_1px_0_rgba(12,12,12,0.06),0_0_0_1px_rgba(131,131,131,0.18)] outline-none placeholder:text-ink-placeholder focus:shadow-[0_0_0_2px_var(--ss-ring)]"
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
            style={{ background: 'rgba(131,131,131,0.05)' }}
          >
            <div className="flex flex-wrap items-center gap-[36px]">
              <Chip label="9:16" mark="ratio" />
              <Chip label={`${clock(totalSeconds(scenes))} total`} mark="clock" />
              {language ? <Chip label={language} mark="globe" /> : null}
            </div>

            <div className="mt-[24px] grid grid-cols-1 gap-[16px] md:grid-cols-2">
              <DefaultCard title="Voice (default)" pill="Ai Voice" value={voice} />
              {/*
                The design titles this card "Voice (default)" too and fills it
                with "Upbeat / Modern, energetic loop". Two cards with one title
                and different contents is an authoring slip in the export, not a
                spec — so the music card is titled for what it holds.
              */}
              <DefaultCard title="Music (default)" pill="Ai Music" value={music} />
            </div>

            <p className="mt-[14px] text-14 font-medium text-ink-muted">
              Each scene below uses these defaults — override per scene as needed
            </p>
          </div>

          <h4 className="mt-[60px] text-18 font-medium text-ink">AI storyboard</h4>
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
            <Chip label={scenes.length === 1 ? '1 slide' : `${scenes.length} slides`} mark="grade" />
          </div>

          <div className="mt-[41px] flex items-baseline justify-between gap-4">
            <span className="text-18 font-medium text-ink">AI storyboard</span>
            {onRegenerate ? (
              <button
                type="button"
                onClick={onRegenerate}
                disabled={busy}
                className="text-18 font-medium text-brand-purple hover:underline disabled:opacity-50"
              >
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
            className="text-18 font-medium text-brand-purple hover:underline disabled:opacity-50"
          >
            Regenerate concept
          </button>
        ) : null}
      </div>

      <div
        className="mt-[13px] min-h-[114px] rounded-[10px] px-[19px] py-[14px]"
        style={{ background: 'rgba(131,131,131,0.1)' }}
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
        className="mt-[12px] min-h-[111px] w-full resize-y rounded-[10px] bg-white px-[25px] py-[18px] text-18 font-medium leading-[1.28] text-ink-muted shadow-[0_0_0_1px_rgba(131,131,131,0.18)] outline-none placeholder:text-ink-placeholder focus:shadow-[0_0_0_2px_var(--ss-ring)]"
      />

      <div className="mt-[17px] flex flex-wrap items-center gap-[22px]">
        <Chip label="4:5" mark="ratio" />
        <Chip label="Brand colors" mark="palette" />
        <Chip label="Premium" mark="grade" />
      </div>
        </>
      ) : null}

      <div className="mt-[52px] flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={onGenerate}
          disabled={busy || Boolean(blockedReason)}
          title={blockedReason}
          className="flex h-[43px] w-[190px] items-center justify-center gap-[10px] rounded-[8.457px] bg-ink text-17 font-medium text-white disabled:opacity-60"
        >
          <Sparkle />
          {busy ? 'Generating…' : 'Generate Post'}
          <Sparkle className="h-[11px] w-[11px]" />
        </button>

        {onSaveDraft ? (
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={busy}
            className="flex items-center gap-[8px] text-16 font-medium text-ink hover:underline disabled:opacity-50"
          >
            Save as Draft
            <Sparkle />
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
 * A settings chip — a ~20px outline mark, 6px from its label.
 *
 * Three different glyphs, not three squares. A repeated bordered square next to
 * a label is a checkbox everywhere else in this app, and these are statements
 * about the image, not toggles — the first build of this row read as three
 * unticked options nobody could tick.
 */
/**
 * A post-wide default — the voice and music cards in `DP video`.
 *
 * 409x122 r13.84 white, a 15.27/500 title with a tinted pill on the right, and
 * an inner 387x64 r10 card carrying a 48px avatar, a name and a description.
 * Renders nothing when the post has no such default rather than an empty card,
 * since the settings block above it already says the post has none.
 */
function DefaultCard({
  title,
  pill,
  value,
}: {
  title: string;
  pill: string;
  value?: { name: string; description?: string };
}) {
  return (
    <div className="rounded-[13.839px] bg-white px-[10px] pb-[10px] pt-[13px]">
      <div className="flex items-center justify-between gap-3 px-[22px]">
        <span className="text-15 font-medium text-ink">{title}</span>
        <span
          className="flex h-[26px] items-center rounded-[12.381px] px-[12px] text-12 font-medium"
          style={{ color: 'var(--ss-purple)', background: 'rgba(163,65,255,0.2)' }}
        >
          {pill}
        </span>
      </div>

      {value ? (
        <div className="mt-[14px] flex items-center gap-[10px] rounded-[10px] bg-white px-[9px] py-[8px]">
          <span
            aria-hidden
            className="h-[48px] w-[48px] shrink-0 rounded-[13.331px]"
            style={{ background: 'rgba(108,232,255,0.4)' }}
          />
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

function Chip({ label, mark }: { label: string; mark: ChipMarkKind }) {
  return (
    <span className="flex items-center gap-[6px] text-18 font-medium text-ink-muted">
      <ChipMark mark={mark} />
      {label}
    </span>
  );
}

type ChipMarkKind = 'ratio' | 'palette' | 'grade' | 'clock' | 'globe';

function ChipMark({ mark }: { mark: ChipMarkKind }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    className: 'shrink-0',
  } as const;
  if (mark === 'ratio') {
    return (
      <svg {...common} aria-hidden>
        <rect x="6" y="3" width="12" height="18" rx="2.5" />
      </svg>
    );
  }
  if (mark === 'clock') {
    return (
      <svg {...common} aria-hidden>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (mark === 'globe') {
    return (
      <svg {...common} aria-hidden>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.5 12h17M12 3.5c2.2 2.4 3.3 5.3 3.3 8.5s-1.1 6.1-3.3 8.5c-2.2-2.4-3.3-5.3-3.3-8.5S9.8 5.9 12 3.5z" />
      </svg>
    );
  }
  if (mark === 'palette') {
    return (
      <svg {...common} aria-hidden>
        <path d="M12 3a9 9 0 100 18 2.2 2.2 0 001.8-3.5c-.6-.8 0-2 1-2H17a4 4 0 004-4c0-4.7-4-8.5-9-8.5z" />
        <circle cx="8" cy="10" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden>
      <path d="M12 3l2.3 6.1L20.5 11l-6.2 2L12 19l-2.3-6L3.5 11l6.2-1.9z" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A status chip — 35 tall, r7.78, on white at 62%.
 *
 * The design's "Completed" green is #1FAF13 and the app's is `--ss-success`
 * (#13D711). The token wins: one green for one meaning beats a second green
 * that exists only on this panel.
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
        'flex h-[35px] items-center gap-[7px] rounded-[7.776px] bg-white/[0.62] px-[14px] text-14 font-medium',
        tone === 'done' ? 'text-success' : tone === 'work' ? 'text-ink' : 'text-ink-muted',
      )}
      // Four chips reading "No post" are indistinguishable without it. The
      // design gives each one a leading glyph and this is which type it is.
      title={type ? `${type[0]!.toUpperCase()}${type.slice(1)}` : undefined}
    >
      {type ? (
        <span className="shrink-0 [&>svg]:h-[17px] [&>svg]:w-[17px]">
          <TypeIcon type={type} active={tone !== 'idle'} />
        </span>
      ) : (
        <span
          aria-hidden
          className={cn(
            'h-[9px] w-[9px] rounded-full',
            tone === 'done' ? 'bg-success' : tone === 'work' ? 'bg-ink' : 'bg-ink-muted',
          )}
        />
      )}
      {label}
    </span>
  );
}

/** The mark on both action buttons — four-pointed, not a text asterisk. */
function Sparkle({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn('h-[13px] w-[13px] shrink-0', className)}
    >
      <path d="M12 0l2.4 8.2L22.6 11 14.4 13.4 12 22l-2.4-8.6L1.4 11l8.2-2.8z" />
    </svg>
  );
}

function statusLabel(status: string): string {
  if (status === 'published') return 'Published';
  if (status === 'scheduled') return 'Scheduled';
  if (status === 'blocked') return 'Blocked';
  if (status === 'needs_review') return 'Waiting for approval';
  return 'Draft';
}

function statusTone(status: string): 'work' | 'done' | 'idle' {
  if (status === 'published') return 'done';
  if (status === 'scheduled' || status === 'needs_review') return 'work';
  return 'idle';
}
