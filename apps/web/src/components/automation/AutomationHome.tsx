'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { RecipeGlyph } from './RecipeGlyph';
import {
  KINDS,
  KIND_META,
  QUEUE_TABS,
  queueStamp,
  type RecipeKind,
} from './recipeMeta';
import type { QueueRow, RecipeItem } from './useAutomation';

/**
 * The Automation Recipes home — `SparkSocial Automation.dc.html`, `isHome`.
 *
 * Measured from the shell card's left edge, everything sits on a 22px inset:
 *
 *   hero      370,40 · 1318x230 r24, the night sky over `--ss-grad-auto-hero`
 *             with the star field twinkling on `ss-twinkle 5s`; the title at 38
 *             in 34/700 `#7FE9FD`, the subtitle at 94 in 17/400 white-85, and
 *             "Add New Recipe" centred at 162 — h47 r12 on `rgba(20,16,28,.9)`
 *             ringed 1.6px `rgba(196,107,245,.8)` with a 24px violet glow
 *   attention 634,302 · 1054x51.5 r15.6 on `#FFF0DC` inside a 1.04px `#FFB453`,
 *             the orb at 560,296 · 60
 *   cards     388, three 426x250 r20 on a 446 pitch — icon 24,24 · 58 r14,
 *             the "N active" pill at right 18 / top 20, name at 102 in 22/700,
 *             copy at 138 in 15.5/400 `#5B5B5B`, buttons at 192
 *   queue     672 · 1318x960 r20 white — title 28,28 in 22/700, tabs at 28,112
 *             (h56 r14, each h40 r10 with a count badge), search 938,118 ·
 *             352x46, headers at 206 (28/600/952/1090/1226), rule at 240, rows
 *             on a 118 pitch
 *
 * ── What the numbers are drawn from ───────────────────────────────────────
 *
 * The three cards' "N active" counts are `recipe.list` grouped by kind, not a
 * fixture. The queue is `recipe.output.list` joined to `content.list` — see
 * `useAutomation` for why both, and `statusChip` for the one chip in the design
 * that has no state behind it.
 */
