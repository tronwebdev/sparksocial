'use client';

import { WINDOWS } from './PerformancePanel';

/**
 * The Performance & Learning tab's header — the title, the subtitle and the five
 * filter chips, for the shell's full-width band.
 *
 * ── Why it is not inside the panel ────────────────────────────────────────
 *
 * The design puts the chips at 666 / 872 / 1078 / 1284 / 1490, each 190x54, so
 * the row ends at 1680 — past the 1206 right edge of the content column and out
 * over the rail's width. Inside the panel there was no room for it: 5x190 plus
 * four 16px gaps is 1014, and beside a 560px title in a 1159 column it wrapped
 * onto three rows at y168/238/308 against the design's single row at y150.
 *
 * The shell already renders a band across the whole card above the two columns —
 * the Overview uses it for its Needs Attention strip — so this goes there. The
 * rail starts at y241 and this row sits at y150, which is why the design can
 * run it the full width without colliding.
 *
 * Four of the five chips are inert and say why on hover: the metrics snapshot
 * carries no per-channel, per-type, per-status or per-account breakdown. Only
 * the reporting window is real.
 */
export function PerformanceHeader({
  windowDays,
  onWindowDays,
  since,
}: {
  windowDays: number;
  onWindowDays: (d: number) => void;
  /** ISO date the snapshot starts at, appended to the subtitle when known. */
  since?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 shrink-0">
        <h2 className="text-[24px] font-semibold leading-[1.27] text-ink">
          Agent Command Center &mdash; Performance &amp; Learning
        </h2>
        <p className="mt-[9px] text-16 text-ink-muted">
          {/* The design's line, and the panel below is the reason it is true:
              these are agent-feedback measures, not platform analytics. */}
          This is agent feedback, not raw analytics
          {since
            ? ` \u00b7 since ${new Date(since).toLocaleDateString('en', { day: 'numeric', month: 'long' })}`
            : ''}
        </p>
      </div>

      {/* The design sets the title on 147 and the chips on 150. */}
      <div className="mt-[3px] flex flex-wrap justify-end gap-[16px]">
        {/* Date — the live one. */}
        <div
          className="flex h-[54px] w-[190px] items-center gap-[11px] rounded-xl bg-white px-4"
          style={{ boxShadow: '0 10px 26px -18px rgba(12,12,12,0.3)' }}
        >
          <svg width="19" height="20" viewBox="0 0 24 25" fill="none" aria-hidden className="shrink-0">
            <rect x="2.7" y="4.1" width="18.6" height="18.4" rx="4" stroke="#838383" strokeWidth="1.8" />
            <path d="M2.9 9.9h18.2" stroke="#838383" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M8.1 1.9v3.8M18.5 1.9v3.8" stroke="#838383" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <label htmlFor="perf-window" className="sr-only">
            Reporting window
          </label>
          <select
            id="perf-window"
            value={windowDays}
            onChange={(e) => onWindowDays(Number(e.target.value))}
            className="flex-1 border-0 bg-transparent text-16 font-medium text-ink outline-none"
          >
            {WINDOWS.map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </select>
        </div>

        {(
          [
            ['Channels', 'There is no per-channel breakdown on the metrics snapshot.'],
            ['Content type', 'There is no per-content-type breakdown on the metrics snapshot.'],
            ['By Status', 'There is no status filter on the metrics snapshot.'],
            ['By Account', 'There is no per-account breakdown on the metrics snapshot.'],
          ] as const
        ).map(([label, why]) => (
          <button
            key={label}
            type="button"
            disabled
            title={why}
            className="flex h-[54px] w-[190px] cursor-not-allowed items-center gap-[11px] rounded-xl bg-white px-4 opacity-55"
            style={{ boxShadow: '0 10px 26px -18px rgba(12,12,12,0.3)' }}
          >
            <span className="flex-1 text-left text-16 font-medium text-ink">{label}</span>
            <svg width="13" height="8" viewBox="0 0 13 8" fill="none" aria-hidden className="shrink-0">
              <path d="m1 1 5.5 6L12 1" stroke="#0C0C0C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
