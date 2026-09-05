'use client';

import { useState } from 'react';
import { KIND_META, longDay, type RecipeKind } from './recipeMeta';
import type { ManageRow, RecipeItem } from './useAutomation';

/**
 * Manage — the design's `atManage`, reached from a recipe card's **Manage**.
 *
 *   hero      370,40 · 1318x230, the same night sky as home with a
 *             512-wide `rgba(40,36,52,.85)` panel at 648,52 counting what is
 *             there
 *   title     392,308 in 27/700, "Created …" at 352
 *   back      1576,306 · 112x48 r12
 *   cards     378,420 · 1310 wide r18, 240 tall closed and 380 open on a
 *             20 gap; thumb 20,20 · 132 r14; the status chip at right 24;
 *             the caption at 176,58; the action row at 176,180 — approve,
 *             pause, edit, remove and a chevron that flips and turns
 *             `#9CEFFF` when the card is open
 *   open      a rule at 238, then ACCOUNT / STATUS / ACTIONS in 13.5/700 with
 *             0.08em tracking, one account row, and Publish / Regenerate Post
 *
 * ── One screen, two things ────────────────────────────────────────────────
 *
 * The prototype's manage view is written for AutoTrend only — its cards are
 * three fixture campaigns. Here it is per kind, because all three recipe cards
 * have a Manage button and sending two of them somewhere that says "AutoTrend"
 * would be a lie. The top half lists the recipes of that kind (what you can
 * pause, run or delete); the cards below are what they have produced.
 */