export function AutomationHome({
  recipes,
  rows,
  loading,
  onAddNew,
  onOpenChooser,
  onManage,
  onPreview,
  onRemove,
  onReview,
  needsReview,
}: {
  recipes: RecipeItem[] | null;
  rows: QueueRow[] | null;
  loading: boolean;
  onAddNew: (kind: RecipeKind) => void;
  onOpenChooser: () => void;
  onManage: (kind: RecipeKind) => void;
  onPreview: (row: QueueRow) => void;
  onRemove: (row: QueueRow) => void;
  onReview: () => void;
  needsReview: number;
}) {
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState('');
  const [rawPage, setPage] = useState(0);

  const counts = useMemo(() => {
    const out: Record<RecipeKind, number> = { auto_trend: 0, bulk_connector: 0, rss: 0 };
    for (const r of recipes ?? []) if (r.status === 'active') out[r.kind] += 1;
    return out;
  }, [recipes]);

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows ?? [];
    return (rows ?? []).filter((r) => `${r.title} ${r.recipeName}`.toLowerCase().includes(q));
  }, [rows, query]);

  const tabCount = (i: number) => {
    const keeps = QUEUE_TABS[i]!.keeps;
    return keeps === null ? searched.length : searched.filter((r) => keeps.includes(r.chip.label)).length;
  };

  const visible = useMemo(() => {
    const keeps = QUEUE_TABS[tab]!.keeps;
    return keeps === null ? searched : searched.filter((r) => keeps.includes(r.chip.label));
  }, [searched, tab]);

  /* Five rows a page — the design's own card holds exactly that many. */
  const pageCount = Math.max(1, Math.ceil(visible.length / 5));
  const page = Math.min(rawPage, pageCount - 1);
  const paged = visible.slice(page * 5, page * 5 + 5);

  return (
    <div className="px-auto-inset pb-auto-inset pt-auto-inset">
      {/* ── hero ─────────────────────────────────────────────────────────── */}
      <div
        className="relative h-auto-hero-h w-full max-w-auto-wide overflow-hidden rounded-[24px]"
        style={{ background: 'var(--ss-grad-auto-hero)' }}
      >
        <span
          aria-hidden
          className="absolute inset-0 animate-twinkle motion-reduce:animate-none"
          style={{ backgroundImage: 'var(--ss-grad-auto-stars)' }}
        />

        <p className="absolute inset-x-0 top-[38px] text-center text-[34px] font-bold text-auto-hero-title">
          Automation Recipes
        </p>
        <p className="absolute inset-x-0 top-[94px] text-center text-[17px] font-normal leading-[1.4] text-white/85">
          Set-and-forget content engines. Recipes generate posts on a schedule
          <br />
          and route them to your queue and calendar.
        </p>

        <button
          type="button"
          onClick={onOpenChooser}
          className="absolute left-1/2 top-[162px] flex h-[47px] -translate-x-1/2 items-center gap-[11px] rounded-[12px] px-[20px] transition-shadow"
          style={{
            background: 'rgba(20,16,28,0.9)',
            boxShadow: '0 0 0 1.6px rgba(196,107,245,0.8), 0 0 24px -4px rgba(140,120,255,0.6)',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M7 1v12M1 7h12" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span className="whitespace-nowrap text-[16.5px] font-semibold text-white">Add New Recipe</span>
        </button>

        {/* The design's six floating source marks. Decoration, so they go under
            `xl` where the hero's own copy needs the width. */}
        <span aria-hidden className="absolute left-[112px] top-[104px] hidden h-[64px] w-[64px] items-center justify-center rounded-full bg-white/10 xl:flex">
          <span className="relative block h-[40px] w-[34px] rounded-[7px]" style={{ background: '#AFC6E9' }}>
            <span className="absolute inset-x-0 bottom-[5px] text-center text-[9px] font-extrabold" style={{ color: '#3B5B8C' }}>
              CSV
            </span>
          </span>
        </span>
        <span aria-hidden className="absolute left-[420px] top-[172px] hidden h-[52px] w-[52px] items-center justify-center rounded-[12px] xl:flex" style={{ background: 'linear-gradient(135deg,#21C4C8 0%,#7A5FE0 100%)' }}>
          <span className="text-[26px] font-bold italic text-white" style={{ fontFamily: 'Georgia, serif' }}>
            C
          </span>
        </span>
        <span aria-hidden className="absolute right-[388px] top-[104px] hidden h-[56px] w-[56px] items-center justify-center rounded-[14px] bg-white/10 xl:flex">
          <svg width="30" height="26" viewBox="0 0 30 26" fill="none">
            <path d="M2 6.4A3.4 3.4 0 0 1 5.4 3h5.2l3 3.4h11A3.4 3.4 0 0 1 28 9.8v9.8a3.4 3.4 0 0 1-3.4 3.4H5.4A3.4 3.4 0 0 1 2 19.6V6.4Z" fill="#F0C987" />
            <path d="m16 9-4.4 6h3l-1.2 4.6 4.8-6.4h-3L16 9Z" fill="#E8582B" />
          </svg>
        </span>
        <span aria-hidden className="absolute right-[64px] top-[32px] hidden h-[52px] w-[52px] items-center justify-center rounded-full bg-white/10 xl:flex" style={{ color: '#F49B33' }}>
          <RecipeGlyph kind="rss" size={24} />
        </span>
      </div>

      {/* ── needs attention ──────────────────────────────────────────────── */}
      {needsReview > 0 ? (
        <div className="mt-[26px] flex max-w-auto-wide items-center gap-[14px] pl-[190px] max-xl:pl-0">
          <span
            aria-hidden
            className="relative block h-[60px] w-[60px] shrink-0 rounded-full"
            style={{
              background: 'radial-gradient(circle at 50% 42%, #D6F1FF 0%, #A6D8FF 60%, #8FC8FF 100%)',
              boxShadow: '0 8px 22px -10px rgba(36,116,237,0.5)',
            }}
          >
            <span className="absolute left-[17px] top-[26px] block h-[8px] w-[8px] rounded-full bg-white" />
            <span className="absolute left-[35px] top-[26px] block h-[8px] w-[8px] rounded-full bg-white" />
          </span>

          <div
            className="flex h-[51.5px] min-w-0 flex-1 items-center gap-[12px] rounded-[15.6px] px-[12px]"
            style={{ background: '#FFF0DC', boxShadow: 'inset 0 0 0 1.04px var(--ss-auto-review-ring)' }}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden className="shrink-0">
              <path
                d="M13.9 1.1C13 .4 12 0 10.9 0 9.9 0 8.8.4 7.9 1.1 5.4 3.2 3.1 5.5 1.1 8c-1.5 1.8-1.4 4-.1 5.8 2.1 2.6 4.4 5 7 7 1.8 1.4 4 1.4 5.8 0 2.6-2 4.9-4.4 7-6.9 1.4-1.8 1.4-4.1 0-5.9-2-2.5-4.3-4.9-6.9-6.9Z"
                fill="rgba(230,167,81,0.3)"
              />
              <path d="M10.9 5.5v6.2M10.9 15.4v.6" stroke="#E6A751" strokeWidth="2.3" strokeLinecap="round" />
            </svg>
            <p className="min-w-0 flex-1 truncate text-[16.65px] leading-[1.28]">
              <b className="font-bold text-amber-500" style={{ color: 'var(--ss-amber-500)' }}>
                Needs Attention:
              </b>
              <span className="font-medium" style={{ color: 'var(--ss-amber-500)' }}>
                {' '}
                Approval required for {needsReview} queued {needsReview === 1 ? 'post' : 'posts'}
              </span>
            </p>
            <button type="button" onClick={onReview} className="flex shrink-0 items-center gap-[12px] transition-opacity hover:opacity-70">
              <span className="text-[16.65px] text-ink">Review</span>
              <span className="flex h-[22.9px] w-[22.9px] items-center justify-center rounded-full" style={{ boxShadow: 'inset 0 0 0 0.8px #0C0C0C' }}>
                <svg width="5" height="9" viewBox="0 0 5 9" fill="none" aria-hidden>
                  <path d="m1 1 3 3.5L1 8" stroke="#0C0C0C" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
          </div>
        </div>
      ) : null}

      {/* ── recipe cards ─────────────────────────────────────────────────── */}
      <div className="mt-[32px] flex max-w-auto-wide flex-wrap gap-auto-card-gap">
        {KINDS.map((kind) => {
          const meta = KIND_META[kind];
          return (
            <div
              key={kind}
              className="relative h-auto-card-h w-auto-card shrink-0 overflow-hidden rounded-[20px] max-md:w-full"
              style={{ background: meta.bg, boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.12)' }}
            >
              <span
                aria-hidden
                className="absolute left-[24px] top-[24px] flex h-[58px] w-[58px] items-center justify-center rounded-[14px] text-white"
                style={{ background: meta.iconBg }}
              >
                <RecipeGlyph kind={kind} size={30} />
              </span>

              <span
                className="absolute right-[18px] top-[20px] flex h-[30px] items-center gap-[7px] rounded-[15px] bg-white px-[11px]"
                style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.15)' }}
              >
                <span aria-hidden className="block h-[8px] w-[8px] rounded-full" style={{ background: 'var(--ss-green-500)' }} />
                <span className="whitespace-nowrap text-[13.5px] font-semibold text-ink">
                  {loading ? '—' : counts[kind]} active
                </span>
              </span>

              <p className="absolute left-[24px] top-[102px] whitespace-nowrap text-[22px] font-bold text-ink">{meta.name}</p>
              <p className="absolute left-[24px] top-[138px] w-[378px] max-w-[calc(100%-48px)] text-[15.5px] font-normal leading-[1.35]" style={{ color: '#5B5B5B' }}>
                {meta.desc}
              </p>

              <button
                type="button"
                onClick={() => onManage(kind)}
                className="absolute left-[24px] top-[192px] flex h-[41px] items-center rounded-[9px] bg-white px-[22px] transition-shadow hover:shadow-[inset_0_0_0_1.4px_#838383]"
                style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)' }}
              >
                <span className="text-[15px] font-semibold text-ink">Manage</span>
              </button>
              <button
                type="button"
                onClick={() => onAddNew(kind)}
                className="absolute left-[146px] top-[192px] flex h-[41px] items-center gap-[9px] rounded-[9px] px-[16px] transition-colors hover:bg-white/60"
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M7 1v12M1 7h12" stroke="#0C0C0C" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <span className="whitespace-nowrap text-[15px] font-semibold text-ink">Add New</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* ── output queue ─────────────────────────────────────────────────── */}
      <div className="mt-[34px] max-w-auto-wide rounded-[20px] bg-white pb-[24px]">
        <div className="flex flex-wrap items-start gap-4 px-[28px] pt-[28px]">
          <div className="min-w-0 flex-1">
            <p className="text-[22px] font-bold text-ink">Automation output queue</p>
            <p className="mt-[10px] text-16 font-normal text-ink-muted">
              All posts generated by recipes — review, edit, or let them ship.
            </p>
          </div>

          {/* 1002,32 and 1142,32 — both h44 r10. The design toasts each as a
              mock. Account has nothing to filter on: an output records no
              account, which is why the column below says so. Governance is
              real and lives in Settings, so it goes there. */}
          <span
            className="inline-flex h-[44px] shrink-0 cursor-not-allowed items-center gap-[10px] rounded-[10px] bg-white px-[16px] opacity-70"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
            title="A recipe output carries no account — where a post lands is decided by its playbook when the draft is made."
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M1.5 2h13L9.6 8.2v5.2l-3.2 1.4V8.2L1.5 2Z" stroke="#5B5B5B" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
            <span className="text-15 font-medium" style={{ color: '#5B5B5B' }}>
              Account
            </span>
          </span>

          <Link
            href="/settings"
            className="inline-flex h-[44px] shrink-0 items-center gap-[10px] rounded-[10px] bg-white px-[16px] transition-colors hover:bg-[#FFF9F1]"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(228,137,21,0.55)' }}
          >
            <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden>
              <circle cx="10" cy="10" r="3.4" stroke="#E48915" strokeWidth="1.5" />
              <path d="M10 1.8v2.4M10 15.8v2.4M18.2 10h-2.4M4.2 10H1.8M16 4l-1.7 1.7M5.7 14.3 4 16M16 16l-1.7-1.7M5.7 5.7 4 4" stroke="#E48915" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="text-15 font-medium" style={{ color: 'var(--ss-amber-500)' }}>
              Governance
            </span>
          </Link>
        </div>

        <div className="mt-[25px] flex flex-wrap items-center gap-[14px] px-[28px]">
          <div
            className="inline-flex h-[56px] items-center gap-[6px] overflow-x-auto rounded-[14px] bg-white px-[8px]"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
            role="tablist"
            aria-label="Queue state"
          >
            {QUEUE_TABS.map((t, i) => (
              <button
                key={t.label}
                type="button"
                role="tab"
                aria-selected={tab === i}
                onClick={() => {
                  setTab(i);
                  setPage(0);
                }}
                className="flex h-[40px] shrink-0 items-center gap-[9px] rounded-[10px] px-[14px] transition-colors duration-200"
                style={{ background: tab === i ? 'var(--ss-cyan-200)' : 'transparent' }}
              >
                <span className="whitespace-nowrap text-[15.5px] font-semibold text-ink">{t.label}</span>
                <span
                  className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[6px] px-[6px] text-[12.5px] font-bold text-ink"
                  style={{ background: tab === i ? '#FFFFFF' : 'rgba(131,131,131,0.12)' }}
                >
                  {tabCount(i)}
                </span>
              </button>
            ))}
          </div>

          <div
            className="relative ml-auto h-[46px] w-[352px] max-w-full rounded-[12px] bg-white"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
          >
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Search Queue"
              aria-label="Search the output queue"
              className="h-full w-full rounded-[12px] bg-transparent pl-[16px] pr-[42px] text-15 font-medium text-ink outline-none placeholder:text-[#B0B0B0]"
            />
            <svg width="17" height="17" viewBox="0 0 26 26" fill="none" aria-hidden className="pointer-events-none absolute right-[15px] top-[15px]">
              <circle cx="11" cy="11" r="8" stroke="#838383" strokeWidth="2" />
              <path d="m17 17 6 6" stroke="#838383" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        {/* The design's five column headers at 28 / 600 / 952 / 1090 / 1226 on a
            1318 card, carried as track widths so a long title cannot push a
            chip out from under its own heading. */}
        <div
          className="mt-[38px] grid items-center pb-[10px] pl-[28px] pr-[10px] text-[16.5px] font-semibold"
          style={{ gridTemplateColumns: QUEUE_COLUMNS, color: '#5B5B5B', boxShadow: 'inset 0 -1px 0 rgba(131,131,131,0.15)' }}
        >
          <span>Contents</span>
          <span>Recipe</span>
          <span>Account</span>
          <span>Status</span>
          <span>Action</span>
        </div>

        {rows === null ? (
          <p className="px-[28px] py-[40px] text-16 text-ink-muted">Loading the queue…</p>
        ) : visible.length === 0 ? (
          <p className="px-[28px] py-[40px] text-16 text-ink-muted">
            {(rows.length ?? 0) === 0
              ? 'No recipe has produced a post yet. Recipes fill this as they run.'
              : 'No posts in this state right now.'}
          </p>
        ) : (
          <ul>
            {paged.map((row) => {
              const meta = KIND_META[row.kind];
              return (
                <li
                  key={row.id}
                  className="grid h-auto-row items-center pl-[28px] pr-[10px]"
                  style={{ gridTemplateColumns: QUEUE_COLUMNS, boxShadow: 'inset 0 -1px 0 rgba(131,131,131,0.1)' }}
                >
                  <div className="min-w-0 pr-[16px]">
                    <p className="truncate text-[19px] font-semibold leading-[1.28] text-ink" title={row.title}>
                      {row.title}
                    </p>
                    <span className="mt-[8px] flex items-center gap-[9px]">
                      <svg width="18" height="19" viewBox="0 0 24 25" fill="none" aria-hidden>
                        <rect x="2.7" y="4.1" width="18.6" height="18.4" rx="4" stroke="#838383" strokeWidth="1.7" />
                        <path d="M2.9 9.9h18.2" stroke="#838383" strokeWidth="1.7" strokeLinecap="round" />
                        <path d="M8.1 1.9v3.8M18.5 1.9v3.8" stroke="#838383" strokeWidth="1.7" strokeLinecap="round" />
                      </svg>
                      <span className="whitespace-nowrap text-[15.5px] font-medium" style={{ color: '#838383' }}>
                        {queueStamp(row.scheduledAt ?? row.createdAt)}
                      </span>
                    </span>
                  </div>

                  <div className="min-w-0 pr-[16px]">
                    <span
                      className="inline-flex h-[44px] max-w-full items-center gap-[9px] rounded-[11px] pl-[13px] pr-[7px]"
                      style={{ background: meta.chip, boxShadow: `inset 0 0 0 1px ${meta.chipRing}` }}
                    >
                      <span aria-hidden className="shrink-0 text-ink">
                        <RecipeGlyph kind={row.kind} size={19} />
                      </span>
                      <span className="truncate text-[14.5px] font-bold text-ink">{row.recipeName}</span>
                      {row.sub ? (
                        <span
                          className="inline-flex h-[32px] shrink-0 items-center rounded-[8px] bg-white px-[10px] text-[13px] font-semibold text-ink"
                          style={{ boxShadow: 'inset 0 0 0 0.8px rgba(12,12,12,0.12)' }}
                        >
                          {row.sub}
                        </span>
                      ) : null}
                    </span>
                  </div>

                  {/* The design draws an avatar and a handle here. Which account
                      a queued output publishes to is decided by the playbook
                      when it is drafted, and `recipe.output.list` does not carry
                      one — so the column says which recipe kind produced it
                      rather than inventing a person. */}
                  <span className="truncate pr-[16px] text-16 font-medium" style={{ color: '#5B5B5B' }}>
                    {row.account ?? 'Not assigned yet'}
                  </span>

                  <span className="pr-[16px]">
                    <span
                      className="inline-flex h-[40px] items-center gap-[8px] rounded-[9px] px-[15px] text-[14.5px] font-semibold"
                      style={{ background: row.chip.bg, boxShadow: `inset 0 0 0 1.06px ${row.chip.ring}`, color: row.chip.color }}
                    >
                      {row.chip.label}
                    </span>
                  </span>

                  <span className="flex items-center gap-[8px]">
                    <button
                      type="button"
                      onClick={() => onPreview(row)}
                      aria-label={`Preview ${row.title}`}
                      className="flex h-[37px] w-[37px] items-center justify-center rounded-[8px] transition-colors hover:bg-[rgba(131,131,131,0.08)]"
                      style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.4)' }}
                    >
                      <svg width="17" height="13" viewBox="0 0 19 15" fill="none" aria-hidden>
                        <path d="M1.5 7.5S4.4 1.8 9.5 1.8s8 5.7 8 5.7-2.9 5.7-8 5.7-8-5.7-8-5.7Z" stroke="#838383" strokeWidth="1.4" strokeLinejoin="round" />
                        <circle cx="9.5" cy="7.5" r="2.4" stroke="#838383" strokeWidth="1.4" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(row)}
                      aria-label={`Remove ${row.title} from the queue`}
                      className="flex h-[37px] w-[37px] items-center justify-center rounded-[8px] transition-colors hover:bg-[rgba(243,85,37,0.08)]"
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
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {/* 28,900 — "Page 1 of 4", with two 34px discs at 1216 and 1258 and the
            disabled one at .45. The design's card holds five rows between the
            rule at 240 and the pager at 900, so five is the page. */}
        <div className="flex items-center gap-[16px] px-[28px] pt-[20px]">
          <span className="text-16 font-medium" style={{ color: '#838383' }}>
            Page {pageCount === 0 ? 0 : page + 1} of {pageCount}
          </span>
          <span className="text-[14px]" style={{ color: '#9A9A9A' }}>
            {visible.length} of {rows?.length ?? 0} shown
          </span>
          <span className="ml-auto flex items-center gap-[8px]">
            <PageDisc back disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} label="Previous page" />
            <PageDisc disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} label="Next page" />
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * 28 / 600 / 952 / 1090 / 1226 on the design's 1318 card, as track widths.
 *
 * The right padding is 10, not 28: the design's second action button runs
 * 1271..1308, so the row's own right margin is 10 and a symmetric 28 would
 * squeeze 26px out of the first track — which is exactly what it did, dragging
 * every column left of where its heading says it is.
 */
const QUEUE_COLUMNS = '572px 352px 138px 136px 82px';

/** The pager's 34px discs — ringed `rgba(131,131,131,.35)`, the dead one at .45. */
function PageDisc({ back = false, disabled, onClick, label }: { back?: boolean; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-[34px] w-[34px] items-center justify-center rounded-full transition-colors enabled:hover:bg-[rgba(131,131,131,0.08)] disabled:cursor-default"
      style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)', opacity: disabled ? 0.45 : 1 }}
    >
      <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden style={back ? { transform: 'scaleX(-1)' } : undefined}>
        <path d="m1 1 5 5-5 5" stroke="#838383" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
