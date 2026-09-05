'use client';

import { cn } from '@/lib/utils';

/**
 * Discovery's filter rail — `SparkSocial Discovery.dc.html`, the column down the
 * left of the feed card.
 *
 *   heading   28,104   19px/700 "Filters"
 *   sections  20,140   300 wide, an 8px gap between them
 *   header    h48 at radius 12 on `rgba(131,131,131,.07)`, px16 gap11,
 *             label 17px/600, chevron `rotate(180deg)` open and `0deg` closed
 *             on `transform .2s ease`
 *   item      h38, gap 12 — a 19x19 box at radius 5.5, `#0C0C0C` when checked
 *             and white in a `rgba(12,12,12,.3)` ring when not, on
 *             `background .15s ease`; label 16px/500 `#3B3B3B`
 *
 * ── Which of the six can do anything ─────────────────────────────────────
 *
 * `trend.rank` takes a genome and a limit. It returns a source per trend and
 * the four signal metrics, so **Sources** and **Signal** filter the ranked list
 * client-side, the same way the Command Center's queue filters do. The other
 * four cannot: a ranked trend carries no language, no brand-safety
 * classification, and the watchlist and influencer lists are separate reads on
 * separate screens. Those sections render with their checkboxes disabled and a
 * title saying which field is missing — the prototype toasts all six as mocks,
 * so nothing that ever worked is lost, and a control that silently narrows
 * nothing is worse than one that says so.
 */

export interface RailItem {
  label: string;
  /** Set when this one item cannot filter, and why. */
  disabledReason?: string;
  /**
   * A source row's mute state and toggle — `trend.source.mute`.
   *
   * Only the Sources section sets this. Filtering and muting are different
   * questions about the same row ("show me only YouTube" versus "stop reading
   * YouTube"), and the design has one row per source, so the row carries the
   * checkbox for the first and a speaker for the second rather than the rail
   * growing a second list.
   */
  mute?: { muted: boolean; onToggle: () => void; busy?: boolean; title: string };
}

export interface RailSection {
  label: string;
  icon: React.ReactNode;
  items: readonly RailItem[];
  /** Set when no item in the section can filter, and why. */
  disabledReason?: string;
}

/**
 * A saved trend's label is its topic, and a topic is whatever the source called
 * it — "LISA - SaWaDiKa (Official Music Video)" is 38 characters. With
 * `whitespace-nowrap` and no truncation those ran straight out of the 300px
 * column and over the trend grid, which is item 5 on the fix list: the rail was
 * not overlapping the body, its *labels* were. They truncate with the full text
 * on hover now, and the row is `min-w-0` so flex actually allows it.
 */
export function DiscoveryFilterRail({
  sections,
  collapsed,
  onToggleSection,
  checks,
  onToggleCheck,
}: {
  sections: readonly RailSection[];
  collapsed: readonly string[];
  onToggleSection: (label: string) => void;
  checks: readonly string[];
  onToggleCheck: (item: string) => void;
}) {
  return (
    /* `overflow-hidden` as the backstop: even with every label truncating, no
       control in this column may paint over the trend grid beside it. */
    <div className="w-full shrink-0 overflow-hidden xl:w-disc-rail">
      <p className="pl-[8px] text-[19px] font-bold text-ink">Filters</p>

      <div className="mt-[16px] flex flex-col gap-[8px]">
        {sections.map((sec) => {
          const open = !collapsed.includes(sec.label);
          return (
            <div key={sec.label} className="flex flex-col gap-[2px]">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => onToggleSection(sec.label)}
                className="flex h-disc-rail-row items-center gap-[11px] rounded-xl px-4 text-left transition-colors hover:bg-[var(--ss-disc-sec-hover)]"
                style={{ background: 'var(--ss-disc-sec)' }}
              >
                <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center text-ink">
                  {sec.icon}
                </span>
                <span className="min-w-0 flex-1 truncate text-[17px] font-semibold text-ink">
                  {sec.label}
                </span>
                <svg
                  width="12"
                  height="7"
                  viewBox="0 0 13 8"
                  fill="none"
                  aria-hidden
                  className={cn(
                    'shrink-0 transition-transform duration-200 ease-in-out motion-reduce:transition-none',
                    open ? 'rotate-180' : 'rotate-0',
                  )}
                >
                  <path d="m1 1 5.5 6L12 1" stroke="#0C0C0C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {open
                ? sec.items.map((item) => {
                    const checked = checks.includes(item.label);
                    const reason = sec.disabledReason ?? item.disabledReason;
                    const row = (
                      <button
                        key={item.label}
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        disabled={Boolean(reason)}
                        title={reason}
                        onClick={() => onToggleCheck(item.label)}
                        className={cn(
                          'flex h-[38px] w-full min-w-0 items-center gap-[12px] rounded-[9px] px-4 text-left',
                          reason
                            ? 'cursor-not-allowed opacity-55'
                            : 'transition-colors hover:bg-[rgba(131,131,131,0.05)]',
                        )}
                      >
                        <span
                          aria-hidden
                          className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-[5.5px] transition-colors duration-150 motion-reduce:transition-none"
                          style={{
                            background: checked ? '#0C0C0C' : '#FFFFFF',
                            boxShadow: checked ? 'none' : 'inset 0 0 0 1.2px rgba(12,12,12,0.3)',
                          }}
                        >
                          {checked ? (
                            <svg width="10" height="8" viewBox="0 0 11 9" fill="none">
                              <path d="m1 4.5 3 3L10 1" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ) : null}
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate text-16 font-medium"
                          style={{ color: item.mute?.muted ? '#8A4B12' : '#3B3B3B' }}
                          title={item.label}
                        >
                          {item.label}
                        </span>
                      </button>
                    );

                    /* The mute toggle sits *beside* the filter row rather than
                       inside it: nesting a button in a button is invalid, and
                       the two do different things to the same source. */
                    return item.mute ? (
                      <div key={item.label} className="flex min-w-0 items-center gap-[6px]">
                        {row}
                        <button
                          type="button"
                          onClick={item.mute.onToggle}
                          disabled={item.mute.busy}
                          aria-pressed={item.mute.muted}
                          aria-label={item.mute.title}
                          title={item.mute.title}
                          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[rgba(131,131,131,0.1)] disabled:opacity-50"
                          style={item.mute.muted ? { background: '#FFF1DF' } : undefined}
                        >
                          <svg width="15" height="15" viewBox="0 0 18 18" fill="none" aria-hidden>
                            <path
                              d="M8.2 3.4 4.9 6H2.6v6h2.3l3.3 2.6V3.4Z"
                              stroke={item.mute.muted ? '#8A4B12' : '#838383'}
                              strokeWidth="1.5"
                              strokeLinejoin="round"
                            />
                            {item.mute.muted ? (
                              <path d="m11.6 6.6 4 4.8m0-4.8-4 4.8" stroke="#8A4B12" strokeWidth="1.5" strokeLinecap="round" />
                            ) : (
                              <path d="M11.8 6.2a3.9 3.9 0 0 1 0 5.6" stroke="#838383" strokeWidth="1.5" strokeLinecap="round" />
                            )}
                          </svg>
                        </button>
                      </div>
                    ) : (
                      row
                    );
                  })
                : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