export function CampaignManage({
  kind,
  recipes,
  rows,
  onBack,
  onRun,
  onPause,
  onDelete,
  onApprove,
  onReject,
  busyId,
}: {
  kind: RecipeKind;
  recipes: RecipeItem[];
  rows: ManageRow[];
  onBack: () => void;
  onRun: (r: RecipeItem) => void;
  onPause: (r: RecipeItem) => void;
  onDelete: (r: RecipeItem) => void;
  onApprove: (row: ManageRow) => void;
  onReject: (row: ManageRow) => void;
  busyId: string | null;
}) {
  const meta = KIND_META[kind];
  const [open, setOpen] = useState<string[]>(rows[0] ? [rows[0].id] : []);
  const published = rows.filter((r) => r.chip.label === 'Published').length;
  const warnings = rows.filter((r) => r.chip.label === 'Failed' || r.chip.label === 'Blocked').length;

  return (
    <div className="animate-fade-in px-auto-inset pb-auto-inset pt-auto-inset motion-reduce:animate-none">
      {/* ── hero ─────────────────────────────────────────────────────────── */}
      <div className="relative h-auto-hero-h w-full max-w-auto-wide overflow-hidden rounded-[24px]" style={{ background: 'var(--ss-grad-auto-hero)' }}>
        <span aria-hidden className="absolute inset-0 animate-twinkle motion-reduce:animate-none" style={{ backgroundImage: 'var(--ss-grad-auto-stars)' }} />
        <span aria-hidden className="absolute left-[512px] top-[96px] hidden h-[9px] w-[9px] rounded-full bg-white xl:block" />
        <span aria-hidden className="absolute left-[568px] top-[96px] hidden h-[9px] w-[9px] rounded-full bg-white xl:block" />

        <div
          className="absolute left-[648px] top-[52px] w-[512px] max-w-[calc(100%-80px)] rounded-[16px] px-[26px] py-[20px] max-xl:left-[40px]"
          style={{ background: 'rgba(40,36,52,0.85)', backdropFilter: 'blur(10px)' }}
        >
          <p className="text-[19px] font-bold text-white">Hello,</p>
          <p className="mt-[6px] text-[15.5px] font-normal text-white/80">
            These are all your {meta.name} posts, sent and in review
          </p>
          <div className="mt-[12px] flex flex-wrap items-center gap-[10px] text-15 font-semibold" style={{ color: '#C08CF6' }}>
            <span>
              {rows.length} post{rows.length === 1 ? '' : 's'} detected
            </span>
            <span aria-hidden className="block h-[4px] w-[4px] rounded-full bg-white/40" />
            <span>{published} published</span>
            <span aria-hidden className="block h-[4px] w-[4px] rounded-full bg-white/40" />
            <span>
              {warnings} warning{warnings === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </div>

      {/* ── title row ────────────────────────────────────────────────────── */}
      <div className="mt-[38px] flex max-w-auto-wide flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[27px] font-bold text-ink">Campaign Automations for: {meta.name}</h1>
          <p className="mt-[10px] text-16 font-normal" style={{ color: '#838383' }}>
            {recipes.length === 0
              ? 'No recipe of this kind yet.'
              : `${recipes.length} recipe${recipes.length === 1 ? '' : 's'} · oldest created ${longDay(
                  recipes.reduce((a, b) => (a.createdAt < b.createdAt ? a : b)).createdAt,
                )}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="flex h-[48px] w-[112px] shrink-0 items-center justify-center gap-[13px] rounded-[12px] transition-colors hover:bg-white"
          style={{ background: 'rgba(255,255,255,0.8)', boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
        >
          <svg width="8" height="15" viewBox="0 0 8 16" fill="none" aria-hidden>
            <path d="M7 1 1 8l6 7" stroke="#5B5B5B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-16 font-medium" style={{ color: '#5B5B5B' }}>
            Back
          </span>
        </button>
      </div>

      {/* ── the recipes themselves ───────────────────────────────────────── */}
      {recipes.length > 0 ? (
        <ul className="mt-[24px] flex max-w-auto-wide flex-col gap-[12px]">
          {recipes.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-[14px] rounded-[16px] bg-white px-[22px] py-[16px]"
              style={{ boxShadow: '0 16px 44px -34px rgba(12,12,12,0.3)' }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[18px] font-bold text-ink">{r.name}</p>
                <p className="mt-[4px] text-15" style={{ color: '#838383' }}>
                  {r.status === 'active' ? 'Active' : r.status === 'paused' ? 'Paused' : 'Finished'}
                  {r.intervalMinutes ? ` · every ${Math.round(r.intervalMinutes / 60)}h` : ''}
                  {r.lastRunAt ? ` · last ran ${longDay(r.lastRunAt)}` : ' · has not run yet'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => onRun(r)}
                disabled={busyId === r.id}
                className="h-[40px] rounded-[10px] px-[16px] text-15 font-semibold text-ink transition-opacity hover:opacity-85 disabled:opacity-50"
                style={{ background: 'var(--ss-cyan-200)' }}
              >
                {busyId === r.id ? 'Working…' : 'Run now'}
              </button>
              <button
                type="button"
                onClick={() => onPause(r)}
                disabled={busyId === r.id || r.status === 'completed'}
                className="h-[40px] rounded-[10px] bg-white px-[16px] text-15 font-semibold text-ink transition-colors hover:bg-[rgba(131,131,131,0.08)] disabled:opacity-50"
                style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.4)' }}
              >
                {r.status === 'paused' ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button"
                onClick={() => onDelete(r)}
                disabled={busyId === r.id}
                aria-label={`Delete ${r.name}`}
                className="flex h-[40px] w-[40px] items-center justify-center rounded-[10px] bg-white transition-colors hover:bg-[rgba(243,85,37,0.08)] disabled:opacity-50"
                style={{ boxShadow: 'inset 0 0 0 1px rgba(243,85,37,0.6)' }}
              >
                <svg width="13" height="15" viewBox="0 0 14 16" fill="none" aria-hidden>
                  <path
                    d="M1 3.8h12M5 3.5V2.2C5 1.5 5.5 1 6.2 1h1.6c.7 0 1.2.5 1.2 1.2v1.3M2.6 3.8l.7 9.7c.05.8.7 1.4 1.5 1.4h4.4c.8 0 1.45-.6 1.5-1.4l.7-9.7"
                    stroke="#F35525"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M5.6 6.8v4.6M8.4 6.8v4.6" stroke="#F35525" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* ── what they produced ───────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <p className="mt-[26px] text-16 text-ink-muted">
          Nothing produced yet. A recipe fills this the first time it runs.
        </p>
      ) : (
        <ul className="mt-[26px] flex max-w-auto-wide flex-col gap-[20px]">
          {rows.map((row) => {
            const isOpen = open.includes(row.id);
            return (
              <li
                key={row.id}
                className="relative overflow-hidden rounded-[18px] bg-white"
                style={{ boxShadow: '0 16px 44px -34px rgba(12,12,12,0.3)' }}
              >
                <div className="flex gap-[24px] p-[20px]">
                  <span aria-hidden className="flex h-[132px] w-[132px] shrink-0 items-center justify-center rounded-[14px] max-md:hidden" style={{ background: 'rgba(131,131,131,0.08)' }}>
                    <span className="text-ink-muted">
                      <svg width="34" height="34" viewBox="0 0 18 18" fill="none">
                        <rect x="2" y="3" width="14" height="12" rx="3" stroke="currentColor" strokeWidth="1.4" />
                        <circle cx="6.4" cy="7.2" r="1.3" stroke="currentColor" strokeWidth="1.2" />
                        <path d="m3.4 13 3.6-3.6a1.6 1.6 0 0 1 2.2 0l4.2 4.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </span>
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start gap-[12px]">
                      <p className="min-w-0 flex-1 truncate text-16 font-medium" style={{ color: '#838383' }}>
                        Created On {longDay(row.createdAt)}
                      </p>
                      <span className="flex shrink-0 items-center gap-[10px]">
                        <span className="text-16 font-medium" style={{ color: '#5B5B5B' }}>
                          Status:
                        </span>
                        <span
                          className="inline-flex h-[40px] items-center rounded-[9px] px-[15px] text-[14.5px] font-semibold"
                          style={{ background: row.chip.bg, boxShadow: `inset 0 0 0 1.06px ${row.chip.ring}`, color: row.chip.color }}
                        >
                          {row.chip.label}
                        </span>
                      </span>
                    </div>

                    <p className="mt-[14px] line-clamp-3 text-[16.5px] font-medium leading-[1.45]" style={{ color: '#3B3B3B' }}>
                      {row.caption}
                    </p>

                    <div className="mt-[18px] flex flex-wrap items-center gap-[10px]">
                      {row.canDecide && row.playbookId ? (
                        <button
                          type="button"
                          onClick={() => onApprove(row)}
                          disabled={busyId === row.id}
                          aria-label="Approve this post"
                          className="flex h-[38px] w-[38px] items-center justify-center rounded-[9px] transition-opacity hover:opacity-85 disabled:opacity-50"
                          style={{ background: 'var(--ss-green-600)' }}
                        >
                          <svg width="15" height="12" viewBox="0 0 15 12" fill="none" aria-hidden>
                            <path d="m1.5 6 4 4L13.5 1.5" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      ) : null}

                      {row.canDecide ? (
                        <button
                          type="button"
                          onClick={() => onReject(row)}
                          disabled={busyId === row.id}
                          aria-label="Reject this post"
                          className="flex h-[38px] w-[38px] items-center justify-center rounded-[9px] bg-white transition-colors hover:bg-[rgba(243,85,37,0.08)] disabled:opacity-50"
                          style={{ boxShadow: 'inset 0 0 0 1px rgba(243,85,37,0.6)' }}
                        >
                          <svg width="13" height="15" viewBox="0 0 14 16" fill="none" aria-hidden>
                            <path
                              d="M1 3.8h12M5 3.5V2.2C5 1.5 5.5 1 6.2 1h1.6c.7 0 1.2.5 1.2 1.2v1.3M2.6 3.8l.7 9.7c.05.8.7 1.4 1.5 1.4h4.4c.8 0 1.45-.6 1.5-1.4l.7-9.7"
                              stroke="#F35525"
                              strokeWidth="1.4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      ) : null}

                      {/* An output that named no format cannot be approved:
                          `recipe.output.decide` demands the content item it
                          became, and there is nothing to draft one from. Saying
                          so beats a tick that always errors. */}
                      {row.canDecide && !row.playbookId ? (
                        <span className="text-[13.5px]" style={{ color: '#838383' }}>
                          No format picked — nothing to draft from
                        </span>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => setOpen((cur) => (cur.includes(row.id) ? cur.filter((x) => x !== row.id) : [...cur, row.id]))}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? 'Hide details' : 'Show details'}
                        className="flex h-[38px] w-[38px] items-center justify-center rounded-[9px] transition-opacity hover:opacity-85"
                        style={{ background: isOpen ? 'var(--ss-cyan-200)' : '#FFFFFF', boxShadow: isOpen ? 'none' : 'inset 0 0 0 1px rgba(131,131,131,0.4)' }}
                      >
                        <svg
                          width="13"
                          height="8"
                          viewBox="0 0 13 8"
                          fill="none"
                          aria-hidden
                          className="transition-transform duration-200 motion-reduce:transition-none"
                          style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}
                        >
                          <path d="m1 1 5.5 6L12 1" stroke="#0C0C0C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>

                {isOpen ? (
                  <div className="border-t px-[44px] py-[22px]" style={{ borderColor: 'rgba(131,131,131,0.15)' }}>
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-[20px] text-[13.5px] font-bold tracking-[0.08em] max-md:grid-cols-1" style={{ color: '#838383' }}>
                      <span>RECIPE</span>
                      <span>DETAIL</span>
                    </div>
                    <div className="mt-[14px] grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-[20px] max-md:grid-cols-1">
                      <span className="truncate text-17 font-medium" style={{ color: '#5B5B5B' }}>
                        {row.recipeName}
                      </span>
                      <span className="text-[15.5px] font-medium leading-[1.4]" style={{ color: '#3B3B3B' }}>
                        {row.detail}
                      </span>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
