'use client';

import Link from 'next/link';
import { useState } from 'react';
import { writeSelectedGenome } from '@/lib/selectedGenome';
import { useAuth } from '@clerk/nextjs';
import type { RosterBrand } from './useAgencyRoster';

/**
 * The workspace table — the prototype's client list, measured off the stage
 * relative to the 1644-wide card:
 *
 *   headers  y28 · 16/600 `#5B5B5B` — Name 96 · Client Name 388 ·
 *            Team members 742 · Social Accounts 1046 · Industry 1330 ·
 *            Action 1544; a full-width rule at y66
 *   rows     from y67, **108 closed / 196 open**, 8 apart; an open row fills
 *            `#F4F4F6`
 *   mark     26,28 · 56x56 r14 on a per-brand gradient, its initial 24/700
 *   actions  1508 / 1556 / 1604 · 40x40 r10 — view (hairline), remove (an
 *            orange ring), expand on `#9CEFFF` whose chevron turns 0 -> 180
 *   open     a revenue chip on `#FBE4C2` and Payment Information on `#EFE3FB`
 *   footer   "Page 1 of 4" at 26 and two 34px round pagers at 1548 / 1592
 *
 * ── Which columns are real ────────────────────────────────────────────────
 *
 * `agency.roster` gives the brand, when it was last touched, and its published,
 * impression and engagement counts over 30 days — so Name is real and the
 * expanded row shows the numbers an agency actually opens this for.
 *
 * Client Name, Team members, Social Accounts and Industry are not on that read.
 * Team size is org-wide rather than per-brand (`team.list` returns membership
 * for the organisation, and `brands` rows carry no headcount), and there is no
 * client-of-a-brand relationship anywhere. Rather than draw four columns of
 * fixtures, the table shows what the roster knows: the brand, its activity, and
 * whether it has gone quiet — which is the column the design's own comment
 * calls "the single most important cell on this screen".
 *
 * Revenue and payment details in the expanded row have no source either — no
 * billing is recorded per brand — and say so.
 */

const MARKS = [
  'linear-gradient(140deg, #F06BF5 0%, #D24ED9 100%)',
  'linear-gradient(140deg, #6CE8FF 0%, #3AA7E8 100%)',
  'linear-gradient(140deg, #FFD79B 0%, #F2A03E 100%)',
  'linear-gradient(140deg, #A9F5C2 0%, #45C97C 100%)',
  'linear-gradient(140deg, #C9B6FF 0%, #8A5CF0 100%)',
];

const ROW = 108;
const ROW_OPEN = 196;
const GAP = 8;

