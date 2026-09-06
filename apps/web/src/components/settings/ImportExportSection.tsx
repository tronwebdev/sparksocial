'use client';

import { useEffect, useRef, useState } from 'react';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { SettingsTabs } from './SettingsTabs';

/**
 * `Settings WS Export` / `… Import` / `… Clone` — three prototype screens under
 * one heading, switched by the tab strip at the top of the card.
 *
 *   tabs      Export / Import / Clone Workspace, 17.643/500
 *   Export    four 20/700 selectable cards (Media assets, Workspace settings,
 *             Templates, Database & Content) over an estimate strip and a
 *             "Generate export" button, with a Recent activity rail
 *   Import    a drop zone — "Drop a .SPKSWPS file here", "or", Browse files —
 *             a merge checkbox, and a workspace list to pull from
 *   Clone     the same shape pointed at another workspace
 *
 * ── What actually travels, and why the four cards are not four ────────────
 *
 * `brand.export` returns one payload: name, identity, dimensions, voice, offer
 * and constraints. It deliberately excludes learned performance history, and it
 * carries no media, no templates and no database rows — so the design's four
 * checkboxes describe a bundle the engine does not produce.
 *
 * Rather than draw four boxes where three do nothing, this shows the one thing
 * that exports, says what is in it, and names what is not. The file is JSON,
 * not `.SPKSWPS`, for the same reason: inventing an extension for a format that
 * is plain JSON would make it look like a container it is not.
 */

interface ExportPayload {
  name: string;
  identity: Record<string, unknown>;
  dimensions: Record<string, unknown>;
  voice: Record<string, unknown>;
  offer: Record<string, unknown>;
  constraints: Record<string, unknown>;
}

type Tab = 'export' | 'import' | 'clone';

export function ImportExportSection() {
  const { genome } = useSelectedGenome();
  const [tab, setTab] = useState<Tab>('export');

  return (
    <>
      <SettingsTabs
        label="Import and export"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'export', label: 'Export' },
          { id: 'import', label: 'Import' },
          { id: 'clone', label: 'Clone Workspace' },
        ]}
      />

      <div className="mt-[24px]">
        {tab === 'export' ? <ExportTab genomeId={genome?.genomeId} /> : null}
        {tab === 'import' ? <ImportTab mode="import" /> : null}
        {tab === 'clone' ? <ImportTab mode="clone" sourceGenomeId={genome?.genomeId} /> : null}
      </div>
    </>
  );
}

/* ── Export ──────────────────────────────────────────────────────────── */

