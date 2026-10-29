'use client';

import Link from 'next/link';
import { useState } from 'react';
import { writeSelectedGenome } from '@/lib/selectedGenome';
import { useAuth } from '@clerk/nextjs';
import { DeleteBrandModal } from './DeleteBrandModal';
import type { RosterBrand } from './useAgencyRoster';
import { SECTION } from '@/components/shell/narrowStage';
import { cn } from '@/lib/utils';
import { PlatformIcon } from '@/components/common/PlatformIcon';
import { platformLabel } from '@/lib/platforms';

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

/**
 * The per-brand mark gradients.
 *
 * The first is the prototype's, measured: `SparkSocial Agency Portal.dc.html`
 * paints all three of its mocked rows in `#F06BF5 → #D24ED9` and draws no
 * second gradient. The four after it are not in any prototype.
 *
 * They exist because the mock has three rows and an agency has forty. One
 * magenta repeated down a roster of forty clients is a column of identical
 * circles, and the initial inside each is then the only thing telling them
 * apart — which is the opposite of what a per-brand mark is for.
 *
 * Recorded because an audit cannot tell a deliberate extension from a hex
 * somebody typed from memory, and this file had nothing to say either way.
 * See `scripts/colour-audit.mjs`.
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

/**
 * The card's height for `count` rows — the same walk the component does, so
 * the stage can be sized to it. See `AgencyPortalScreen`.
 */
export function clientTableHeight(count: number, rowOpen: boolean): number {
  const rows = count * (ROW + GAP) + (rowOpen ? ROW_OPEN - ROW : 0);
  return 67 + rows + (count === 0 ? 56 : 0) + 66;
}