export function AgencyClientTable({
  top,
  brands,
  windowDays,
  onOpenRow,
}: {
  top: number;
  brands: RosterBrand[];
  windowDays: number;
  /** Lifted so the stage can grow by 100 when a row expands, as the design does. */
  onOpenRow: (open: boolean) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { orgId } = useAuth();

  /* Row tops, walked in order — an open row is 88 taller and pushes the rest. */
  let y = 67;
  const laid = brands.map((b) => {
    const isOpen = openId === b.genomeId;
    const at = y;
    y += (isOpen ? ROW_OPEN : ROW) + GAP;
    return { b, isOpen, top: at, h: isOpen ? ROW_OPEN : ROW };
  });
  const height = y + 66;

  function toggle(id: string) {
    const next = openId === id ? null : id;
    setOpenId(next);
    onOpenRow(next !== null);
  }

  return (
    <section
      className="absolute left-ag-gutter w-ag-wide rounded-[20px] bg-white"
      style={{ top, height, boxShadow: '0 20px 50px -42px rgba(12,12,12,0.4)' }}
    >
      {/* ── headers ────────────────────────────────────────────────────── */}
      {[
        { x: 96, label: 'Name' },
        { x: 388, label: 'Last activity' },
        { x: 742, label: `Published (${windowDays}d)` },
        { x: 1046, label: 'Impressions' },
        { x: 1330, label: 'Status' },
        { x: 1544, label: 'Action' },
      ].map((h) => (
        <span
          key={h.label}
          className="absolute top-[28px] whitespace-nowrap text-[16px] font-semibold"
          style={{ left: h.x, color: 'rgb(91,91,91)' }}
        >
          {h.label}
        </span>
      ))}
      <div aria-hidden className="absolute left-0 top-[66px] h-px w-full" style={{ background: 'rgba(131,131,131,0.15)' }} />

      {brands.length === 0 ? (
        <p className="absolute left-[26px] top-[92px] text-[16px]" style={{ color: 'rgb(131,131,131)' }}>
          No brands in this organisation yet.
        </p>
      ) : null}

      {laid.map(({ b, isOpen, top: rowTop, h }, i) => (
        <div
          key={b.genomeId}
          className="absolute left-0 w-full rounded-[14px] transition-[height] duration-200"
          style={{ top: rowTop, height: h, background: isOpen ? 'var(--ss-ag-row-open)' : 'transparent' }}
        >
          <span
            aria-hidden
            className="absolute left-[26px] top-[28px] flex h-[56px] w-[56px] items-center justify-center rounded-[14px] text-[24px] font-bold text-white"
            style={{ background: MARKS[i % MARKS.length] }}
          >
            {b.name.slice(0, 1).toUpperCase()}
          </span>

          <span className="absolute left-[96px] top-[44px] max-w-[270px] truncate text-[19px] font-bold text-ink">
            {b.name}
          </span>

          <span className="absolute left-[388px] top-[46px] text-[17px] font-medium" style={{ color: 'rgb(91,91,91)' }}>
            {new Date(b.updatedAt).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>

          <span className="absolute left-[742px] top-[46px] text-[17px] font-medium" style={{ color: 'rgb(91,91,91)' }}>
            {b.publishedCount} {b.publishedCount === 1 ? 'post' : 'posts'}
          </span>

          <span className="absolute left-[1046px] top-[46px] text-[17px] font-medium" style={{ color: 'rgb(91,91,91)' }}>
            {b.impressions.toLocaleString()}
          </span>

          {/* The design's industry chip, carrying the fact the roster exists to
              surface: a paying client whose account has gone silent. */}
          <span
            className="absolute left-[1318px] flex h-[40px] items-center rounded-[9px] px-[12px] text-[15px] font-semibold"
            style={{
              top: 38,
              background: b.quiet ? '#FBD9FA' : '#D8F5E6',
              color: b.quiet ? '#D24ED9' : '#1F7A46',
            }}
          >
            {b.quiet ? 'Quiet' : 'Active'}
          </span>

          {/* ── the three actions ──────────────────────────────────────── */}
          <Link
            href="/home"
            onClick={() => {
              /* Opening a client's workspace means switching brand first —
                 otherwise the dashboard loads whichever brand was last used. */
              if (orgId) writeSelectedGenome(orgId, b.genomeId);
            }}
            aria-label={`Open ${b.name}`}
            title={`Open ${b.name}`}
            className="absolute top-[38px] flex h-[40px] w-[40px] items-center justify-center rounded-[10px] transition-colors hover:bg-white"
            style={{ left: 1508, boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)' }}
          >
            <svg width="16" height="12" viewBox="0 0 18 12" fill="none" aria-hidden>
              <path d="M1 6s2.9-5 8-5 8 5 8 5-2.9 5-8 5-8-5-8-5Z" stroke="rgb(12,12,12)" strokeWidth="1.4" strokeLinejoin="round" />
              <circle cx="9" cy="6" r="2.2" stroke="rgb(12,12,12)" strokeWidth="1.4" />
            </svg>
          </Link>

          {/*
            The design's second action removes the workspace. Deleting a brand
            is not a tool — nothing in the registry deletes one, deliberately,
            since it would take every campaign and asset with it — so this opens
            the brand's own settings, where its posture is actually changed.
          */}
          <Link
            href="/settings"
            onClick={() => {
              if (orgId) writeSelectedGenome(orgId, b.genomeId);
            }}
            aria-label={`Settings for ${b.name}`}
            title={`Settings for ${b.name}`}
            className="absolute top-[38px] flex h-[40px] w-[40px] items-center justify-center rounded-[10px] transition-colors hover:bg-white"
            style={{ left: 1556, boxShadow: 'inset 0 0 0 1px rgba(243,85,37,0.55)' }}
          >
            <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden>
              <circle cx="9" cy="9" r="2.6" stroke="#F35525" strokeWidth="1.5" />
              <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M14.3 3.7l-1.4 1.4M5.1 12.9l-1.4 1.4" stroke="#F35525" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </Link>

          <button
            type="button"
            onClick={() => toggle(b.genomeId)}
            aria-expanded={isOpen}
            aria-label={isOpen ? `Collapse ${b.name}` : `Expand ${b.name}`}
            className="absolute top-[38px] flex h-[40px] w-[40px] items-center justify-center rounded-[10px] bg-cyan-200"
            style={{ left: 1604 }}
          >
            <svg
              width="13"
              height="8"
              viewBox="0 0 12 8"
              fill="none"
              aria-hidden
              className="transition-transform duration-200"
              style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              <path d="M1 1l5 5 5-5" stroke="rgb(12,12,12)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* ── the expanded half ─────────────────────────────────────── */}
          {isOpen ? (
            <div className="absolute left-[26px] top-[108px] flex flex-wrap items-center gap-[18px]">
              <span className="flex h-[52px] items-center gap-[8px] rounded-[11px] bg-ag-peach px-[14px]">
                <span className="text-[22px] font-bold leading-none text-ink">{b.engagements.toLocaleString()}</span>
                <span className="text-[16px] font-medium" style={{ color: 'rgb(91,91,91)' }}>
                  engagements / {windowDays}d
                </span>
              </span>

              <span className="flex h-[60px] items-center gap-[12px] rounded-[12px] bg-ag-pay px-[16px]">
                <span className="text-[16px] font-semibold text-ink">Payment Information</span>
                <span
                  aria-hidden
                  className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] text-[19px] font-bold text-white"
                  style={{ background: 'var(--ss-ag-stripe)' }}
                >
                  S
                </span>
                {/*
                  The design shows a masked card number and a Copy button. No
                  billing is recorded per brand — `org.billing.plan.set` is
                  organisation-level — so this points at where it lives instead
                  of printing a card that is not this client's.
                */}
                <Link href="/settings/credits" className="text-[15.5px] font-medium underline underline-offset-2" style={{ color: 'rgb(91,91,91)' }}>
                  Billing is org-wide
                </Link>
              </span>
            </div>
          ) : null}
        </div>
      ))}

      {/* ── footer ─────────────────────────────────────────────────────── */}
      <div aria-hidden className="absolute left-0 h-px w-full" style={{ top: height - 66, background: 'rgba(131,131,131,0.1)' }} />
      <span className="absolute left-[26px] text-[16px] font-medium" style={{ top: height - 44, color: 'rgb(91,91,91)' }}>
        {brands.length} {brands.length === 1 ? 'workspace' : 'workspaces'}
      </span>
    </section>
  );
}
