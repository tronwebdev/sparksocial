import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The settings section card, measured off `ui build/Settings WS Brand Kits.dc.html`.
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * This shipped as `1px dashed rgba(131,131,131,0.45)` on a transparent
 * background. The prototype has no dashed border anywhere on the screen —
 * querying every element for `border-style: dashed` in the rendered design
 * returns nothing. Each section card is an SVG rounded rect, **filled**
 * `rgb(243,244,248)`, radius 22.888, with **no stroke at all**:
 *
 *   <path d="M 0 22.888 C 0 10.247 …" fill="currentColor" />
 *   style="…border-radius:22.887699127197266px;color:rgb(243,244,248)"
 *
 * A dashed outline and a soft filled panel are opposite treatments — one reads
 * as a placeholder or a drop target, the other as a grouped surface — so the
 * screen read as unfinished where the design reads as settled. That is most of
 * what "not perfect as it is on the prototype" was pointing at.
 *
 * ── Measured geometry (page is 1728 wide; content column x367…x1651) ──────
 *
 *   content column   1284 wide
 *   two-up cards     626 wide, 32 gutter   (367 + 626 = 993, next at 1025)
 *   row 1            y281, h322            Workspace logo · Color Theme
 *   row 2            y630, h272            Brand Voice · Typography Style
 *   row gap          27                    (281 + 322 = 603 → 630)
 *   full-width       1284                  Brand Knowledge (h822), Templates (h510)
 *   title            20/500, at +23 / +19 inside the card
 *
 * Heights are *not* reproduced. They are whatever the prototype's placeholder
 * content happened to measure, and pinning a real panel to 322px would clip a
 * brand with four colours instead of two. The widths, the gutter and the card
 * treatment are the design; the heights are an artefact of the mock.
 */
export function KitSection({
  title,
  hint,
  className,
  style,
  headerRight,
  rule,
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  style?: CSSProperties;
  /** A control belonging to the card's header — the design's "Generate logo". */
  headerRight?: ReactNode;
  /**
   * The y, from the card's top, of a full-bleed hairline under the header.
   *
   * The design's four kit cards draw one — `rgba(12,12,12,0.1)`, 623.69 of
   * the card's 626 — at 71 under Workspace logo and Brand Voice and at 61.8
   * under Color Theme and Typography Style. With it the header is a band of
   * fixed height and the body is laid out from the line, which is how every
   * position inside those cards is measured.
   */
  rule?: number;
  children: ReactNode;
}) {
  if (rule !== undefined) {
    return (
      // A size container: these cards are 626 at the design's width, ~300
      // two-up at 1024 and on a phone, and their bodies step down by it.
      <section className={cn('bg-panel px-[23px] pb-[23px] pt-[19px] [container-type:inline-size] max-sm:px-4 max-sm:pb-4', className)} style={{ borderRadius: 22.888, ...style }}>
        <div className="flex items-start justify-between gap-3" style={{ height: rule - 19 }}>
          <h3 className="text-20 font-medium leading-[1.3] text-ink">{title}</h3>
          {headerRight ? <div className="-mr-[7px] -mt-[4.2px] shrink-0">{headerRight}</div> : null}
        </div>
        <div aria-hidden className="-mx-[23px] h-px max-sm:-mx-4" style={{ background: 'rgba(12,12,12,0.1)' }} />
        {children}
      </section>
    );
  }

  return (
    <section
      className={cn('bg-panel px-[23px] pb-[23px] pt-[19px] max-sm:px-4 max-sm:pb-4', className)}
      style={{ borderRadius: 22.888, ...style }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* 600, where the four ruled kit cards are 500: Brand Knowledge and
              Templates are 20/600 in the design, Strict Compliance 20/700. */}
          <h3 className="text-20 font-semibold leading-[1.3] text-ink">{title}</h3>
          {hint ? <p className="mt-[6px] text-13 text-ink-muted">{hint}</p> : null}
        </div>
        {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
      </div>
      <div className="mt-[18px]">{children}</div>
    </section>
  );
}

/**
 * The design's two-up row: 626 + 32 + 626 within a 1284 column.
 *
 * Expressed as a fractional grid rather than fixed 626s so the page still works
 * below 1284 — the prototype is a single fixed width and says nothing about
 * what happens when the window is narrower, and a hardcoded 626 would overflow
 * a laptop. The ratio and the gutter are what carry the design.
 */
export function KitRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-1 gap-[27px] lg:grid-cols-2 lg:gap-x-[32px]', className)}>{children}</div>;
}
