'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { invoke } from '@/lib/tools';
import { cn } from '@/lib/utils';

/**
 * `SET-WS-01` — take a brand out, bring a brand in.
 *
 * For an agency this is the whole lifecycle at both ends: a new client is
 * onboarded from a template rather than answered from scratch, and a departing
 * one is handed their genome back instead of being told it lives in somebody
 * else's database. `brand.export` and `brand.import` have existed and been
 * tested for a while with nothing to click.
 *
 * ── What crosses the line, and what does not ──────────────────────────────
 *
 * The payload is identity, dimensions, voice, offer and constraints — the
 * answers, not the history. Learned performance, assets, published content and
 * the audit trail all stay behind, and the tool's own summary says so. That is
 * the right cut for both directions: a template should not carry another
 * client's results, and an export handed to a departing customer should not
 * carry an agency's accumulated learning about them.
 *
 * Audience segments are the one advertised field that does not survive an
 * import, because no tool in the registry writes them. Stated here rather than
 * discovered later, since re-answering onboarding for a field you thought had
 * transferred is a genuinely annoying way to find out.
 *
 * ── Why import is a paste box and not a drop zone ─────────────────────────
 *
 * It is both, but the paste box is the primary control and the file picker fills
 * it, so the JSON is on screen before anything is created. `brand.import` is
 * `idempotent: false` — every call makes a new brand — so a mis-click here is
 * not recoverable by clicking again, and the difference between reviewing and
 * not reviewing is a brand you have to go and delete.
 */

interface Brand {
  genomeId: string;
  brandId: string;
  name: string;
}

/** `BrandExportPayload` — the five sections `brand.export` returns and `brand.import` accepts. */
interface ExportPayload {
  name: string;
  identity: Record<string, unknown>;
  dimensions: Record<string, unknown>;
  voice: Record<string, unknown>;
  offer: Record<string, unknown>;
  constraints: Record<string, unknown>;
}

const REQUIRED_KEYS = ['name', 'identity', 'dimensions', 'voice', 'offer', 'constraints'] as const;

