'use client';

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
 *   rail items  y302 · 429 · 555 · 682  → 126.7 pitch
 *   "Post Type" y183 · 14/600 · ink-500
 *   active item ink-900 on white; the rest ink-500 on the rail gradient
 *   tab chip    x820 y52 · 174x44 · r10 · #6CE8FF
 *   tab label   18/600 active, 18/500 inactive
 *   Close Draft x605 y500 · 23x96 · 18/500 — on the drawer's *outside* edge
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
  tab,
  onTab,
  onClose,
  children,
}: {
  postType: PostType;
  onPostType: (next: PostType) => void;
  tab: DrawerTab;
  onTab: (next: DrawerTab) => void;
  onClose: () => void;
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
        className="absolute inset-0 h-full w-full cursor-default bg-black/20 backdrop-blur-[6px]"
      />

      {/*
        Inset, not full-bleed.

        The prototype's drawer runs y27…y1091 inside a 1117 stage — 27 above and
        26 below — so the Command Center's own rounded canvas stays visible top
        and bottom. Full height made it read as a page replacing a page rather
        than a panel sliding over one.
      */}
      <div className="pointer-events-none absolute inset-x-0 top-[27px] bottom-[26px] flex justify-end">
        {/* 1091 of 1728. Capped so the rail does not swallow a narrow window. */}
        <div className="pointer-events-auto relative flex h-full w-full max-w-[min(63.1%,1091px)] min-w-[520px]">
          {/*
            "Close Draft", outside the drawer's left edge.

            Vertical, and the prototype puts it *outside* the panel rather than
            in a corner of it — the affordance belongs to the page it is
            covering, not to the thing covering it.
          */}
          <button
            type="button"
            onClick={onClose}
            className="absolute -left-[32px] top-1/2 flex h-[96px] w-[23px] -translate-y-1/2 items-center justify-center rounded-l-[8px] bg-white/90 text-18 font-medium text-ink shadow-[0_2px_12px_rgba(12,12,12,0.12)]"
            style={{ writingMode: 'vertical-rl', transform: 'translateY(-50%) rotate(180deg)' }}
          >
            Close Draft
          </button>

          <div
            className="flex h-full w-full overflow-hidden bg-white"
            style={{ borderRadius: '24.38px 10.158px 10.158px 24.38px' }}
          >
            <PostTypeRail active={postType} onSelect={onPostType} />

            <div className="flex min-w-0 flex-1 flex-col">
              <DrawerTabs tab={tab} onTab={onTab} />
              <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
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
 * `DP carousel`, `DP text`), so this is the control that drives them. The
 * active one is a white card with ink-900 type; the rest sit on the rail's
 * gradient in ink-500.
 */
function PostTypeRail({ active, onSelect }: { active: PostType; onSelect: (next: PostType) => void }) {
  return (
    <nav
      aria-label="Post type"
      className="flex w-[151px] shrink-0 flex-col items-center gap-[18px] px-[14px] pt-[24px]"
      style={{
        // The rail's own wash, measured off the prototype: cyan at the top
        // falling to the violet the drawer uses for emphasis.
        background:
          'linear-gradient(180deg, rgba(108,232,255,0.20) 0%, rgba(163,65,255,0.10) 55%, rgba(255,255,255,0) 100%)',
      }}
    >
      {/* The Spark orb, y≈34 in the prototype. */}
      <span
        aria-hidden
        className="block h-[92px] w-[92px] rounded-full"
        style={{
          background:
            'radial-gradient(circle at 35% 30%, #FFFFFF 0%, rgba(108,232,255,0.9) 35%, rgba(163,65,255,0.75) 75%)',
          boxShadow: '0 0 0 6px rgba(255,255,255,0.55)',
        }}
      />

      <span className="text-14 font-semibold text-ink-muted">Post Type</span>

      <ul className="flex w-full flex-col items-center gap-[14px]">
        {POST_TYPES.map((t) => {
          const on = t.id === active;
          return (
            <li key={t.id} className="w-full">
              <button
                type="button"
                aria-current={on ? 'true' : undefined}
                onClick={() => onSelect(t.id)}
                className={cn(
                  'flex w-full flex-col items-center gap-[8px] rounded-[16px] px-2 py-[12px] transition-colors',
                  // The active card is the only opaque surface on the rail,
                  // which is what makes the selection readable over a gradient.
                  on ? 'bg-white shadow-[0_2px_10px_rgba(12,12,12,0.08)]' : 'hover:bg-white/45',
                )}
              >
                <TypeIcon type={t.id} active={on} />
                <span className={cn('text-14 font-medium', on ? 'text-ink' : 'text-ink-muted')}>{t.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The four rail glyphs, drawn rather than imported — each is a few lines. */
function TypeIcon({ type, active }: { type: PostType; active: boolean }) {
  const stroke = active ? 'var(--ss-ink-900)' : 'var(--ss-ink-500)';
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
 * inactive one is 18/500 in ink-500 with no chip at all. The prototype gives
 * the inactive tab no surface, so a hover tint is the only thing added here —
 * without one the control reads as a label rather than a button.
 */
function DrawerTabs({ tab, onTab }: { tab: DrawerTab; onTab: (next: DrawerTab) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-[14px] px-[32px] pt-[25px] pb-[18px]">
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
              on ? 'bg-brand-cyan font-semibold text-ink' : 'font-medium text-ink-muted hover:bg-surface-muted',
            )}
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
