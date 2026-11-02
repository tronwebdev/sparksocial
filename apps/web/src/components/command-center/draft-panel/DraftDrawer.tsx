'use client';

import { SparkMark } from '@/components/brand/SparkMark';
import { CloseDraftIcon } from './icons';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The Draft Panel's shell — `DP image.dc.html` and its twenty siblings.
 *
 * ── What it replaces ──────────────────────────────────────────────────────
 *
 * A centred 640px modal with a title and a "Close" link. The prototype is a
 * different thing entirely: a drawer anchored to the right edge over a blurred
 * Command Center, with its own post-type rail down the left side and the page
 * still legible behind it. The old modal was not a smaller version of this; it
 * was a different interaction.
 *
 * ── Measured, not estimated ───────────────────────────────────────────────
 *
 * Read with `getBoundingClientRect` against the rendered prototype at its true
 * 1728px stage, per CLAUDE.md's rule about the `.dc.html` files being the
 * source of truth:
 *
 *   drawer      x637 y27 · 1091x1064   → 63.1% of the stage, flush right
 *   radius      24.38 / 10.158 / 10.158 / 24.38  (round left, near-square right)
 *   rail        637…788 · 151 wide
 *   content     x788 · 940x1063 · r24.38
 *   rail labels y302 · 429 · 555 · 682  → 126.7 pitch, 14/500
 *   rail tiles  75x75 · r15.69 · idle grey 5% + 10% ring; active white, hued inner square
 *   orb         x651 y40 · 126x126
 *   "Post Type" y183 · 14/600 · ink-500
 *   tab chip    x820 y52 · 174x44 · r10 · #6CE8FF
 *   tab label   18/600 active, 18/500 inactive
 *   Close Draft x595 y486 · 42x145 · r10 · 18/500 — on the drawer's *outside* edge
 *
 * ── Proportional width, exact radii ───────────────────────────────────────
 *
 * The prototype is one fixed width and says nothing about narrower windows, so
 * the drawer takes its share as a percentage and the rail keeps its 151px —
 * a rail that shrank would crop its icons, where the content area has text that
 * reflows. The radii are absolute because they are the drawer's shape, not its
 * size.
 */

export type PostType = 'image' | 'video' | 'carousel' | 'text';

/** y302 · y429 · y555 · y682 in the prototype — 126.7 apart, in this order. */
export const POST_TYPES: Array<{ id: PostType; label: string }> = [
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'carousel', label: 'Carousel' },
  { id: 'text', label: 'Text' },
];

export type DrawerTab = 'current' | 'list';

