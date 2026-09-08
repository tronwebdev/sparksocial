'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { LEAD_TRANSITIONS, type LeadSource, type LeadStatus } from '@sparksocial/shared/agencyPipeline';
import { cn } from '@/lib/utils';
import { useLeads, type Lead } from './useLeads';
import { LeadAddModal, LeadImportModal } from './LeadModals';
import { ProposalModal } from './ProposalModal';
import { useProposals } from './useProposals';
import { money } from './proposalText';
import { leadsToCsv } from './leadCsv';

/**
 * `Client Finder` / `Client Finder Saved Leads` — the agency's lead pipeline,
 * wired to `lead.*`.
 *
 * ── Geometry, unchanged from the design ──────────────────────────────────
 *
 *   empty     panel 46,190 · 1636x430 r24 on `--ss-grad-ag-dark`, over a
 *             `jobfinder-hero` starfield, with a 520x310 r14 preview at
 *             right:36,96 and two 64-tall chips at 1206,170 and 1462,170
 *   populated tabs 46,190 · 520x56 r14 (active half `#9CEFFF`), search
 *             600,190 · 330x56, two 170x56 filters at 950 and 1140,
 *             Import 1330,190, Add Lead 1508,190, table
 *             46,312 · 1636x806 r20 with headers at y26 and a rule at y64,
 *             rows **92 → 170** when opened
 *
 * ── Where the design describes a product that does not exist ─────────────
 *
 * The design's empty state is "Connect to Clienforce", a third-party lead
 * product invented for the mock. There is no such connector — but there *is*
 * real lead capture now, so the honest version of that panel offers the two
 * routes that work: import a sheet, or add one by hand. Keeping the fictional
 * branding on a screen whose feature actually functions would be worse than
 * dropping it: it would advertise an integration nobody can complete.
 *
 * **"Find Clients"** stays deliberately inert. It is prospecting — harvesting
 * businesses out of a directory — which collects personal data with no lawful
 * basis and generally breaks the source's terms. `lead.*` is capture, not
 * prospecting, and `packages/agency/test/leads.test.ts` asserts the family
 * never grows a tool named for it.
 *
 * The two tabs are relabelled. "My Search" and "Saved Leads" describe running
 * a scrape and keeping its results; with a real pipeline the two halves that
 * matter are the leads still in play and the ones that closed, so the pill
 * keeps its exact geometry and says what it now filters.
 *
 * ── Untrusted text ──────────────────────────────────────────────────────
 *
 * Every cell in this table came from a third party's spreadsheet. It is
 * rendered as text by React and never as HTML, and the CSV export neutralises
 * formula-leading cells (`@/lib/csv`), which is the one place this data leaves
 * for a program that would execute it.
 */

/** The design's own page size — 92-tall rows in an 806-tall table. */
const PAGE = 8;

type Tab = 'open' | 'closed';

const OPEN_STAGES: LeadStatus[] = ['new', 'contacted', 'qualified'];
const CLOSED_STAGES: LeadStatus[] = ['won', 'lost'];

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  won: 'Won',
  lost: 'Lost',
};

/**
 * The design's status pill is a green "Contacted". These keep that shape and
 * give each stage a tint that reads at a glance: live stages warm up as they
 * progress, won is the roster's own green, lost is grey rather than red — a
 * lost lead is a normal outcome, not an error.
 */
const STATUS_TINT: Record<LeadStatus, { background: string; color: string }> = {
  new: { background: '#E4EEFB', color: '#2B5EA7' },
  contacted: { background: '#DCF6E3', color: '#26A344' },
  qualified: { background: '#E6E0FB', color: '#6C4BE0' },
  won: { background: '#D8F5E6', color: '#1F7A46' },
  lost: { background: '#EFEFEF', color: 'rgb(91,91,91)' },
};

const SOURCE_LABEL: Record<LeadSource, string> = {
  manual: 'Added by hand',
  import: 'Imported',
  referral: 'Referral',
  inbound: 'Got in touch',
};

const ROW = 92;
const ROW_OPEN = 170;