export function BrandTransferPanel() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selected, setSelected] = useState('');
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);

  const [json, setJson] = useState('');
  const [newName, setNewName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await invoke<{ genomes: Brand[] }>('genome.list', {});
    if (res.status !== 'succeeded') return;
    setBrands(res.output.genomes);
    setSelected((s) => s || (res.output.genomes[0]?.genomeId ?? ''));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportBrand() {
    if (!selected) return;
    setBusy('export');
    setNote(null);
    const res = await invoke<{ data: ExportPayload }>('brand.export', { genomeId: selected });
    setBusy(null);
    if (res.status !== 'succeeded') {
      setNote({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That export was held for review.' });
      return;
    }

    /**
     * Written to a Blob and revoked immediately after the click. A `data:` URI
     * would work for a small payload and silently truncate at whatever the
     * browser's URL ceiling happens to be — a genome with a long voice
     * description is exactly the case that would hit it, and a half-file that
     * looks like a file is worse than a failure.
     */
    const text = JSON.stringify(res.output.data, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug(res.output.data.name || 'brand')}-genome.json`;
    a.click();
    URL.revokeObjectURL(url);

    setNote({ kind: 'ok', text: `Exported ${res.output.data.name}.` });
  }

  function readFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.json')) {
      setNote({ kind: 'err', text: 'That needs to be the .json file an export produced.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setJson(String(reader.result ?? ''));
      setNote({ kind: 'ok', text: `Loaded ${file.name}. Check it, then create the brand.` });
    };
    reader.onerror = () => setNote({ kind: 'err', text: `Could not read ${file.name}.` });
    reader.readAsText(file);
  }

  async function importBrand() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      setNote({ kind: 'err', text: 'That is not valid JSON. Paste the whole file, including the outer braces.' });
      return;
    }

    /**
     * Checked here as well as by the tool, because the failure reads completely
     * differently. A Zod rejection on the wire says which path was wrong; this
     * says *which section is missing*, which is the actual mistake somebody
     * makes — pasting the `data` field's contents, or one section of it, rather
     * than the whole file.
     */
    const obj = parsed as Record<string, unknown> | null;
    const missing = REQUIRED_KEYS.filter((k) => !obj || obj[k] === undefined);
    if (missing.length > 0) {
      setNote({
        kind: 'err',
        text: `This is missing ${missing.join(', ')}. Paste the whole exported file, not one section of it.`,
      });
      return;
    }

    setBusy('import');
    setNote(null);
    // No idempotency key: the tool is `idempotent: false` and a replay would be
    // a second brand, not a safe repeat.
    const res = await invoke<{ brandId: string; genomeId: string; name: string }>('brand.import', {
      ...(newName.trim() ? { name: newName.trim() } : {}),
      data: parsed,
    });
    setBusy(null);
    if (res.status !== 'succeeded') {
      setNote({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That import was held for review.' });
      return;
    }
    setNote({
      kind: 'ok',
      text: `Created ${res.output.name}. Its audience segments did not transfer — no tool writes that field — so check them in brand settings.`,
    });
    setJson('');
    setNewName('');
    await load();
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">Move a brand</h2>
      <p className="mt-1 max-w-prose text-[14px] text-ink-muted">
        Export a brand&rsquo;s answers as a file, or create a new brand from one. Identity, the five questions,
        voice, offer and constraints travel. Assets, published posts, performance history and the audit trail
        stay where they are.
      </p>

      {note ? (
        <p className={cn('mt-3 text-[13px]', note.kind === 'ok' ? 'text-success' : 'text-destructive')}>{note.text}</p>
      ) : null}

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ── Out ──────────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-border p-4">
          <p className="text-[13px] font-medium text-ink">Export</p>
          <p className="mt-1 text-[12px] text-ink-muted">
            Downloads a JSON file. Safe to hand to the client it belongs to — it carries their answers, not your
            results.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[180px] flex-1">
              <label className="block text-[12px] text-ink-muted" htmlFor="export-brand">
                Brand
              </label>
              <select
                id="export-brand"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink"
              >
                {brands.length === 0 ? <option value="">No brands yet</option> : null}
                {brands.map((b) => (
                  <option key={b.genomeId} value={b.genomeId}>
                    {b.name || b.brandId}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="outline" disabled={busy !== null || !selected} onClick={() => void exportBrand()}>
              {busy === 'export' ? 'Exporting…' : 'Download'}
            </Button>
          </div>
        </div>

        {/* ── In ───────────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-border p-4">
          <p className="text-[13px] font-medium text-ink">Import</p>
          <p className="mt-1 text-[12px] text-ink-muted">
            Creates a <span className="font-medium text-ink">new</span> brand. It does not overwrite an existing
            one, and there is no undo — the only way back is deleting what this makes.
          </p>

          <label className="mt-3 block text-[12px] text-ink-muted" htmlFor="import-name">
            Call it (optional — otherwise the name in the file)
          </label>
          <Input
            id="import-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Northside Barbers"
            className="mt-1"
          />

          <label className="mt-3 block text-[12px] text-ink-muted" htmlFor="import-json">
            The exported file
          </label>
          <textarea
            id="import-json"
            value={json}
            onChange={(e) => setJson(e.target.value)}
            rows={5}
            spellCheck={false}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[12px] text-ink"
            placeholder='{ "name": "…", "identity": { … }, "dimensions": { … }, … }'
          />

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readFile(file);
                e.target.value = '';
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
              Load a file
            </Button>
            <Button size="sm" disabled={busy !== null || !json.trim()} onClick={() => void importBrand()}>
              {busy === 'import' ? 'Creating…' : 'Create brand'}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** A filename, not an id — lowercase, hyphens, nothing a filesystem argues about. */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'brand';
}