export function DraftDrawer({
  postType,
  onPostType,
  typeFixed,
  tab,
  onTab,
  onClose,
  bare,
  children,
}: {
  postType: PostType;
  onPostType: (next: PostType) => void;
  /**
   * The post already is something, so the rail reports rather than asks.
   *
   * See `PostTypeRail`. Unset while composing, set once a draft is loaded.
   */
  typeFixed?: boolean;
  tab: DrawerTab;
  onTab: (next: DrawerTab) => void;
  onClose: () => void;
  /**
   * No tab row, and the content owns the whole pane — `DP genImage` and its
   * siblings draw their own header where the tabs sit, and a footer pinned to
   * the pane's foot, so they need the height rather than a scroll box.
   */
  bare?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Draft">
      {/*
        The Command Center stays readable behind it.

        `backdrop-blur` rather than a flat scrim: the prototype blurs the page
        instead of hiding it, which is what makes this a drawer over a screen
        rather than a modal that replaced one. Clicking it closes, which the
        vertical tab also does — a drawer with only one way out is a modal
        wearing a drawer's clothes.
      */}
      <button
        type="button"
        aria-label="Close draft"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/30 backdrop-blur-[10px]"
      />

      {/*
        Inset, not full-bleed.

        The prototype's drawer runs y27…y1091 inside a 1117 stage — 27 above and
        26 below — so the Command Center's own rounded canvas stays visible top
        and bottom. Full height made it read as a page replacing a page rather
        than a panel sliding over one.
      */}
      <div className="pointer-events-none absolute inset-x-0 top-[27px] bottom-[26px] flex justify-end">
        {/*
          1091 of 1728. Capped so the rail does not swallow a narrow window.

          The 520px floor is what stops the drawer collapsing into a column on
          a laptop, and the one thing in the app that is wider than a phone by
          declaration rather than by accident: at 430 it would hold itself 90px
          off the right edge, with no scroll container to recover it. Below
          `canvas` the floor goes and the drawer is simply the width of the
          screen.
        */}
        <div className="pointer-events-auto relative flex h-full w-full max-w-[min(63.1%,1091px)] min-w-[520px] max-canvas:min-w-0">
          {/*
            "Close Draft", outside the drawer's left edge.

            Vertical, and the prototype puts it *outside* the panel rather than
            in a corner of it — the affordance belongs to the page it is
            covering, not to the thing covering it.

            42x145, r10, flush against the drawer's edge, with the prototype's
            close mark below the words — vertical-rl runs the label top to
            bottom and the 180° turn makes it read upward, so the mark, first
            in the DOM, lands at the bottom where `DP video` draws it.
          */}
          <button
            type="button"
            onClick={onClose}
            className="absolute -left-[42px] top-1/2 flex h-[145px] w-[42px] -translate-y-1/2 items-center justify-center gap-[7.555px] rounded-[10px] text-18 font-medium text-ink"
            style={{
              writingMode: 'vertical-rl',
              transform: 'translateY(-50%) rotate(180deg)',
              // White at the outer edge falling to a pale cyan against the
              // drawer — the prototype's own fill. Written pre-rotation, so the
              // cyan stop is on the left here and lands on the right on screen.
              background: 'linear-gradient(90deg, rgb(214,242,248) 1.96%, rgb(255,255,255) 98.03%)',
            }}
          >
            <CloseDraftIcon className="shrink-0" />
            Close Draft
          </button>

          {/*
            The drawer's ground is one wash under both the rail and the content.

            `DP image` paints its 1089x1063 body with a pink rising from the
            bottom left over a cyan falling from the top right, on white, and
            sets the content pane on top as a white r24.38 card — so the rail
            shows the wash and the content does not. The rail used to carry a
            gradient of its own, which no prototype draws. The violet glow
            round the edge is the prototype's own shadow.
          */}
          <div
            className="flex h-full w-full overflow-hidden"
            style={{
              borderRadius: '24.38px 10.158px 10.158px 24.38px',
              background:
                'linear-gradient(236.713deg, rgba(255,255,255,0) 21.77%, rgba(245,107,255,0.2) 90.50%), ' +
                'linear-gradient(229.925deg, rgb(213,248,255) 6.28%, rgba(255,255,255,0) 81.45%), ' +
                'rgb(255,255,255)',
              boxShadow: '0px 4px 30px 0px rgb(163,65,255)',
            }}
          >
            {/*
              The list is the one state with no rail.

              `DP list.dc.html` puts its header at x678 — left of the content
              pane's own x788 — so the list runs the drawer's full width. Which
              follows: the rail picks what *this* post is, and the list is not
              one post.

              The orb stays. `DP list` keeps the rail's 126px Spark mark where
              the rail drew it — 14 in, 13 down — with the tabs moved right of it
              (x820, 183 in) and the tab row's hairline starting at x786 under
              them. Dropping it with the rail left the list as the one drawer
              state without the mark.
            */}
            {tab === 'list' ? (
              <div aria-hidden className="pointer-events-none absolute left-[14px] top-[13px] z-10 max-canvas:hidden">
                <SparkMark size={126} decorative />
              </div>
            ) : null}
            {tab === 'list' ? null : (
              <PostTypeRail active={postType} onSelect={onPostType} fixed={typeFixed ?? false} />
            )}

            {/* White beside the rail; the list has no rail and sits on the wash
                itself, as `DP list` draws it. */}
            <div
              className={cn(
                'flex min-w-0 flex-1 flex-col',
                tab === 'list' ? '' : 'overflow-hidden rounded-[24.378px] bg-white',
              )}
            >
              {bare ? null : <DrawerTabs tab={tab} onTab={onTab} />}
              <div className={cn('min-h-0 flex-1', bare ? 'overflow-hidden' : 'overflow-y-auto')}>{children}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The post-type rail — the drawer's own navigation.
 *
 * Each item is a state in the prototype set (`DP image`, `DP video`,
 * `DP carousel`, `DP text`), so this is the control that drives them.
 *
 * Those four files turn out to differ from each other in one string — the
 * heading over the form. `DP text` is `DP image` with "Text Post" in place of
 * "Image Post", down to the "AI image concept" block and the 4:5 chip, and its
 * rail still highlights Image. So the rail changes the heading and nothing
 * else, which is what the design says, rather than what a text post would
 * plausibly want.
 */
function PostTypeRail({
  active,
  onSelect,
  fixed,
}: {
  active: PostType;
  onSelect: (next: PostType) => void;
  fixed: boolean;
}) {
  /*
    ── Why three of these four are dead once a draft is open ──────────────

    The rail picked which editor to show and nothing else. On a carousel
    draft, pressing "Image" swapped in the image editor for a post that is
    not an image — same six slides underneath, a form that cannot describe
    them, and no indication that anything was wrong. It did not convert the
    draft, because nothing here can: the format is settled at plan time by the
    playbook, and the beats, the render and the platform rules all follow from
    it.

    So once a draft is loaded the rail states the format instead of offering
    it. The real "I want this as something else" is `content.repurpose`, which
    is already in the editor under "Want this as a different format?" — it
    makes a *new* draft and leaves this one alone, which is the only honest
    version of the operation.
  */
  const reason = 'This draft is already a ' + active + '. Use "Want this as a different format?" below to repurpose it.';
  return (
    <nav
      aria-label="Post type"
      // Transparent: the wash behind it belongs to the drawer — see `DraftDrawer`.
      className="flex w-[151px] shrink-0 flex-col items-center px-[14px] pt-[13px]"
    >
      {/* The Spark orb — 126x126 at y40, 13px below the drawer's top edge. It
          was a gradient ball with no face; it is the mark. */}
      <SparkMark size={126} decorative />

      <span className="mt-[17px] text-14 font-semibold text-ink-muted">Post Type</span>

      {/* 126.7 apart: a 75 tile, a 6 gap, the label, and the rest to the next. */}
      <ul className="mt-[14px] flex w-full flex-col items-center gap-[17.4px]">
        {POST_TYPES.map((t) => {
          const on = t.id === active;
          return (
            <li key={t.id} className="w-full">
              <button
                type="button"
                aria-current={on ? 'true' : undefined}
                disabled={fixed && !on}
                {...(fixed && !on ? { title: reason } : {})}
                onClick={() => onSelect(t.id)}
                className={cn(
                  'flex w-full flex-col items-center gap-[6px] py-[4px]',
                  fixed && !on ? 'cursor-not-allowed opacity-40' : '',
                )}
              >
                {/*
                  A 75x75 tile, r15.69 — measured, not a card.

                  Idle, every tile is grey at 5% inside a 1.165px grey ring.
                  Chosen, the tile turns white and carries a 58.5px r12.33
                  square tinted in the type's own hue, with the glyph in that
                  hue at full strength — amber for video, violet for image,
                  blue for carousel, magenta for text, one per prototype. The
                  cyan-at-20% this used to use is `DP prevText`'s *generated*
                  badge on a tile, not its selection. The label stays 14/500
                  throughout and only its colour changes.
                */}
                <span
                  aria-hidden
                  className="relative flex h-[75px] w-[75px] items-center justify-center rounded-[15.689px] transition-colors"
                  /*
                    Inline, not `bg-[rgba(...)]`.

                    Written as arbitrary Tailwind values first, and the two
                    classes came out crossed: the Text tile carried
                    `bg-[rgba(108,232,255,0.2)]` in its `className` and computed
                    to grey, while the Image tile carried the grey class and
                    computed to cyan. Whatever the escaping does to a comma-laden
                    `rgba()` in a selector, the rule it generates cannot be
                    trusted — and it fails while the markup looks correct, which
                    is the worst way for it to fail. The focus card sets its own
                    rgba the same way for the same reason.
                  */
                  style={on ? undefined : { background: 'rgba(131,131,131,0.05)', boxShadow: 'inset 0 0 0 1.165px rgba(131,131,131,0.1)' }}
                >
                  {on ? (
                    /*
                      The chosen tile is not the 75 square: it is 116x73 from the
                      same left edge, long enough to run 2-3px under the content
                      pane, so the white tile and the white pane read as one
                      shape — a tab joined to the page it opens. Drawn
                      absolutely so the column keeps its 75px slot and the label
                      stays centred under it, as it does in the prototype; `z-10`
                      lifts it over the pane, which comes later in the DOM.
                    */
                    <span className="absolute left-0 top-0 z-10 h-[73px] w-[116px] rounded-[15.689px] bg-white">
                      <span
                        className="absolute flex h-[58.547px] w-[58.547px] items-center justify-center rounded-[12.326px]"
                        style={{ left: TYPE_HUE[t.id].at[0], top: TYPE_HUE[t.id].at[1], background: TYPE_HUE[t.id].tint }}
                      >
                        <TypeIcon type={t.id} active stroke={TYPE_HUE[t.id].ink} />
                      </span>
                    </span>
                  ) : (
                    <TypeIcon type={t.id} active={false} />
                  )}
                </span>
                <span
                  className={cn('text-14 font-medium', on && TYPE_HUE[t.id].label === 'ink' ? 'text-ink' : 'text-ink-muted')}
                >
                  {t.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The chosen tile's hue per type — the inner square's tint and the glyph's ink.
 *
 * Read off the four prototypes whose rail chooses each one: `DP image`,
 * `DP video`, `DP carousel`, `DP text`. Image's tint is the one that differs in
 * alpha as well as hue (0.4 against 0.2), and that is the export's, not a typo.
 *
 * `at` is where the tinted square sits inside the 116x73 tile — the four
 * exports place it a few tenths apart, and each is followed.
 *
 * `label` is the chosen tile's caption colour, which the four disagree on: ink
 * under Image and Video, grey under Carousel and Text. Followed as drawn — the
 * tile itself is what marks the choice in all four.
 */
const TYPE_HUE: Record<PostType, { tint: string; ink: string; label: 'ink' | 'muted'; at: [number, number] }> = {
  image: { tint: 'rgba(232,207,255,0.4)', ink: 'rgb(134,45,218)', label: 'ink', at: [12, 7] },
  video: { tint: 'rgba(237,173,46,0.2)', ink: 'rgb(219,157,33)', label: 'ink', at: [8.007, 6.547] },
  carousel: { tint: 'rgba(45,86,219,0.2)', ink: 'rgb(45,86,219)', label: 'muted', at: [8.007, 7.102] },
  text: { tint: 'rgba(224,33,220,0.2)', ink: 'rgb(224,33,220)', label: 'muted', at: [8.007, 7.102] },
};

/** The four rail glyphs, drawn rather than imported — each is a few lines. */
export function TypeIcon({ type, active, stroke: ink }: { type: PostType; active: boolean; stroke?: string }) {
  const stroke = ink ?? (active ? 'var(--ss-ink-900)' : 'var(--ss-ink-500)');
  const common = { width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke, strokeWidth: 1.6 } as const;
  if (type === 'image') {
    return (
      <svg {...common} aria-hidden>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <circle cx="8.5" cy="9.5" r="1.6" />
        <path d="M4 17l4.5-4.5 3.5 3.5 3-2.5L20 17" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === 'video') {
    return (
      <svg {...common} aria-hidden>
        <rect x="3" y="5" width="13" height="14" rx="3" />
        <path d="M16 10.5l5-3v9l-5-3z" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === 'carousel') {
    return (
      <svg {...common} aria-hidden>
        <rect x="7" y="4" width="10" height="16" rx="2.5" />
        <path d="M4 7v10M20 7v10" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden>
      <path d="M5 6h14M12 6v12M9 18h6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Current Draft · Drafts List.
 *
 * The active tab is a cyan chip (174x44, r10, `#6CE8FF`) with 18/600 type; the
 * inactive one is 18/500 in ink-500 with no fill, only a 1px grey ring at 40%
 * — `DP video` and `DP list` both draw it. A hover tint is added on top.
 *
 * The two sit at opposite ends of the row, not side by side: every `DP *`
 * prototype puts Current Draft at the left (x864) and Drafts List at the right
 * (x1536), with only the unbound pencil beyond it. Measured on staging they
 * had been drawn together at the left.
 *
 * The row closes on the prototype's hairline at 25% grey, at y95 of the pane:
 * 25 above the 44px chips, 26 below them, then the 1px rule — painted as an
 * inset shadow on the row's last pixel.
 */
function DrawerTabs({ tab, onTab }: { tab: DrawerTab; onTab: (next: DrawerTab) => void }) {
  const list = tab === 'list';
  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center gap-[14px] pr-[32px] pt-[25px] pb-[27px]',
        // Right of the orb on the list — see `DraftDrawer`. Below `canvas` the orb goes and so does the inset.
        list ? 'pl-[183px] max-canvas:pl-[32px]' : 'pl-[32px]',
      )}
    >
      <span
        aria-hidden
        className={cn('absolute bottom-0 right-0 h-px', list ? 'left-[149px] max-canvas:left-0' : 'left-0')}
        style={{ background: 'rgba(131,131,131,0.25)' }}
      />
      {([
        { id: 'current' as const, label: 'Current Draft' },
        { id: 'list' as const, label: 'Drafts List' },
      ]).map((t) => {
        const on = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onTab(t.id)}
            className={cn(
              // 174x44 in the prototype, with the label starting 44px in —
              // that gap is the glyph, not padding.
              'flex h-[44px] items-center gap-[10px] rounded-[10px] pl-[14px] pr-[16px] text-18 transition-colors',
              t.id === 'list' ? 'ml-auto' : '',
              on ? 'bg-brand-cyan font-semibold text-ink' : 'font-medium text-ink-muted hover:bg-surface-muted',
            )}
            style={on ? undefined : { boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.4)' }}
          >
            <TabGlyph tab={t.id} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** The small mark each tab carries, left of its label. */
function TabGlyph({ tab }: { tab: DrawerTab }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 } as const;
  return tab === 'current' ? (
    <svg {...common} aria-hidden>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M12 8v8M8 12l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg {...common} aria-hidden>
      <path d="M5 7h14M5 12h14M5 17h9" strokeLinecap="round" />
    </svg>
  );
}