export function AgencyClientFinder({
  onHasLeads,
  brands,
}: {
  /** Lifted so the stage can grow 760 → 1180, which the design does here. */
  onHasLeads: (v: boolean) => void;
  /** For `lead.convert` — the workspaces a won lead can be attached to. */
  brands: Array<{ brandId: string; name: string }>;
}) {
  const [tab, setTab] = useState<Tab>('open');
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<LeadStatus | ''>('');
  const [source, setSource] = useState<LeadSource | ''>('');
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [modal, setModal] = useState<'import' | 'add' | null>(null);
  /** The lead whose proposals are open, if any. */
  const [proposalsFor, setProposalsFor] = useState<Lead | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  /**
   * The tab picks the stages, and an explicit stage filter narrows within it.
   * Ordered this way so choosing "Won" while on Open cannot produce an empty
   * table for a reason nobody can see — the stage list is intersected with the
   * tab's own, and the filter only offers that tab's stages.
   */
  const status = useMemo<LeadStatus[]>(() => {
    const allowed = tab === 'open' ? OPEN_STAGES : CLOSED_STAGES;
    return stage && allowed.includes(stage) ? [stage] : allowed;
  }, [tab, stage]);

  const query = useMemo(
    () => ({
      status,
      source: source ? [source] : undefined,
      search,
      limit: PAGE,
      offset: page * PAGE,
    }),
    [status, source, search, page],
  );

  const { leads, total, counts, error, loading, busy, update, convert, create, importRows, pipelineSize } =
    useLeads(query);

  /**
   * One org-wide `proposal.list`, indexed by lead — see `useProposals`. It
   * gives every row its badge and the header the one number an agency asks a
   * pipeline for: what is out and undecided.
   */
  const proposals = useProposals();

  /* The stage grows once there is a pipeline to show. */
  useEffect(() => {
    onHasLeads(pipelineSize > 0);
  }, [pipelineSize, onHasLeads]);

  /* A filter change invalidates the page number — page 3 of a 1-page result is blank. */
  useEffect(() => {
    setPage(0);
    setOpenId(null);
  }, [tab, stage, source, search]);

  const pages = Math.max(1, Math.ceil(total / PAGE));

  async function move(lead: Lead, to: LeadStatus) {
    setRowError(await update(lead.id, { status: to }));
  }

  function exportCsv() {
    /**
     * Exports the rows on screen, under the filters on screen. Not the whole
     * pipeline: the button sits inside a filtered view, and handing back
     * something other than what is displayed is how an export gets mistrusted.
     */
    const blob = new Blob([leadsToCsv(leads)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const modals = (
    <>
      {modal === 'import' ? (
        <LeadImportModal onClose={() => setModal(null)} onImport={importRows} busy={busy} />
      ) : null}
      {modal === 'add' ? <LeadAddModal onClose={() => setModal(null)} onCreate={create} busy={busy} /> : null}
      {proposalsFor ? (
        <ProposalModal
          lead={proposalsFor}
          proposals={proposals.byLead[proposalsFor.id] ?? []}
          capped={proposals.total > 200}
          busy={proposals.busy}
          onClose={() => setProposalsFor(null)}
          onDraft={proposals.draft}
          onUpdate={proposals.update}
          onDecide={proposals.decide}
          onShare={proposals.share}
        />
      ) : null}
    </>
  );

  /* ── nothing captured yet ──────────────────────────────────────────── */
  const empty = (
      <>
        <section className="absolute left-ag-tool-x top-[190px] h-[430px] w-ag-tool-wide overflow-hidden rounded-[24px] bg-ag-dark">
          {/* eslint-disable-next-line @next/next/no-img-element -- a decorative full-bleed backdrop off the prototype */}
          <img src="/agency/jobfinder-hero.png" alt="" aria-hidden className="absolute left-0 top-0 h-full w-full object-cover" />

          <h2 className="absolute left-[82px] top-[74px] w-[760px] text-[44px] font-semibold leading-[1.1] text-white">
            Bring your client list in
          </h2>

          <p className="absolute left-[82px] top-[196px] w-[700px] text-[23px] font-normal leading-[1.35]" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Import a CSV from your CRM, or add prospects one at a time. Nothing is imported twice, so
            re-running the same sheet is safe.
          </p>

          <div className="absolute left-[82px] top-[300px] flex items-center gap-[14px]">
            <button
              type="button"
              onClick={() => setModal('import')}
              className="flex h-[58px] items-center rounded-[10px] px-[24px] text-[18px] font-bold text-white transition-[background-color,transform] hover:bg-[#1FBE41] active:scale-[0.985]"
              style={{ background: 'var(--ss-ag-clienforce)' }}
            >
              Import a CSV
            </button>
            <button
              type="button"
              onClick={() => setModal('add')}
              className="flex h-[58px] items-center rounded-[10px] px-[24px] text-[18px] font-semibold text-white transition-colors hover:bg-white/10"
              style={{ boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.4)' }}
            >
              + Add a lead
            </button>
          </div>

          {/* The design's 520x310 product shot, showing what a pipeline looks like. */}
          <div
            className="absolute right-[36px] top-[96px] h-[310px] w-[520px] overflow-hidden rounded-[14px]"
            style={{ background: '#FCFDFE', boxShadow: '0 30px 70px -40px rgba(0,0,0,0.8)' }}
          >
            <div className="absolute left-0 top-0 flex h-[44px] w-full items-center gap-[16px] px-[18px]" style={{ boxShadow: 'inset 0 -1px 0 rgba(131,131,131,0.15)' }}>
              <span className="text-[12px] font-semibold" style={{ color: 'rgb(91,91,91)' }}>Business Name</span>
              <span className="ml-auto text-[12px] font-medium" style={{ color: '#9B9B9B' }}>Status</span>
            </div>
            {[
              { name: 'Sunnyvale Innovations', where: 'Sunnyvale, CA', s: 'Contacted' as const },
              { name: 'Joe Coffee', where: 'Leeds', s: 'New' as const },
              { name: 'Atlas Studio', where: 'Lagos', s: 'Qualified' as const },
            ].map((r, i) => (
              <div key={r.name} className="absolute left-0 w-full px-[18px]" style={{ top: 60 + i * 74 }}>
                <div className="flex items-center gap-[12px]">
                  <span aria-hidden className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-[13px] font-bold" style={{ background: '#DCEFE2', color: '#26A344' }}>
                    {r.name.slice(0, 1)}
                  </span>
                  <span className="flex-1">
                    <span className="block text-[12.5px] font-bold text-ink">{r.name}</span>
                    <span className="block text-[10.5px]" style={{ color: '#9B9B9B' }}>{r.where}</span>
                  </span>
                  <span
                    className="flex h-[24px] items-center rounded-[12px] px-[9px] text-[10px] font-semibold"
                    style={STATUS_TINT[r.s.toLowerCase() as LeadStatus]}
                  >
                    {r.s}
                  </span>
                </div>
              </div>
            ))}
            <span aria-hidden className="absolute bottom-0 left-0 h-[54px] w-full" style={{ background: 'linear-gradient(180deg, rgba(252,253,254,0), #FCFDFE)' }} />
          </div>
        </section>

        {/* the design's two chips, level above the panel */}
        <div
          className="absolute left-[1206px] top-[170px] z-[3] flex h-[64px] w-[236px] items-center justify-center gap-[12px] rounded-[16px] bg-white"
          style={{ boxShadow: '0 14px 34px -20px rgba(12,12,12,0.45)' }}
        >
          <span aria-hidden className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-[15px] font-extrabold text-white" style={{ background: 'var(--ss-ag-clienforce)' }}>
            0
          </span>
          <span className="text-[17px] font-bold text-ink">No leads yet</span>
        </div>

        <button
          type="button"
          onClick={() => setModal('import')}
          className="absolute left-[1462px] top-[170px] z-[3] flex h-[64px] w-[220px] items-center justify-center gap-[12px] rounded-[16px] bg-white transition-shadow hover:shadow-card"
          style={{ boxShadow: '0 14px 34px -20px rgba(12,12,12,0.45)' }}
        >
          <span aria-hidden className="flex h-[30px] items-center rounded-[6px] px-[7px] text-[11px] font-bold" style={{ background: '#EFEFEF', color: 'rgb(91,91,91)' }}>
            CSV
          </span>
          <span className="text-[17px] font-bold text-ink">Import CSV</span>
        </button>

        {error ? (
          <p className="absolute left-ag-tool-x top-[640px] text-[15px] text-destructive">{error}</p>
        ) : null}
      </>
  );

  /* ── the pipeline ──────────────────────────────────────────────────── */
  const pipeline = (
    <>
      <div
        className="absolute left-ag-tool-x top-[190px] flex h-[56px] w-[520px] items-center rounded-[14px] bg-white p-[5px]"
        style={{ boxShadow: '0 10px 28px -18px rgba(12,12,12,0.28)' }}
        role="tablist"
        aria-label="Pipeline"
      >
        {(
          [
            ['open', 'In play', counts.new + counts.contacted + counts.qualified],
            ['closed', 'Won & lost', counts.won + counts.lost],
          ] as const
        ).map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              setStage('');
            }}
            className={cn(
              'flex h-[46px] w-[252px] items-center justify-center gap-[8px] rounded-[10px] text-[16px] font-semibold text-ink transition-colors',
              tab === id ? 'bg-cyan-200' : 'bg-white',
            )}
          >
            {label}
            <span className="text-[14px] font-medium" style={{ color: 'rgb(91,91,91)' }}>{n}</span>
          </button>
        ))}
      </div>

      <div className="absolute left-ag-tool-x top-[272px] flex items-center gap-[14px]">
        <span className="text-[17px] font-semibold" style={{ color: 'rgb(91,91,91)' }}>
          {loading ? 'Loading…' : `${total} ${total === 1 ? 'Result' : 'Results'}`}
        </span>
        {/* Summed by the tool under its own filters — no client-side sum over a
            page could produce this correctly, and a mixed-currency workspace
            deliberately gets no figure rather than a meaningless one. */}
        {proposals.pipeline.currency && proposals.pipeline.outstandingCents > 0 ? (
          <span
            className="flex h-[28px] items-center rounded-[8px] px-[10px] text-[13.5px] font-semibold"
            style={{ background: '#E4EEFB', color: '#2B5EA7' }}
            title="Total of every proposal sent and not yet decided"
          >
            {money(proposals.pipeline.outstandingCents, proposals.pipeline.currency)} out
          </span>
        ) : null}
        {proposals.pipeline.currency && proposals.pipeline.acceptedCents > 0 ? (
          <span
            className="flex h-[28px] items-center rounded-[8px] px-[10px] text-[13.5px] font-semibold"
            style={{ background: '#D8F5E6', color: '#1F7A46' }}
            title="Total of every accepted proposal"
          >
            {money(proposals.pipeline.acceptedCents, proposals.pipeline.currency)} won
          </span>
        ) : null}
      </div>

      <label
        className="absolute left-[600px] top-[190px] flex h-[56px] w-[330px] items-center rounded-[14px] bg-white px-[18px]"
        style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.25)' }}
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients"
          aria-label="Search clients"
          className="w-full bg-transparent text-[15.5px] font-medium text-ink outline-none"
        />
        <svg width="18" height="18" viewBox="0 0 26 26" fill="none" aria-hidden className="ml-[10px] block shrink-0">
          <circle cx="11" cy="11" r="8" stroke="#838383" strokeWidth="2" />
          <path d="m17 17 6 6" stroke="#838383" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </label>

      {/* The design's "Sources" and "Folder". There are no folders; the second
          filter narrows by stage, which is the axis the pipeline actually has. */}
      <Drop
        x={950}
        label="Sources"
        value={source}
        onChange={(v) => setSource(v as LeadSource | '')}
        options={(Object.keys(SOURCE_LABEL) as LeadSource[]).map((s) => ({ value: s, label: SOURCE_LABEL[s] }))}
      />
      <Drop
        x={1140}
        label="Stage"
        value={stage}
        onChange={(v) => setStage(v as LeadStatus | '')}
        options={(tab === 'open' ? OPEN_STAGES : CLOSED_STAGES).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
      />

      {/*
        The design's two header actions are "Export Clients" and "Find
        Clients" — one for getting data out, one for getting leads in. Since
        acquiring leads is the half that is real, both slots go to it: import a
        sheet, or add one by hand. Export moves down beside the pager, next to
        the rows it actually exports.
      */}
      <button
        type="button"
        onClick={() => setModal('import')}
        className="absolute left-[1330px] top-[190px] flex h-[56px] items-center gap-[10px] rounded-[14px] bg-white px-[20px] text-[15.5px] font-semibold text-ink transition-shadow hover:shadow-card"
        style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.25)' }}
      >
        <span aria-hidden className="flex h-[26px] items-center rounded-[6px] px-[6px] text-[10.5px] font-bold" style={{ background: '#EFEFEF', color: 'rgb(91,91,91)' }}>
          CSV
        </span>
        Import
      </button>

      {/*
        The design's green CTA runs a scrape. Nothing does — see the header —
        so the button that *is* real takes its place: adding a lead. "Find
        Clients" would be a promise the product cannot keep.
      */}
      <button
        type="button"
        onClick={() => setModal('add')}
        className="absolute left-[1508px] top-[190px] flex h-[56px] items-center rounded-[14px] px-[22px] text-[15.5px] font-bold text-white transition-[background-color,transform] hover:bg-[#1FBE41] active:scale-[0.985]"
        style={{ background: 'var(--ss-ag-clienforce)' }}
      >
        + Add Lead
      </button>

      <section
        className="absolute left-ag-tool-x top-[312px] h-[806px] w-ag-tool-wide overflow-hidden rounded-[20px] bg-white"
        style={{ boxShadow: '0 20px 50px -42px rgba(12,12,12,0.4)' }}
      >
        {[
          { x: 30, label: 'Business Name' },
          { x: 760, label: 'Location' },
          { x: 1010, label: 'Ranking' },
          { x: 1230, label: 'Status' },
          { x: 1500, label: 'View' },
        ].map((h) => (
          <span
            key={h.label}
            className="absolute top-[26px] whitespace-nowrap text-[16px] font-semibold"
            style={{ left: h.x, color: 'rgb(91,91,91)' }}
          >
            {h.label}
          </span>
        ))}
        <div aria-hidden className="absolute left-0 top-[64px] h-px w-full" style={{ background: 'rgba(131,131,131,0.15)' }} />

        {!loading && leads.length === 0 ? (
          <div className="absolute left-[30px] right-[30px] top-[130px] text-center">
            <p className="text-[19px] font-bold text-ink">Nothing matches</p>
            <p className="mx-auto mt-[12px] max-w-[560px] text-[15.5px] leading-[1.5]" style={{ color: 'rgb(131,131,131)' }}>
              {search.trim()
                ? `No lead in ${tab === 'open' ? 'play' : 'won or lost'} matches “${search.trim()}”.`
                : `No leads are ${tab === 'open' ? 'in play' : 'won or lost'} under these filters.`}
            </p>
          </div>
        ) : null}

        {rows(leads, openId).map(({ lead, top, height, isOpen }) => (
          <div
            key={lead.id}
            className="absolute left-0 w-full transition-[height] duration-200"
            style={{ top, height, background: isOpen ? 'var(--ss-ag-row-open)' : 'transparent' }}
          >
            <span
              aria-hidden
              className="absolute left-[30px] top-[20px] flex h-[52px] w-[52px] items-center justify-center rounded-full text-[20px] font-bold"
              style={{ background: '#DCEFE2', color: '#26A344' }}
            >
              {lead.businessName.slice(0, 1).toUpperCase()}
            </span>

            <span className="absolute left-[98px] top-[20px] flex max-w-[600px] items-center gap-[10px]">
              <span className="truncate text-[18.5px] font-bold text-ink">{lead.businessName}</span>
              {/* Visible without expanding, because that is the point: it tells
                  you whether opening the row is worth it. */}
              {(() => {
                const mine = proposals.byLead[lead.id] ?? [];
                const out = mine.find((x) => x.status === 'sent');
                const won = mine.find((x) => x.status === 'accepted');
                const show = won ?? out;
                if (!show) return null;
                return (
                  <span
                    className="flex h-[24px] shrink-0 items-center rounded-[6px] px-[8px] text-[11.5px] font-bold"
                    style={won ? { background: '#D8F5E6', color: '#1F7A46' } : { background: '#E4EEFB', color: '#2B5EA7' }}
                  >
                    {won ? 'Won' : 'Sent'} {money(show.totalContractCents, show.currency)}
                  </span>
                );
              })()}
            </span>

            {/* The design's contact strip: email · phone · a source chip. */}
            <div className="absolute left-[98px] top-[52px] flex items-center gap-[14px]">
              {lead.email ? (
                <a href={`mailto:${lead.email}`} className="max-w-[260px] truncate text-[14.5px] font-medium underline-offset-2 hover:underline" style={{ color: 'rgb(131,131,131)' }}>
                  {lead.email}
                </a>
              ) : null}
              {lead.email && lead.phone ? <span aria-hidden className="block h-[4px] w-[4px] rounded-full" style={{ background: '#B0B0B0' }} /> : null}
              {lead.phone ? (
                <a href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`} className="text-[14.5px] font-medium underline-offset-2 hover:underline" style={{ color: 'rgb(131,131,131)' }}>
                  {lead.phone}
                </a>
              ) : null}
              {!lead.email && !lead.phone ? (
                <span className="text-[14.5px] font-medium" style={{ color: '#B0B0B0' }}>No contact details</span>
              ) : null}
              <span className="flex h-[24px] items-center rounded-[6px] px-[8px] text-[11.5px] font-bold" style={{ background: '#EFEFEF', color: 'rgb(91,91,91)' }}>
                {SOURCE_LABEL[lead.source]}
              </span>
            </div>

            <span className="absolute left-[760px] top-[36px] block max-w-[220px] truncate text-[16px] font-medium" style={{ color: 'rgb(91,91,91)' }}>
              {lead.location ?? '—'}
            </span>

            {/*
              The design's star rating. `rating` is the agency's own 0–5 score
              and is never inferred — there is no signal that could rank a
              business this product knows nothing about — so an unscored lead
              shows a dash rather than a fabricated 4.5.
            */}
            <span className="absolute left-[1010px] top-[30px] flex items-center gap-[8px]">
              {lead.rating === undefined ? (
                <span className="text-[16px] font-medium" style={{ color: '#B0B0B0' }} title="Not scored">—</span>
              ) : (
                <>
                  <svg width="18" height="17" viewBox="0 0 18 17" fill="none" aria-hidden className="block">
                    <path d="m9 1 2.3 5 5.2.5-4 3.5 1.2 5.2L9 12.4 4.3 15.2 5.5 10 1.5 6.5 6.7 6 9 1Z" fill="#F8B84A" />
                  </svg>
                  <span className="text-[16.5px] font-bold text-ink">{lead.rating.toFixed(1)}</span>
                </>
              )}
            </span>

            <span
              className="absolute left-[1230px] top-[26px] flex h-[38px] items-center rounded-[19px] px-[14px] text-[14.5px] font-semibold"
              style={STATUS_TINT[lead.status]}
            >
              {STATUS_LABEL[lead.status]}
            </span>

            <button
              type="button"
              onClick={() => {
                setOpenId(isOpen ? null : lead.id);
                setRowError(null);
              }}
              aria-expanded={isOpen}
              aria-label={isOpen ? `Collapse ${lead.businessName}` : `View ${lead.businessName}`}
              className="absolute left-[1488px] top-[26px] flex h-[40px] items-center rounded-[10px] px-[18px] text-[15px] font-semibold text-ink transition-colors hover:bg-[rgba(131,131,131,0.06)]"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)' }}
            >
              {isOpen ? 'Close' : 'View'}
            </button>

            {/* ── the expanded half ──────────────────────────────────── */}
            {isOpen ? (
              <div className="absolute left-[30px] right-[30px] top-[100px] flex flex-wrap items-center gap-[14px]">
                {lead.email ? (
                  <a
                    href={`mailto:${lead.email}?subject=${encodeURIComponent(`${lead.businessName} — social media`)}`}
                    className="flex h-[46px] items-center rounded-[11px] bg-ink px-[20px] text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    Contact Lead
                  </a>
                ) : (
                  <span
                    className="flex h-[46px] items-center rounded-[11px] bg-ink px-[20px] text-[15px] font-semibold text-white"
                    style={{ opacity: 0.45 }}
                    title="No email on this lead"
                  >
                    Contact Lead
                  </span>
                )}

                {/*
                  The design's four hairline actions are the stage moves the
                  pipeline permits from where this lead is — read from
                  `LEAD_TRANSITIONS` rather than hardcoded, so the row can never
                  offer a move the tool would refuse.
                */}
                {LEAD_TRANSITIONS[lead.status]
                  /* `won` is reached through the Convert control beside these,
                     because it needs the workspace the client will work in. */
                  .filter((to) => to !== 'won')
                  .map((to) => (
                    <button
                      key={to}
                      type="button"
                      onClick={() => void move(lead, to)}
                      disabled={busy}
                      className="flex h-[46px] items-center rounded-[11px] bg-white px-[18px] text-[15px] font-medium text-ink transition-shadow hover:shadow-card disabled:opacity-45"
                      style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)' }}
                    >
                      Mark {STATUS_LABEL[to].toLowerCase()}
                    </button>
                  ))}

                {/*
                  Winning goes through `lead.convert`, which needs the brand the
                  client will work in — that is why it is a select and not a
                  button, and why `Mark won` above is disabled.
                */}
                {lead.status !== 'won' && brands.length > 0 ? (
                  <label className="flex h-[46px] items-center gap-[10px] rounded-[11px] bg-white px-[16px]" style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)' }}>
                    <span className="text-[14.5px] font-medium" style={{ color: 'rgb(91,91,91)' }}>Won — client works in</span>
                    <select
                      defaultValue=""
                      onChange={async (e) => {
                        if (!e.target.value) return;
                        setRowError(await convert(lead.id, e.target.value));
                      }}
                      aria-label={`Convert ${lead.businessName} to a client`}
                      className="cursor-pointer appearance-none bg-transparent text-[14.5px] font-semibold text-ink outline-none"
                    >
                      <option value="">Choose…</option>
                      {brands.map((b) => (
                        <option key={b.brandId} value={b.brandId}>{b.name}</option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {lead.status === 'won' && lead.convertedBrandId ? (
                  <Link
                    href="/agency"
                    className="flex h-[46px] items-center rounded-[11px] px-[18px] text-[15px] font-semibold"
                    style={{ background: '#D8F5E6', color: '#1F7A46' }}
                  >
                    {brands.find((b) => b.brandId === lead.convertedBrandId)?.name ?? 'Client workspace'}
                  </Link>
                ) : null}

                {/*
                  Proposals open in their own modal rather than growing this
                  row: a priced offer is a document, and the design's row is 170
                  tall inside a table that shows eight of them.
                */}
                <button
                  type="button"
                  onClick={() => setProposalsFor(lead)}
                  className="flex h-[46px] items-center gap-[9px] rounded-[11px] bg-white px-[18px] text-[15px] font-semibold text-ink transition-shadow hover:shadow-card"
                  style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)' }}
                >
                  Proposals
                  <span
                    className="flex h-[22px] min-w-[22px] items-center justify-center rounded-[11px] px-[6px] text-[12px] font-bold"
                    style={{ background: '#EFEFEF', color: 'rgb(91,91,91)' }}
                  >
                    {(proposals.byLead[lead.id] ?? []).length}
                  </span>
                </button>

                {lead.interest ? (
                  <span className="max-w-[260px] truncate text-[14.5px] font-medium" style={{ color: 'rgb(91,91,91)' }} title={lead.interest}>
                    Wants: {lead.interest}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div aria-hidden className="absolute bottom-0 left-0 h-px w-full" style={{ background: 'rgba(131,131,131,0.1)' }} />
          </div>
        ))}

        {rowError ? (
          <p className="absolute bottom-[62px] left-[30px] text-[14.5px] text-destructive">{rowError}</p>
        ) : null}

        <div className="absolute bottom-[20px] left-[30px] flex items-center gap-[16px]">
          <span className="text-[16px] font-medium" style={{ color: 'rgb(91,91,91)' }}>
            Page {page + 1} of {pages}
          </span>
          <button
            type="button"
            onClick={exportCsv}
            disabled={leads.length === 0}
            className="flex h-[34px] items-center rounded-[9px] bg-white px-[14px] text-[14px] font-semibold text-ink transition-shadow hover:shadow-card disabled:opacity-50"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
            title={leads.length === 0 ? 'Nothing on this page to export' : 'Download the rows shown as CSV'}
          >
            Export Clients
          </button>
        </div>

        {(
          [
            { left: 1548, delta: -1, flip: true, label: 'Previous page' },
            { left: 1592, delta: 1, flip: false, label: 'Next page' },
          ] as const
        ).map((pg) => {
          const next = page + pg.delta;
          const can = next >= 0 && next < pages;
          return (
            <button
              key={pg.left}
              type="button"
              onClick={() => can && setPage(next)}
              disabled={!can}
              aria-label={pg.label}
              className="absolute bottom-[20px] flex h-[34px] w-[34px] items-center justify-center rounded-full transition-colors hover:bg-[rgba(131,131,131,0.08)] disabled:opacity-45 disabled:hover:bg-transparent"
              style={{ left: pg.left, boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)' }}
            >
              <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden className="block" style={{ transform: pg.flip ? 'scaleX(-1)' : undefined }}>
                <path d="m1 1 5 5-5 5" stroke="#838383" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          );
        })}
      </section>

      {error ? (
        <p className="absolute left-ag-tool-x top-[1130px] text-[15px] text-destructive">{error}</p>
      ) : null}
    </>
  );

  /*
    ONE return, with the modals at a stable position in the tree.

    They used to be rendered inside each branch, which meant a successful
    import — the thing that flips this component from `empty` to `pipeline` —
    moved the modal to a different position and React unmounted it, throwing
    away the result screen it had just been given. The body may remount freely;
    the modal must not.
  */
  return (
    <>
      {!loading && pipelineSize === 0 ? empty : pipeline}
      {modals}
    </>
  );
}

/** Row tops, walked in order — an open row is 78 taller and pushes the rest. */
function rows(leads: Lead[], openId: string | null) {
  let y = 65;
  return leads.map((lead) => {
    const isOpen = openId === lead.id;
    const height = isOpen ? ROW_OPEN : ROW;
    const at = y;
    y += height;
    return { lead, top: at, height, isOpen };
  });
}

/**
 * The design's 170x56 filter, as a real select.
 *
 * A native `<select>` under the design's chrome rather than a custom popover:
 * it is one control, it is keyboard- and screen-reader-correct for free, and a
 * bespoke listbox here would be the fourth in this codebase.
 */
function Drop({
  x,
  label,
  value,
  onChange,
  options,
}: {
  x: number;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const active = value !== '';
  return (
    <label
      className="absolute top-[190px] flex h-[56px] w-[170px] cursor-pointer items-center justify-between rounded-[14px] bg-white px-[18px]"
      style={{
        left: x,
        boxShadow: active ? 'inset 0 0 0 1.5px rgba(12,12,12,0.45)' : 'inset 0 0 0 1px rgba(131,131,131,0.25)',
      }}
    >
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="w-full cursor-pointer appearance-none bg-transparent text-[15.5px] font-semibold text-ink outline-none"
      >
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <svg width="12" height="7" viewBox="0 0 13 8" fill="none" aria-hidden className="block shrink-0">
        <path d="m1 1 5.5 6L12 1" stroke="#5B5B5B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </label>
  );
}