export function AgencyClientTable({
  top,
  brands,
  windowDays,
  onOpenRow,
  onDeleted,
}: {
  top: number;
  brands: RosterBrand[];
  windowDays: number;
  /** Lifted so the stage can grow by 100 when a row expands, as the design does. */
  onOpenRow: (open: boolean) => void;
  /** Re-reads the roster once a brand is gone, so the row it was on disappears. */
  onDeleted: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<RosterBrand | null>(null);
  const { orgId } = useAuth();

  /* Row tops, walked in order — an open row is 88 taller and pushes the rest. */
  let y = 67;
  const laid = brands.map((b) => {
    const isOpen = openId === b.genomeId;
    const at = y;
    y += (isOpen ? ROW_OPEN : ROW) + GAP;
    return { b, isOpen, top: at, h: isOpen ? ROW_OPEN : ROW };
  });
  /* With no rows the card was 133 tall, and the 66px footer's "0 workspaces"
     landed on the empty-state line at 92. The empty state gets a row's room. */
  if (brands.length === 0) y += 56;
  const height = y + 66;

  function toggle(id: string) {
    const next = openId === id ? null : id;
    setOpenId(next);
    onOpenRow(next !== null);
  }

  return (
    <section
      className={cn('absolute left-ag-gutter w-ag-wide rounded-[20px] bg-white', SECTION)}
      style={{ top, height, boxShadow: '0 20px 50px -42px rgba(12,12,12,0.4)' }}
    >
      {/* ── headers ────────────────────────────────────────────────────── */}
      {[
        /*
          The design's columns — Team members, Social Accounts Connected,
          Industry — from real data now that `agency.roster` returns them. The
          table showed publishing figures there instead; those move into the
          expanded row. The design's "Client Name" (a contact person) has no
          field in the data model, so that slot keeps Last activity.
        */
        { x: 96, label: 'Name' },
        { x: 388, label: 'Last activity' },
        { x: 742, label: 'Team members' },
        { x: 1046, label: 'Social Accounts Connected' },
        { x: 1330, label: 'Industry' },
        { x: 1544, label: 'Action' },
      ].map((h) => (
        /*
          Column headings label columns. Below the breakpoint a row is a stacked
          card rather than six cells on a line, so there are no columns for these
          to be over — six stray words above the list is worse than none. The
          same reason the 66px rule beneath them goes.
        */
        <span
          key={h.label}
          className="absolute top-[28px] whitespace-nowrap text-16 font-semibold max-canvas:hidden"
          style={{ left: h.x, color: 'rgb(91,91,91)' }}
        >
          {h.label}
        </span>
      ))}
      <div
        aria-hidden
        className="absolute left-0 top-[66px] h-px w-full max-canvas:hidden"
        style={{ background: 'rgba(131,131,131,0.15)' }}
      />

      {brands.length === 0 ? (
        <p className="absolute left-[26px] top-[92px] text-16" style={{ color: 'rgb(131,131,131)' }}>
          No brands in this organisation yet.
        </p>
      ) : null}

      {laid.map(({ b, isOpen, top: rowTop, h }, i) => (
        /*
          A row is six cells at 96, 388, 742, 1046, 1330 and 1544 across a
          1644px card. Below the breakpoint it becomes a card of its own, its
          cells stacked in the order they read across — `SECTION` is the same
          flow-and-flatten the section above it got, applied one level down,
          because flattening a parent does not reach a grandchild.
        */
        <div
          key={b.genomeId}
          className={cn('absolute left-0 w-full rounded-[14px] transition-[height] duration-200', SECTION)}
          style={{ top: rowTop, height: h, background: isOpen ? 'var(--ss-ag-row-open)' : 'transparent' }}
        >
          <span
            aria-hidden
            className="absolute left-[26px] top-[28px] flex h-[56px] w-[56px] items-center justify-center rounded-[14px] text-24 font-bold text-white"
            style={{ background: MARKS[i % MARKS.length] }}
          >
            {b.name.slice(0, 1).toUpperCase()}
          </span>

          <span className="absolute left-[96px] top-[44px] max-w-[270px] truncate text-19 font-bold text-ink">
            {b.name}
          </span>

          <span className="absolute left-[388px] top-[46px] text-17 font-medium" style={{ color: 'rgb(91,91,91)' }}>
            {new Date(b.updatedAt).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>

          <span className="absolute left-[742px] top-[46px] text-17 font-medium" style={{ color: 'rgb(91,91,91)' }}>
            {b.teamMembers === 0 ? 'No one assigned' : `${b.teamMembers} ${b.teamMembers === 1 ? 'member' : 'members'}`}
          </span>

          {/* The design overlaps four avatars, each badged with a platform; the
              real fact is which platforms are connected, so it overlaps those. */}
          <span className="absolute left-[1046px] top-[36px] flex items-center">
            {b.platforms.length === 0 ? (
              <span className="mt-[10px] text-17 font-medium" style={{ color: 'rgb(131,131,131)' }}>
                None connected
              </span>
            ) : (
              b.platforms.slice(0, 5).map((p, k) => (
                <span
                  key={p}
                  title={platformLabel(p)}
                  className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-white"
                  style={{ marginLeft: k === 0 ? 0 : -12, boxShadow: '0 0 0 2px #FFFFFF, 0 4px 10px -6px rgba(12,12,12,0.4)' }}
                >
                  <PlatformIcon platform={p} size={24} />
                </span>
              ))
            )}
          </span>

          {/* The design's industry chip, on the pink it draws it in. */}
          {b.industry ? (
            <span
              className="absolute left-[1318px] flex h-[40px] max-w-[190px] items-center rounded-[9px] px-[15px] text-15 font-semibold"
              style={{ top: 38, background: '#FBD9FA', color: '#D24ED9' }}
              title={b.industry}
            >
              <span className="truncate">{b.industry}</span>
            </span>
          ) : (
            <span className="absolute left-[1330px] top-[46px] text-17 font-medium" style={{ color: 'rgb(131,131,131)' }}>
              —
            </span>
          )}

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
            The design's second action removes the workspace, and now it does.
            This used to open Settings instead, under a comment explaining that
            nothing in the registry deleted a brand — which was true when it was
            written and is the reason the substitution is worth recording rather
            than silently dropping: `brand.delete` exists, so the orange ring
            means what the design meant by it.
          */}
          <button
            type="button"
            onClick={() => setDeleting(b)}
            aria-label={`Delete ${b.name}`}
            title={`Delete ${b.name}`}
            className="absolute top-[38px] flex h-[40px] w-[40px] items-center justify-center rounded-[10px] transition-colors hover:bg-white"
            style={{ left: 1556, boxShadow: 'inset 0 0 0 1px rgba(243,85,37,0.55)' }}
          >
            <svg width="16" height="17" viewBox="0 0 16 17" fill="none" aria-hidden>
              <path d="M1.8 4.2h12.4M6.1 1.8h3.8M3.3 4.2l.8 10a1 1 0 0 0 1 1h5.8a1 1 0 0 0 1-1l.8-10M6.5 7.2v5.2M9.5 7.2v5.2" stroke="#F35525" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => toggle(b.genomeId)}
            aria-expanded={isOpen}
            aria-label={isOpen ? `Collapse ${b.name}` : `Expand ${b.name}`}
            className="absolute top-[38px] flex h-[40px] w-[40px] items-center justify-center rounded-[10px] bg-cyan-200 transition-colors hover:bg-cyan"
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

          {/* The design rules every row off at its own bottom edge. */}
          <div aria-hidden className="absolute bottom-0 left-0 h-px w-full" style={{ background: 'rgba(131,131,131,0.1)' }} />

          {/* ── the expanded half ─────────────────────────────────────── */}
          {isOpen ? (
            <div className="absolute left-[26px] top-[108px] flex flex-wrap items-center gap-[18px]">
              {/* Whether anything went out — the fact an agency opens this for —
                  then the window's numbers, which used to be columns. */}
              <span
                className="flex h-[40px] items-center rounded-[9px] px-[15px] text-15 font-semibold"
                style={{ background: b.quiet ? '#FBD9FA' : '#D8F5E6', color: b.quiet ? '#D24ED9' : '#1F7A46' }}
              >
                {b.quiet ? 'Quiet' : 'Active'}
              </span>
              {[
                { n: b.publishedCount, label: `${b.publishedCount === 1 ? 'post' : 'posts'} / ${windowDays}d` },
                { n: b.impressions, label: 'impressions' },
                { n: b.engagements, label: `engagements / ${windowDays}d` },
              ].map((m) => (
                <span key={m.label} className="flex h-[52px] items-center gap-[8px] rounded-[11px] bg-ag-peach px-[14px]">
                  <span className="text-22 font-bold leading-none text-ink">{m.n.toLocaleString()}</span>
                  <span className="text-16 font-medium" style={{ color: 'rgb(91,91,91)' }}>
                    {m.label}
                  </span>
                </span>
              ))}

              <span className="flex h-[60px] items-center gap-[12px] rounded-[12px] bg-ag-pay px-[16px]">
                <span className="text-16 font-semibold text-ink">Payment Information</span>
                <span
                  aria-hidden
                  className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] text-19 font-bold text-white"
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
                <Link href="/organization/billing" className="text-16 font-medium underline underline-offset-2" style={{ color: 'rgb(91,91,91)' }}>
                  Billing is org-wide
                </Link>
              </span>
            </div>
          ) : null}
        </div>
      ))}

      {/* ── footer ─────────────────────────────────────────────────────── */}
      <div aria-hidden className="absolute left-0 h-px w-full" style={{ top: height - 66, background: 'rgba(131,131,131,0.1)' }} />
      <span className="absolute bottom-[24px] left-[26px] text-16 font-medium" style={{ color: 'rgb(91,91,91)' }}>
        {brands.length} {brands.length === 1 ? 'workspace' : 'workspaces'}
      </span>

      {/*
        The design's pagers. `agency.roster` returns the whole org in one read —
        there is no cursor and no second page — so both are present and inert
        rather than wired to a page that does not exist.
      */}
      {([
        { left: 1548, flip: true },
        { left: 1592, flip: false },
      ] as const).map((pg) => (
        <span
          key={pg.left}
          aria-hidden
          className="absolute bottom-[20px] flex h-[34px] w-[34px] items-center justify-center rounded-full"
          style={{ left: pg.left, boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)', opacity: 0.45 }}
        >
          <svg width="7" height="12" viewBox="0 0 7 12" fill="none" className="block" style={{ transform: pg.flip ? 'scaleX(-1)' : undefined }}>
            <path d="m1 1 5 5-5 5" stroke="#838383" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      ))}
      {deleting ? (
        <DeleteBrandModal
          brandId={deleting.brandId}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            onDeleted();
          }}
        />
      ) : null}
    </section>
  );
}
