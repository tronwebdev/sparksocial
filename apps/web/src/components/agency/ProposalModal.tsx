'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  PROPOSAL_SERVICE_LABELS,
  PROPOSAL_TRANSITIONS,
  proposalTotals,
  type LineRecurrence,
  type ProposalService,
  type ProposalStatus,
} from '@sparksocial/shared/agencyPipeline';
import { cn } from '@/lib/utils';
import type { DraftInput, Proposal } from './useProposals';
import { majorUnits, money, parseMoney, proposalToText } from './proposalText';

/**
 * The proposals for one lead — opened from its expanded row.
 *
 * ── Why a modal rather than more row ─────────────────────────────────────
 *
 * A proposal is a document: a term, a currency, and a set of priced lines. The
 * design's row is 92 tall and 170 opened, inside an 806-tall table showing
 * eight of them; growing it to fit a line-item editor would break both the row
 * rhythm and the page size the design specifies. So the row carries the
 * *signal* — how many offers, and what is out — and the document lives here.
 *
 * ── The three things this screen has to get right ─────────────────────────
 *
 *   1. **The arithmetic, live.** `proposalTotals` from `@sparksocial/shared` is
 *      the same function the tool stores its totals with, so the number on
 *      screen while somebody types is the number that will be saved. Computing
 *      it here a second way is how a UI and a contract come to disagree.
 *   2. **Only a draft is editable.** Once the client has seen a price, the
 *      record of what was offered has to survive. The tool refuses it; this
 *      does not offer it.
 *   3. **Sending is honest.** `proposal.share` marks it sent and mints a real
 *      expiring credential — but nothing serves that link yet, so the primary
 *      action is the copyable text and the link comes with the truth attached.
 *      See `proposalText.ts`.
 */

const STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

const STATUS_TINT: Record<ProposalStatus, { background: string; color: string }> = {
  draft: { background: '#EFEFEF', color: 'rgb(91,91,91)' },
  sent: { background: '#E4EEFB', color: '#2B5EA7' },
  accepted: { background: '#D8F5E6', color: '#1F7A46' },
  declined: { background: '#FBE4E4', color: '#A32626' },
  withdrawn: { background: '#EFEFEF', color: '#8A8A8A' },
};

const SERVICES = Object.keys(PROPOSAL_SERVICE_LABELS) as ProposalService[];

const BTN_GHOST =
  'flex h-[40px] items-center rounded-[9px] bg-white px-[16px] text-[14.5px] font-semibold transition-shadow hover:shadow-card disabled:opacity-45';
const BTN_SOLID =
  'flex h-[40px] items-center rounded-[9px] bg-ink px-[18px] text-[14.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-45';
