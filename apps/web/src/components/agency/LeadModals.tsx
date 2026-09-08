'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { parseLeadCsv, type LeadCsvPreview, type LeadImportRow } from './leadCsv';
import type { ImportResult } from './useLeads';

/**
 * The Client Finder's two ways of getting leads in: a spreadsheet, or one at a
 * time.
 *
 * These are the real capability behind the design's "Import CSV" chip. The
 * design's other route — connecting a third-party lead product — has nothing
 * behind it and is not offered; see the header in `AgencyClientFinder.tsx`.
 */

/* ── shell ─────────────────────────────────────────────────────────── */

function Modal({
  title,
  subtitle,
  width = 760,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  width?: number;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto px-4 py-[6vh]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        style={{ background: 'rgba(12,12,12,0.28)', backdropFilter: 'blur(6px)' }}
      />
      <div
        className="relative max-w-full rounded-[20px] bg-white px-[40px] pb-[30px] pt-[28px]"
        style={{ width, boxShadow: '0 40px 90px -40px rgba(12,12,12,0.5)' }}
      >
        <h2 className="text-[24px] font-bold leading-[1.25] text-ink">{title}</h2>
        {subtitle ? (
          <p className="mt-[8px] text-[15px] font-normal" style={{ color: 'rgb(131,131,131)' }}>
            {subtitle}
          </p>
        ) : null}
        <div className="mt-[24px]">{children}</div>
        <div className="mt-[28px] flex flex-wrap items-center justify-end gap-[12px]">{footer}</div>
      </div>
    </div>
  );
}

const BTN_GHOST =
  'h-[44px] rounded-[10px] px-[20px] text-[15.5px] font-semibold transition-colors hover:bg-[rgba(131,131,131,0.08)]';
const BTN_SOLID =
  'h-[44px] rounded-[10px] bg-ink px-[22px] text-[15.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50';

const FIELD =
  'h-[52px] w-full rounded-[11px] bg-white px-[16px] text-[15px] font-medium text-ink outline-none';
const RING = { boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.25)' } as const;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[14.5px] font-semibold text-ink">{label}</span>
      <span className="mt-[8px] block">{children}</span>
    </label>
  );
}

/* ── import ────────────────────────────────────────────────────────── */

/**
 * Paste or pick a file, see exactly what will land, then commit.
 *
 * The preview is the point. `lead.import` reports what it skipped *after* the
 * fact, which is the right thing for a tool to do but a poor thing for a person
 * to discover — so the same dedupe key the tool and the unique index use is
 * computed here first, and the rows that will not import are named before
 * anybody presses the button.
 */