function ExportTab({ genomeId }: { genomeId: string | undefined }) {
  const [payload, setPayload] = useState<ExportPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!genomeId) return;
    setBusy(true);
    setError(null);
    const res = await invoke<{ data: ExportPayload }>('brand.export', { genomeId });
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'Exporting this brand needs an approval.');
      return;
    }
    setPayload(res.output.data);
  }

  const bytes = payload ? new Blob([JSON.stringify(payload, null, 2)]).size : 0;

  return (
    <div className="flex flex-wrap gap-[26px]">
      <div className="min-w-[420px] flex-1">
        <h3 className="text-20 font-bold text-ink">Export workspace bundle</h3>
        <p className="mt-[10px] max-w-[540px] text-18 font-medium" style={{ color: 'rgb(131,131,131)' }}>
          Everything that makes this brand sound like itself, as portable JSON.
        </p>

        <ul className="mt-[22px] grid grid-cols-1 gap-[14px]">
          <BundleRow title="Brand genome" detail="Identity, dimensions, voice, offer and constraints" included />
          <BundleRow title="Media assets" detail="Images, videos and fonts stay in the Assets Library" />
          <BundleRow title="Performance history" detail="Held back on purpose — one brand's results say nothing about another's" />
          <BundleRow title="Calendar & content" detail="Campaigns and posts belong to the brand that ran them" />
        </ul>

        <div
          className="mt-[22px] flex flex-wrap items-center justify-between gap-[16px] rounded-xl bg-white px-[24px] py-[18px]"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
        >
          <div>
            <p className="text-20 font-bold text-ink">Estimated bundle size</p>
            <p className="mt-[6px] text-16" style={{ color: 'rgb(131,131,131)' }}>
              {payload ? `${(bytes / 1024).toFixed(1)} KB · ready now` : 'Generate the bundle to see its size.'}
            </p>
          </div>

          <div className="flex items-center gap-[12px]">
            <button
              type="button"
              onClick={() => void generate()}
              disabled={busy || !genomeId}
              className="h-[44px] rounded-[9px] bg-ink px-[22px] text-[17.643px] font-medium text-white transition-colors hover:bg-ink-800 disabled:opacity-50"
            >
              {busy ? 'Preparing…' : 'Generate export'}
            </button>

            {/*
              A real download, not a mock. The bundle is built in the browser
              from what the tool returned, so the link has something to point at
              only after Generate has run.
            */}
            {payload ? (
              <a
                download={`${payload.name.replace(/[^\w.-]+/g, '-').toLowerCase() || 'brand'}-genome.json`}
                href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(payload, null, 2))}`}
                className="h-[44px] rounded-[9px] bg-white px-[22px] text-[17.643px] font-medium leading-[44px] text-ink transition-colors hover:bg-surface-200"
                style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)' }}
              >
                Download
              </a>
            ) : null}
          </div>
        </div>

        {error ? <p className="mt-[14px] text-16 text-destructive">{error}</p> : null}
      </div>

      <RecentRail />
    </div>
  );
}

function BundleRow({ title, detail, included }: { title: string; detail: string; included?: boolean }) {
  return (
    <li
      className="flex items-start gap-[14px] rounded-xl bg-white px-[22px] py-[16px]"
      style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)', opacity: included ? 1 : 0.55 }}
    >
      <span
        aria-hidden
        className="mt-[3px] flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[5px]"
        style={{ background: included ? 'var(--ss-ink-900)' : 'transparent', boxShadow: included ? 'none' : 'inset 0 0 0 1.5px rgba(12,12,12,0.2)' }}
      >
        {included ? (
          <svg width="11" height="9" viewBox="0 0 11 9" fill="none" aria-hidden>
            <path d="m1 4.5 3 3L10 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
      <span className="min-w-0">
        <span className="block text-20 font-bold text-ink">{title}</span>
        <span className="mt-[4px] block text-16" style={{ color: 'rgb(131,131,131)' }}>
          {detail}
        </span>
      </span>
    </li>
  );
}

/* ── Import / Clone ──────────────────────────────────────────────────── */

function ImportTab({
  mode,
  sourceGenomeId,
}: {
  mode: 'import' | 'clone';
  sourceGenomeId?: string;
}) {
  const [file, setFile] = useState<{ name: string; data: ExportPayload } | null>(null);
  const [brands, setBrands] = useState<Array<{ genomeId: string; name: string; updatedAt: string }> | null>(null);
  const [pick, setPick] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await invoke<{ genomes: Array<{ genomeId: string; name: string; updatedAt: string }> }>('genome.list', {});
      setBrands(res.status === 'succeeded' ? res.output.genomes : []);
    })();
  }, []);

  async function readFile(f: File) {
    setError(null);
    try {
      const parsed = JSON.parse(await f.text()) as ExportPayload;
      if (!parsed || typeof parsed !== 'object' || !parsed.identity) {
        setError('That file is not a brand export — it has no identity block.');
        return;
      }
      setFile({ name: f.name, data: parsed });
    } catch {
      setError('That file could not be read as JSON.');
    }
  }

  async function run() {
    setBusy(true);
    setError(null);
    setDone(null);

    let data = file?.data ?? null;

    /* Cloning is exporting the source and importing it straight back — the
       engine has no `brand.clone`, and this is exactly what one would do. */
    if (mode === 'clone') {
      const from = pick || sourceGenomeId;
      if (!from) {
        setBusy(false);
        setError('Pick a workspace to clone from.');
        return;
      }
      const res = await invoke<{ data: ExportPayload }>('brand.export', { genomeId: from });
      if (res.status !== 'succeeded') {
        setBusy(false);
        setError(res.status === 'failed' ? res.error.message : 'Reading that workspace needs an approval.');
        return;
      }
      data = res.output.data;
    }

    if (!data) {
      setBusy(false);
      setError('Choose a bundle first.');
      return;
    }

    const res = await invoke<{ genomeId: string; name: string }>(
      'brand.import',
      { data, ...(mode === 'clone' ? { name: `${data.name} (copy)` } : {}) },
      // Not idempotent — every run mints a new brand, so each press is its own.
      crypto.randomUUID(),
    );
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'Creating a brand needs an approval.');
      return;
    }
    setDone(`Created “${res.output.name}”. It is in your brand switcher.`);
  }

  return (
    <div className="flex flex-wrap gap-[26px]">
      <div className="min-w-[420px] flex-1">
        <h3 className="text-20 font-bold text-ink">
          {mode === 'clone' ? 'Clone a workspace' : 'Import from another workspace'}
        </h3>
        <p className="mt-[10px] max-w-[540px] text-18 font-medium" style={{ color: 'rgb(131,131,131)' }}>
          {mode === 'clone'
            ? 'Copy an existing brand’s genome into a brand new one. The original is untouched.'
            : 'Drop a bundle exported from any workspace. Importing always creates a new brand — it never overwrites this one.'}
        </p>

        {mode === 'import' ? (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) void readFile(f);
            }}
            className="mt-[22px] flex flex-col items-center justify-center rounded-xl bg-white px-[24px] py-[52px] text-center"
            style={{ boxShadow: 'inset 0 0 0 1.5px rgba(131,131,131,0.35)' }}
          >
            <p className="text-20 font-bold text-ink">
              {file ? file.name : 'Drop a brand export here'}
            </p>
            <p className="my-[12px] text-[22px] font-bold" style={{ color: 'rgb(131,131,131)' }}>
              or
            </p>
            <input
              ref={input}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
              }}
            />
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="h-[44px] rounded-[9px] bg-white px-[22px] text-[17.643px] font-medium transition-colors hover:bg-surface-200"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)', color: 'rgb(131,131,131)' }}
            >
              Browse files
            </button>
          </div>
        ) : null}

        {/* The design's "Pull from a workspace" list. */}
        <p className="mt-[26px] text-18 font-medium text-ink">
          {mode === 'clone' ? 'Clone from a workspace' : 'Or pull from a workspace'}
        </p>
        <ul className="mt-[13px] grid grid-cols-1 gap-[12px]">
          {(brands ?? []).map((b) => {
            const on = pick === b.genomeId;
            return (
              <li key={b.genomeId}>
                <button
                  type="button"
                  onClick={() => setPick(on ? '' : b.genomeId)}
                  aria-pressed={on}
                  className="flex w-full items-center gap-[16px] rounded-xl bg-white px-[20px] py-[14px] text-left transition-shadow"
                  style={{ boxShadow: on ? 'inset 0 0 0 1.6px rgba(12,12,12,0.55)' : 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
                >
                  <span
                    aria-hidden
                    className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full text-20 font-bold text-ink"
                    style={{ background: 'rgba(131,131,131,0.12)' }}
                  >
                    {b.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-18 font-semibold text-ink">{b.name}</span>
                    <span className="mt-[4px] block text-16" style={{ color: 'rgb(131,131,131)' }}>
                      updated {new Date(b.updatedAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {brands !== null && brands.length === 0 ? (
            <li className="text-16" style={{ color: 'rgb(131,131,131)' }}>
              No other workspaces in this organisation yet.
            </li>
          ) : null}
        </ul>

        <div className="mt-[22px] flex flex-wrap items-center gap-[14px]">
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || (mode === 'import' ? !file && !pick : !pick && !sourceGenomeId)}
            className="h-[44px] rounded-[9px] bg-ink px-[24px] text-[15.19px] font-medium text-white transition-colors hover:bg-ink-800 disabled:opacity-50"
          >
            {busy ? 'Working…' : mode === 'clone' ? 'Clone workspace' : 'Start import'}
          </button>
          <span className="text-16" style={{ color: 'rgb(131,131,131)' }}>
            Always creates a new brand.
          </span>
        </div>

        {error ? <p className="mt-[14px] text-16 text-destructive">{error}</p> : null}
        {done ? <p className="mt-[14px] text-16" style={{ color: 'var(--ss-green-700)' }}>{done}</p> : null}
      </div>

      <RecentRail />
    </div>
  );
}

/**
 * The design's "Recent activity" rail.
 *
 * Its three rows are fixtures — the same `atlas-studio-full.zip` three times —
 * and nothing records export or import history: no tool writes one and no table
 * holds one. So the rail says what it is for rather than inventing three rows
 * that would look like a log and never change.
 */
function RecentRail() {
  return (
    <aside
      className="w-[360px] shrink-0 rounded-xl bg-white p-[22px] max-lg:w-full"
      style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
    >
      <p className="text-18 font-medium text-ink">Recent activity</p>
      <p className="mt-[14px] text-16 leading-[1.45]" style={{ color: 'rgb(131,131,131)' }}>
        Nothing records import and export history yet, so there is no log to show. A bundle you
        generate downloads straight to this machine, and an import appears in your brand switcher.
      </p>

      <div className="mt-[20px] rounded-[10px] p-[16px]" style={{ background: 'rgba(131,131,131,0.07)' }}>
        <p className="text-18 font-medium" style={{ color: 'rgb(131,131,131)' }}>
          TIP
        </p>
        <p className="mt-[8px] text-16 font-semibold text-ink">Moving to a fresh environment?</p>
        <p className="mt-[6px] text-16 leading-[1.45]" style={{ color: 'rgb(131,131,131)' }}>
          Export from the source, then import into the destination. The genome transfers whole —
          identity, dimensions, voice, offer and constraints.
        </p>
      </div>
    </aside>
  );
}