const RING = { boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' } as const;
const FIELD = 'h-[46px] w-full rounded-[10px] bg-white px-[14px] text-[15px] font-medium text-ink outline-none';

/* ── the line the editor works on ──────────────────────────────────── */

interface LineDraft {
  service: ProposalService;
  description: string;
  /** Kept as the typed string so a half-entered "20." does not snap to 20. */
  price: string;
  quantity: number;
  recurrence: LineRecurrence;
}

const emptyLine = (): LineDraft => ({
  service: 'content_creation',
  description: '',
  price: '',
  quantity: 1,
  recurrence: 'monthly',
});

const toLines = (p: Proposal): LineDraft[] =>
  p.lineItems.map((li) => ({
    service: li.service,
    description: li.description ?? '',
    price: majorUnits(li.unitCents),
    quantity: li.quantity,
    recurrence: li.recurrence,
  }));

/* ── the modal ─────────────────────────────────────────────────────── */

type View = { kind: 'list' } | { kind: 'edit'; proposal?: Proposal } | { kind: 'sent'; proposal: Proposal; token: string; expiresAt: string };

export function ProposalModal({
  lead,
  proposals,
  capped,
  busy,
  onClose,
  onDraft,
  onUpdate,
  onDecide,
  onShare,
}: {
  lead: { id: string; businessName: string };
  proposals: Proposal[];
  /** True when the org has more proposals than one page — badges may under-report. */
  capped: boolean;
  busy: boolean;
  onClose: () => void;
  onDraft: (input: DraftInput) => Promise<string | null>;
  onUpdate: (proposalId: string, patch: Partial<Omit<DraftInput, 'leadId'>>) => Promise<string | null>;
  onDecide: (proposalId: string, outcome: 'accepted' | 'declined' | 'withdrawn') => Promise<string | null>;
  onShare: (proposalId: string, days: number) => Promise<{ token?: string; expiresAt?: string; error?: string }>;
}) {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function send(p: Proposal) {
    setError(null);
    const { token, expiresAt, error: err } = await onShare(p.id, 14);
    if (err || !token || !expiresAt) {
      setError(err ?? 'Sending did not return a link.');
      return;
    }
    setView({ kind: 'sent', proposal: p, token, expiresAt });
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto px-4 py-[5vh]"
      role="dialog"
      aria-modal="true"
      aria-label={`Proposals for ${lead.businessName}`}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        style={{ background: 'rgba(12,12,12,0.28)', backdropFilter: 'blur(6px)' }}
      />

      <div
        className="relative w-[880px] max-w-full rounded-[20px] bg-white px-[36px] pb-[28px] pt-[26px]"
        style={{ boxShadow: '0 40px 90px -40px rgba(12,12,12,0.5)' }}
      >
        <div className="flex items-start justify-between gap-[16px]">
          <div className="min-w-0">
            <h2 className="truncate text-[23px] font-bold leading-[1.25] text-ink">
              {view.kind === 'edit' ? (view.proposal ? 'Revise proposal' : 'New proposal') : 'Proposals'}
            </h2>
            <p className="mt-[6px] truncate text-[15px] font-normal" style={{ color: 'rgb(131,131,131)' }}>
              {lead.businessName}
            </p>
          </div>
          {view.kind === 'list' ? (
            <button type="button" onClick={() => setView({ kind: 'edit' })} className={BTN_SOLID}>
              + New proposal
            </button>
          ) : (
            <button type="button" onClick={() => setView({ kind: 'list' })} className={BTN_GHOST} style={RING}>
              Back
            </button>
          )}
        </div>

        <div className="mt-[22px]">
          {view.kind === 'list' ? (
            <ProposalList
              proposals={proposals}
              capped={capped}
              busy={busy}
              lead={lead}
              onEdit={(p) => setView({ kind: 'edit', proposal: p })}
              onSend={send}
              onDecide={async (id, outcome) => setError(await onDecide(id, outcome))}
            />
          ) : null}

          {view.kind === 'edit' ? (
            <ProposalEditor
              key={view.proposal?.id ?? 'new'}
              leadId={lead.id}
              existing={view.proposal}
              busy={busy}
              onCancel={() => setView({ kind: 'list' })}
              onSave={async (input) => {
                const err = view.proposal
                  ? await onUpdate(view.proposal.id, {
                      title: input.title,
                      currency: input.currency,
                      termMonths: input.termMonths,
                      lineItems: input.lineItems,
                      notes: input.notes,
                    })
                  : await onDraft(input);
                if (err) {
                  setError(err);
                  return;
                }
                setError(null);
                setView({ kind: 'list' });
              }}
            />
          ) : null}

          {view.kind === 'sent' ? (
            <SentPanel proposal={view.proposal} token={view.token} expiresAt={view.expiresAt} lead={lead} />
          ) : null}
        </div>

        {error ? <p className="mt-[16px] text-[15px] text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}

/* ── list ──────────────────────────────────────────────────────────── */

function ProposalList({
  proposals,
  capped,
  busy,
  lead,
  onEdit,
  onSend,
  onDecide,
}: {
  proposals: Proposal[];
  capped: boolean;
  busy: boolean;
  lead: { businessName: string };
  onEdit: (p: Proposal) => void;
  onSend: (p: Proposal) => void;
  onDecide: (id: string, outcome: 'accepted' | 'declined' | 'withdrawn') => void;
}) {
  if (proposals.length === 0) {
    return (
      <div className="rounded-[14px] py-[42px] text-center" style={RING}>
        <p className="text-[17px] font-bold text-ink">No proposals yet</p>
        <p className="mx-auto mt-[10px] max-w-[440px] text-[14.5px] leading-[1.5]" style={{ color: 'rgb(131,131,131)' }}>
          Build one from the services you sell. Prices are yours — nothing here suggests a rate.
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-[14px]">
        {proposals.map((p) => (
          <li key={p.id} className="rounded-[14px] p-[18px]" style={RING}>
            <div className="flex items-start justify-between gap-[14px]">
              <div className="min-w-0">
                <div className="flex items-center gap-[10px]">
                  <span className="truncate text-[17px] font-bold text-ink">{p.title}</span>
                  <span
                    className="flex h-[26px] shrink-0 items-center rounded-[13px] px-[10px] text-[12.5px] font-semibold"
                    style={STATUS_TINT[p.status]}
                  >
                    {STATUS_LABEL[p.status]}
                  </span>
                </div>
                <p className="mt-[8px] text-[14.5px]" style={{ color: 'rgb(91,91,91)' }}>
                  {p.lineItems.length} {p.lineItems.length === 1 ? 'line' : 'lines'} · {p.termMonths}{' '}
                  {p.termMonths === 1 ? 'month' : 'months'}
                  {p.sentAt ? ` · sent ${p.sentAt.slice(0, 10)}` : ''}
                  {p.decidedAt ? ` · decided ${p.decidedAt.slice(0, 10)}` : ''}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[20px] font-bold leading-none text-ink">{money(p.totalContractCents, p.currency)}</p>
                <p className="mt-[6px] text-[13px]" style={{ color: 'rgb(131,131,131)' }}>
                  {p.monthlyCents > 0 ? `${money(p.monthlyCents, p.currency)}/mo` : 'one-off'}
                  {p.monthlyCents > 0 && p.oneOffCents > 0 ? ` + ${money(p.oneOffCents, p.currency)}` : ''}
                </p>
              </div>
            </div>

            <div className="mt-[16px] flex flex-wrap items-center gap-[10px]">
              {/* Only a draft is revisable — the tool refuses the rest, so this
                  does not offer it. */}
              {p.status === 'draft' ? (
                <>
                  <button type="button" onClick={() => onEdit(p)} disabled={busy} className={BTN_GHOST} style={RING}>
                    Revise
                  </button>
                  <button type="button" onClick={() => onSend(p)} disabled={busy} className={BTN_SOLID}>
                    Send to client
                  </button>
                </>
              ) : null}

              {p.status === 'sent' ? (
                <CopyButton text={proposalToText(p, lead.businessName)} label="Copy again" />
              ) : null}

              {/* The moves the lifecycle actually permits, read from the shared
                  table so a button can never offer what the tool would refuse. */}
              {PROPOSAL_TRANSITIONS[p.status]
                .filter((to) => to !== 'sent')
                .map((to) => (
                  <button
                    key={to}
                    type="button"
                    onClick={() => onDecide(p.id, to as 'accepted' | 'declined' | 'withdrawn')}
                    disabled={busy}
                    className={BTN_GHOST}
                    style={RING}
                  >
                    Mark {STATUS_LABEL[to].toLowerCase()}
                  </button>
                ))}

              {p.status === 'accepted' ? (
                <span className="text-[14px] font-medium" style={{ color: 'rgb(91,91,91)' }}>
                  Win the lead on its row to create the client workspace.
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {capped ? (
        <p className="mt-[16px] text-[13.5px]" style={{ color: 'rgb(131,131,131)' }}>
          This workspace has more than 200 proposals, so a lead&apos;s oldest ones may not be listed here yet.
        </p>
      ) : null}
    </>
  );
}

/* ── editor ────────────────────────────────────────────────────────── */

function ProposalEditor({
  leadId,
  existing,
  busy,
  onCancel,
  onSave,
}: {
  leadId: string;
  existing?: Proposal;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: DraftInput) => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? 'Social media retainer');
  const [currency, setCurrency] = useState(existing?.currency ?? 'USD');
  const [termMonths, setTermMonths] = useState(existing?.termMonths ?? 12);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [lines, setLines] = useState<LineDraft[]>(existing ? toLines(existing) : [emptyLine()]);
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * The same function the tool totals with, so what is on screen while somebody
   * types is what gets stored. Lines still being typed contribute nothing
   * rather than zero — `parseMoney` returns undefined and they are skipped.
   */
  const priced = useMemo(
    () =>
      lines
        .map((l) => ({ l, cents: parseMoney(l.price) }))
        .filter((x): x is { l: LineDraft; cents: number } => x.cents !== undefined),
    [lines],
  );

  const totals = useMemo(
    () =>
      proposalTotals(
        priced.map(({ l, cents }) => ({
          service: l.service,
          description: l.description || undefined,
          unitCents: cents,
          quantity: l.quantity,
          recurrence: l.recurrence,
        })),
        termMonths,
      ),
    [priced, termMonths],
  );

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  function submit() {
    if (!title.trim()) {
      setProblem('A proposal needs a title.');
      return;
    }
    if (priced.length === 0) {
      setProblem('Add at least one line with a price.');
      return;
    }
    const missing = priced.find(({ l }) => l.service === 'other' && !l.description.trim());
    if (missing) {
      setProblem('A line set to "Other" needs a description saying what it is.');
      return;
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      setProblem('Currency must be a three-letter code, like USD or NGN.');
      return;
    }

    setProblem(null);
    onSave({
      leadId,
      title: title.trim(),
      currency,
      termMonths,
      lineItems: priced.map(({ l, cents }) => ({
        service: l.service,
        ...(l.description.trim() ? { description: l.description.trim() } : {}),
        unitCents: cents,
        quantity: l.quantity,
        recurrence: l.recurrence,
      })),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
  }

  return (
    <>
      <div className="grid grid-cols-[1fr_120px_140px] gap-[16px]">
        <label className="block">
          <span className="block text-[14px] font-semibold text-ink">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${FIELD} mt-[8px]`} style={RING} />
        </label>
        <label className="block">
          <span className="block text-[14px] font-semibold text-ink">Currency</span>
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
            aria-label="Currency"
            className={`${FIELD} mt-[8px]`}
            style={RING}
          />
        </label>
        <label className="block">
          <span className="block text-[14px] font-semibold text-ink">Term (months)</span>
          <input
            type="number"
            min={1}
            max={60}
            value={termMonths}
            onChange={(e) => setTermMonths(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
            aria-label="Term in months"
            className={`${FIELD} mt-[8px]`}
            style={RING}
          />
        </label>
      </div>

      <p className="mt-[22px] text-[14px] font-semibold text-ink">Lines</p>

      <div className="mt-[10px] space-y-[10px]">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_110px_64px_120px_36px] items-end gap-[10px]">
            <label className="block">
              <select
                value={l.service}
                onChange={(e) => setLine(i, { service: e.target.value as ProposalService })}
                aria-label={`Service for line ${i + 1}`}
                className={`${FIELD} cursor-pointer appearance-none`}
                style={RING}
              >
                {SERVICES.map((s) => (
                  <option key={s} value={s}>{PROPOSAL_SERVICE_LABELS[s]}</option>
                ))}
              </select>
              {/* Required only where the enum says nothing, matching the tool. */}
              {l.service === 'other' ? (
                <input
                  value={l.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                  placeholder="What is this line?"
                  aria-label={`Description for line ${i + 1}`}
                  className={`${FIELD} mt-[8px]`}
                  style={RING}
                />
              ) : null}
            </label>

            <label className="block">
              <input
                value={l.price}
                onChange={(e) => setLine(i, { price: e.target.value })}
                inputMode="decimal"
                placeholder="0.00"
                aria-label={`Price for line ${i + 1}`}
                className={FIELD}
                style={RING}
              />
            </label>

            <label className="block">
              <input
                type="number"
                min={1}
                max={1000}
                value={l.quantity}
                onChange={(e) => setLine(i, { quantity: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) })}
                aria-label={`Quantity for line ${i + 1}`}
                className={FIELD}
                style={RING}
              />
            </label>

            <label className="block">
              <select
                value={l.recurrence}
                onChange={(e) => setLine(i, { recurrence: e.target.value as LineRecurrence })}
                aria-label={`Recurrence for line ${i + 1}`}
                className={`${FIELD} cursor-pointer appearance-none`}
                style={RING}
              >
                <option value="monthly">per month</option>
                <option value="one_off">one-off</option>
              </select>
            </label>

            <button
              type="button"
              onClick={() => setLines((ls) => (ls.length === 1 ? [emptyLine()] : ls.filter((_, idx) => idx !== i)))}
              aria-label={`Remove line ${i + 1}`}
              className="flex h-[46px] w-[36px] items-center justify-center rounded-[10px] bg-white transition-shadow hover:shadow-card"
              style={RING}
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M2 2l10 10M12 2L2 12" stroke="rgb(131,131,131)" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setLines((ls) => (ls.length >= 12 ? ls : [...ls, emptyLine()]))}
        disabled={lines.length >= 12}
        className={`${BTN_GHOST} mt-[12px]`}
        style={RING}
        title={lines.length >= 12 ? 'Twelve lines is the most a proposal carries' : undefined}
      >
        + Add line
      </button>

      <label className="mt-[20px] block">
        <span className="block text-[14px] font-semibold text-ink">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-[8px] h-[74px] w-full resize-none rounded-[10px] bg-white p-[12px] text-[15px] font-medium text-ink outline-none"
          style={RING}
        />
      </label>

      {/* The arithmetic, spelled out — a one-off is never multiplied by the term. */}
      <div className="mt-[20px] rounded-[12px] p-[16px]" style={{ background: '#F4F5F7' }}>
        <div className="flex flex-wrap items-baseline gap-x-[24px] gap-y-[8px]">
          <Total label="Monthly" value={money(totals.monthlyCents, currency)} />
          <Total label="One-off" value={money(totals.oneOffCents, currency)} />
          <Total
            label={`Over ${termMonths} ${termMonths === 1 ? 'month' : 'months'}`}
            value={money(totals.totalContractCents, currency)}
            strong
          />
        </div>
        <p className="mt-[10px] text-[13px]" style={{ color: 'rgb(131,131,131)' }}>
          Monthly × {termMonths} plus one-offs. One-off lines are not multiplied by the term.
        </p>
      </div>

      {problem ? <p className="mt-[16px] text-[15px] text-destructive">{problem}</p> : null}

      <div className="mt-[22px] flex justify-end gap-[12px]">
        <button type="button" onClick={onCancel} className={BTN_GHOST} style={{ color: 'rgb(131,131,131)' }}>
          Cancel
        </button>
        <button type="button" onClick={submit} disabled={busy} className={BTN_SOLID}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Create proposal'}
        </button>
      </div>
    </>
  );
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <span>
      <span className="block text-[12.5px] font-medium" style={{ color: 'rgb(131,131,131)' }}>{label}</span>
      <span className={cn('block leading-none text-ink', strong ? 'text-[24px] font-bold' : 'text-[18px] font-semibold')}>
        {value}
      </span>
    </span>
  );
}

/* ── sent ──────────────────────────────────────────────────────────── */

function SentPanel({
  proposal,
  token,
  expiresAt,
  lead,
}: {
  proposal: Proposal;
  token: string;
  expiresAt: string;
  lead: { businessName: string };
}) {
  const text = proposalToText(proposal, lead.businessName);

  return (
    <>
      <div className="rounded-[14px] p-[18px]" style={{ background: '#D8F5E6' }}>
        <p className="text-[16px] font-bold" style={{ color: '#1F7A46' }}>
          Marked as sent — {money(proposal.totalContractCents, proposal.currency)} over {proposal.termMonths}{' '}
          {proposal.termMonths === 1 ? 'month' : 'months'}
        </p>
        <p className="mt-[6px] text-[14.5px]" style={{ color: '#2C6B47' }}>
          It now counts as outstanding in the pipeline.
        </p>
      </div>

      <p className="mt-[22px] text-[14px] font-semibold text-ink">Send it</p>
      <p className="mt-[6px] text-[14.5px] leading-[1.5]" style={{ color: 'rgb(131,131,131)' }}>
        Copy the offer and paste it into your own email — that is the way to get it in front of{' '}
        {lead.businessName} today.
      </p>

      <pre
        className="mt-[12px] max-h-[220px] overflow-y-auto whitespace-pre-wrap rounded-[12px] p-[14px] font-mono text-[12.5px] leading-[1.55] text-ink"
        style={{ background: '#F4F5F7' }}
      >
        {text}
      </pre>

      <div className="mt-[12px] flex flex-wrap gap-[10px]">
        <CopyButton text={text} label="Copy proposal" solid />
        <a
          href={`mailto:?subject=${encodeURIComponent(proposal.title)}&body=${encodeURIComponent(text)}`}
          className={BTN_GHOST}
          style={RING}
        >
          Open in email
        </a>
      </div>

      {/*
        The link is real — 256 bits, expiring, revoked the moment a decision is
        recorded — and nothing serves it yet. Saying so is the only honest
        option: presenting it as a shareable URL would hand somebody a link
        that 404s in front of a client.
      */}
      <p className="mt-[24px] text-[14px] font-semibold text-ink">The share link</p>
      <p className="mt-[6px] text-[14.5px] leading-[1.5]" style={{ color: 'rgb(131,131,131)' }}>
        A link was minted for this proposal and expires on {expiresAt.slice(0, 10)}. There is no public
        page to open it with yet, so it is not worth sending — the client-facing view is still to be
        built. The token is kept here for when it is.
      </p>
      <code
        className="mt-[10px] block truncate rounded-[10px] px-[12px] py-[10px] font-mono text-[12px]"
        style={{ background: '#F4F5F7', color: 'rgb(91,91,91)' }}
        title={token}
      >
        {token.slice(0, 16)}…{token.slice(-8)}
      </code>
    </>
  );
}

function CopyButton({ text, label, solid }: { text: string; label: string; solid?: boolean }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          /* A denied clipboard permission is not an error worth a banner — the
             text is on screen and selectable either way. */
        }
      }}
      className={solid ? BTN_SOLID : BTN_GHOST}
      style={solid ? undefined : RING}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}