export function LeadImportModal({
  onClose,
  onImport,
  busy,
}: {
  onClose: () => void;
  onImport: (rows: LeadImportRow[]) => Promise<{ result?: ImportResult; error?: string }>;
  busy: boolean;
}) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const preview: LeadCsvPreview | null = useMemo(() => parseLeadCsv(text), [text]);

  async function commit() {
    if (!preview || preview.importable.length === 0) return;
    setError(null);
    const { result, error: err } = await onImport(preview.importable);
    if (err) {
      setError(err);
      return;
    }
    setDone(result ?? null);
  }

  /* ── the result screen, once it has run ───────────────────────────── */
  if (done) {
    return (
      <Modal
        title="Import finished"
        onClose={onClose}
        footer={
          <button type="button" onClick={onClose} className={BTN_SOLID}>
            Done
          </button>
        }
      >
        <p className="text-[16px] font-medium text-ink">{done.why.summary}</p>
        <ul className="mt-[18px] space-y-[10px]">
          <Stat label="Added to the pipeline" value={done.imported} />
          {done.duplicatesSkipped > 0 ? (
            <Stat label="Already in the pipeline" value={done.duplicatesSkipped} muted />
          ) : null}
          {done.duplicatesWithinUpload > 0 ? (
            <Stat label="Repeated inside the file" value={done.duplicatesWithinUpload} muted />
          ) : null}
        </ul>
        {done.imported === 0 ? (
          <p className="mt-[18px] text-[14.5px] leading-[1.5]" style={{ color: 'rgb(131,131,131)' }}>
            Nothing was added, which usually means this file has been imported before. Re-importing is
            safe — it never overwrites a lead somebody has since worked on.
          </p>
        ) : null}
      </Modal>
    );
  }

  return (
    <Modal
      title="Import leads"
      subtitle="A CSV from your CRM or a spreadsheet. Columns are matched by name, in any order."
      width={820}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={BTN_GHOST} style={{ color: 'rgb(131,131,131)' }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={busy || !preview || preview.importable.length === 0}
            className={BTN_SOLID}
          >
            {busy
              ? 'Importing…'
              : preview && preview.importable.length > 0
                ? `Import ${preview.importable.length} ${preview.importable.length === 1 ? 'lead' : 'leads'}`
                : 'Import'}
          </button>
        </>
      }
    >
      <div className="flex items-center gap-[12px]">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className={BTN_GHOST}
          style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)', color: 'rgb(59,59,59)' }}
        >
          Choose a file
        </button>
        <span className="text-[14.5px]" style={{ color: 'rgb(131,131,131)' }}>
          {fileName ?? 'or paste below'}
        </span>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setFileName(f.name);
            setText(await f.text());
          }}
        />
      </div>

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setFileName(null);
        }}
        aria-label="CSV text"
        placeholder={'Business Name,Email,Phone,Location\nSunnyvale Innovations,hi@sunnyvale.test,+1 555 010 2030,"Sunnyvale, CA"'}
        spellCheck={false}
        className="mt-[16px] h-[150px] w-full resize-none rounded-[11px] bg-white p-[14px] font-mono text-[13px] leading-[1.5] text-ink outline-none"
        style={RING}
      />

      {preview ? (
        <div className="mt-[20px]">
          {preview.looksUnmapped ? (
            <p className="text-[14.5px] font-medium" style={{ color: '#B4530A' }}>
              No column looked like a business name or an email. The first column will be used as the
              name — check the rows below before importing.
            </p>
          ) : (
            <p className="text-[14.5px]" style={{ color: 'rgb(131,131,131)' }}>
              Matched columns: <b className="font-semibold text-ink">{preview.mapped.join(', ')}</b>
            </p>
          )}

          <div className="mt-[14px] flex flex-wrap gap-[10px]">
            <Pill tone="good">{preview.counts.importable} will import</Pill>
            {preview.counts.duplicatesInFile > 0 ? (
              <Pill tone="warn">{preview.counts.duplicatesInFile} repeated in this file</Pill>
            ) : null}
            {preview.counts.unusable > 0 ? (
              <Pill tone="bad">{preview.counts.unusable} with no business name</Pill>
            ) : null}
          </div>

          {/* Deliberately capped: this is a check, not the pipeline itself. */}
          <div className="mt-[14px] max-h-[210px] overflow-y-auto rounded-[11px]" style={RING}>
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr style={{ background: '#F4F5F7' }}>
                  {['Row', 'Business', 'Email', 'Phone', 'Location', ''].map((h) => (
                    <th key={h} className="px-[12px] py-[9px] text-left font-semibold" style={{ color: 'rgb(91,91,91)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 60).map((r) => {
                  const skipped = Boolean(r.problem) || r.duplicateOfLine !== undefined;
                  return (
                    <tr key={r.line} style={{ boxShadow: 'inset 0 -1px 0 rgba(131,131,131,0.12)', opacity: skipped ? 0.5 : 1 }}>
                      <td className="px-[12px] py-[9px]" style={{ color: 'rgb(131,131,131)' }}>{r.line}</td>
                      <td className="max-w-[220px] truncate px-[12px] py-[9px] font-semibold text-ink">
                        {r.row.businessName || '—'}
                      </td>
                      <td className="max-w-[180px] truncate px-[12px] py-[9px]" style={{ color: 'rgb(91,91,91)' }}>{r.row.email ?? '—'}</td>
                      <td className="px-[12px] py-[9px]" style={{ color: 'rgb(91,91,91)' }}>{r.row.phone ?? '—'}</td>
                      <td className="max-w-[140px] truncate px-[12px] py-[9px]" style={{ color: 'rgb(91,91,91)' }}>{r.row.location ?? '—'}</td>
                      <td className="whitespace-nowrap px-[12px] py-[9px] text-[12.5px]" style={{ color: 'rgb(131,131,131)' }}>
                        {r.problem ?? (r.duplicateOfLine !== undefined ? `same as row ${r.duplicateOfLine}` : '')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 60 ? (
            <p className="mt-[10px] text-[13px]" style={{ color: 'rgb(131,131,131)' }}>
              Showing the first 60 of {preview.rows.length} rows. All {preview.counts.importable} importable
              rows will be sent.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="mt-[16px] text-[15px] text-destructive">{error}</p> : null}
    </Modal>
  );
}

function Stat({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <li className="flex items-baseline gap-[10px]">
      <span className={cn('text-[22px] font-bold leading-none', muted ? '' : 'text-ink')} style={muted ? { color: 'rgb(91,91,91)' } : undefined}>
        {value}
      </span>
      <span className="text-[15px]" style={{ color: 'rgb(91,91,91)' }}>{label}</span>
    </li>
  );
}

function Pill({ tone, children }: { tone: 'good' | 'warn' | 'bad'; children: ReactNode }) {
  const style =
    tone === 'good'
      ? { background: '#D8F5E6', color: '#1F7A46' }
      : tone === 'warn'
        ? { background: '#FBE4C2', color: '#8A5A12' }
        : { background: '#FBD9D9', color: '#A32626' };
  return (
    <span className="flex h-[30px] items-center rounded-[8px] px-[11px] text-[13.5px] font-semibold" style={style}>
      {children}
    </span>
  );
}

/* ── add one ───────────────────────────────────────────────────────── */

/**
 * The manual route — a name taken on a call, a referral.
 *
 * Only the business name is required, matching the tool: a lead somebody just
 * heard about on the phone usually *is* only a name, and a form that demands an
 * email before it will save one is a form that loses the lead.
 */
export function LeadAddModal({
  onClose,
  onCreate,
  busy,
}: {
  onClose: () => void;
  onCreate: (row: LeadImportRow & { source?: 'manual' | 'referral' | 'inbound' }) => Promise<string | null>;
  busy: boolean;
}) {
  const [row, setRow] = useState<LeadImportRow & { source: 'manual' | 'referral' | 'inbound' }>({
    businessName: '',
    source: 'manual',
  });
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<typeof row>) => setRow((r) => ({ ...r, ...patch }));

  async function submit() {
    if (!row.businessName.trim()) {
      setError('A business name is the one thing this needs.');
      return;
    }
    setError(null);
    /* Blank optional fields are omitted, not sent as empty strings — the tool
       validates the ones it receives, and `''` is not a valid email. */
    const err = await onCreate({
      businessName: row.businessName.trim(),
      source: row.source,
      ...(row.contactName?.trim() ? { contactName: row.contactName.trim() } : {}),
      ...(row.email?.trim() ? { email: row.email.trim() } : {}),
      ...(row.phone?.trim() ? { phone: row.phone.trim() } : {}),
      ...(row.location?.trim() ? { location: row.location.trim() } : {}),
      ...(row.interest?.trim() ? { interest: row.interest.trim() } : {}),
      ...(row.notes?.trim() ? { notes: row.notes.trim() } : {}),
    });
    if (err) {
      setError(err);
      return;
    }
    onClose();
  }

  return (
    <Modal
      title="Add a lead"
      subtitle="Only the business name is required."
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={BTN_GHOST} style={{ color: 'rgb(131,131,131)' }}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy} className={BTN_SOLID}>
            {busy ? 'Adding…' : 'Add lead'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-[20px] gap-y-[18px]">
        <div className="col-span-2">
          <Field label="Business name">
            <input
              value={row.businessName}
              onChange={(e) => set({ businessName: e.target.value })}
              placeholder="Sunnyvale Innovations"
              className={FIELD}
              style={RING}
              autoFocus
            />
          </Field>
        </div>
        <Field label="Contact name">
          <input value={row.contactName ?? ''} onChange={(e) => set({ contactName: e.target.value })} className={FIELD} style={RING} />
        </Field>
        <Field label="Email">
          <input value={row.email ?? ''} onChange={(e) => set({ email: e.target.value })} type="email" className={FIELD} style={RING} />
        </Field>
        <Field label="Phone">
          <input value={row.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} inputMode="tel" className={FIELD} style={RING} />
        </Field>
        <Field label="Location">
          <input value={row.location ?? ''} onChange={(e) => set({ location: e.target.value })} className={FIELD} style={RING} />
        </Field>
        <Field label="How they arrived">
          <select
            value={row.source}
            onChange={(e) => set({ source: e.target.value as typeof row.source })}
            className={`${FIELD} cursor-pointer appearance-none`}
            style={RING}
          >
            <option value="manual">Added by hand</option>
            <option value="referral">Referral</option>
            <option value="inbound">They got in touch</option>
          </select>
        </Field>
        <Field label="What they want">
          <input
            value={row.interest ?? ''}
            onChange={(e) => set({ interest: e.target.value })}
            placeholder="Social media management"
            className={FIELD}
            style={RING}
          />
        </Field>
        <div className="col-span-2">
          <Field label="Notes">
            <textarea
              value={row.notes ?? ''}
              onChange={(e) => set({ notes: e.target.value })}
              className="h-[90px] w-full resize-none rounded-[11px] bg-white p-[14px] text-[15px] font-medium text-ink outline-none"
              style={RING}
            />
          </Field>
        </div>
      </div>

      {error ? <p className="mt-[16px] text-[15px] text-destructive">{error}</p> : null}
    </Modal>
  );
}
