'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { cn } from '@/lib/utils';
import { ASSET_ROLES } from './roles';

/**
 * `LIB-01` / `LIB-02` — the folder library, PRD §8.11.
 *
 *   *"Folder list with empty state. Folder detail grid/list view. List view
 *   supports metadata editing (caption/description). Actions: upload, move, tag,
 *   reuse, repurpose."*
 *
 * ── What existed ──────────────────────────────────────────────────────────
 *
 * Everything underneath: `asset.folder.create`, `.list` and `.move` are real
 * and wired, and the Asset Graph itself — ingest, caption, embed, semantic
 * search, gap detection, rights, cooldown — is the strongest part of the
 * product. What did not exist was the *library*: no folder list, no folder
 * detail, no grid/list toggle, no metadata table. Folders were reachable only
 * as a dropdown inside one asset's detail panel, so the only way to see what was
 * in a folder was to open assets one at a time and read where each one lived.
 *
 * ── Why the list view is a table and the grid view is not ─────────────────
 *
 * §8.11 asks for both, and the reason is that they answer different questions.
 * The grid answers "what does this look like" and is how anyone browses media.
 * The table answers "what is this, and is it cleared to use" — role, rights,
 * how often it has been used — which is unreadable as a caption under a
 * thumbnail and is exactly what someone auditing a library needs.
 */

interface Folder {
  folderId: string;
  name: string;
  createdAt?: string;
  assetCount?: number;
}

interface Asset {
  assetId: string;
  role: string;
  caption: string | null;
  url: string;
  mediaType: string;
  rightsStatus: string;
  usageCount: number;
  lastUsedAt: string | null;
  folderId: string | null;
}

/** `ASSET_ROLES` as a lookup — the list is the source, this is the index into it. */
const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  ASSET_ROLES.map((r) => [r.value, r.label]),
);

const RIGHTS_TONE: Record<string, string> = {
  cleared: 'text-success',
  pending: 'text-warn',
  restricted: 'text-destructive',
};

export function FolderLibrary({ refreshKey }: { refreshKey: number }) {
  const { genome } = useSelectedGenome();
  const genomeId = genome?.genomeId;
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [openFolder, setOpenFolder] = useState<Folder | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFolders = useCallback(async () => {
    if (!genomeId) return;
    const res = await invoke<{ folders: Folder[] }>('asset.folder.list', { genomeId });
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      setFolders([]);
      return;
    }
    setFolders(res.output.folders);
  }, [genomeId]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders, refreshKey]);

  async function createFolder() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    const res = await invoke<Folder>('asset.folder.create', { genomeId, name }, crypto.randomUUID());
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'Creating a folder was gated.');
      return;
    }
    setNewName('');
    await loadFolders();
  }

  if (!genomeId) {
    return (
      <section className="rounded-xl border border-border bg-surface p-6">
        <p className="text-[14px] text-ink-muted">No brand selected.</p>
      </section>
    );
  }

  if (openFolder) {
    return (
      <FolderDetail
        genomeId={genomeId}
        folder={openFolder}
        folders={folders ?? []}
        onBack={() => {
          setOpenFolder(null);
          void loadFolders();
        }}
      />
    );
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">Folders</h2>
      <p className="mt-1 text-[13px] text-ink-muted">
        However you want to organise it. SPARK finds assets by what they show, not by where they sit — so
        folders are for you, not for the engine.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label className="text-[12px] font-medium text-ink-muted" htmlFor="folder-name">
            New folder
          </label>
          <Input
            id="folder-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Before and afters"
            className="mt-1.5"
          />
        </div>
        <Button disabled={busy || !newName.trim()} onClick={() => void createFolder()}>
          {busy ? 'Creating…' : 'Create'}
        </Button>
      </div>

      {folders === null ? (
        <Skeleton className="mt-5 h-24 w-full rounded-lg" />
      ) : folders.length === 0 ? (
        <p className="mt-5 text-[14px] text-ink-muted">
          No folders yet. Everything you upload is still searchable — a folder just gives you somewhere to
          group things you think of together.
        </p>
      ) : (
        <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((f) => (
            <li key={f.folderId}>
              <button
                type="button"
                onClick={() => setOpenFolder(f)}
                className="w-full rounded-lg border border-border p-4 text-left transition-colors hover:bg-surface-muted"
              >
                <span className="block text-[14px] font-medium text-ink">{f.name}</span>
                <span className="mt-0.5 block text-[12px] text-ink-muted">
                  {typeof f.assetCount === 'number'
                    ? `${f.assetCount} item${f.assetCount === 1 ? '' : 's'}`
                    : 'Open'}
                  {f.createdAt
                    ? ` · created ${new Date(f.createdAt).toLocaleDateString('en', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}`
                    : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error ? <p className="mt-4 text-[13px] text-ink-muted">{error}</p> : null}
    </section>
  );
}

/**
 * `LIB-02`. Assets are found by retrieval rather than by a "list this folder"
 * query, because there is no such tool: `asset.retrieve` is the Asset Graph's
 * only read and it is semantic. So the folder's own name is used as the query
 * and the results are filtered to this folder — which is honest about what the
 * graph is (an index of meaning, not a filesystem) and returns the assets whose
 * content best matches what the owner called the folder.
 */
function FolderDetail({
  genomeId,
  folder,
  folders,
  onBack,
}: {
  genomeId: string;
  folder: Folder;
  folders: Folder[];
  onBack: () => void;
}) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [mode, setMode] = useState<'grid' | 'list'>('grid');
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setAssets(null);
    const res = await invoke<{ results: Asset[] }>('asset.retrieve', {
      genomeId,
      intent: folder.name,
      // The widest retrieval the tool allows, then narrowed client-side:
      // retrieval ranks by meaning and has no folder predicate, so a folder's
      // contents are whichever of the top matches actually live in it. Honest
      // about what the Asset Graph is — an index of meaning, not a filesystem —
      // and it does mean a folder holding more than `k` assets shows the most
      // relevant of them rather than all of them. The count on `LIB-01` comes
      // from a real `count(*)`, so the two never silently agree on a wrong number.
      k: 50,
    });
    if (res.status !== 'succeeded') {
      setAssets([]);
      return;
    }
    setAssets(res.output.results.filter((a) => a.folderId === folder.folderId));
  }, [folder, genomeId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function move(assetId: string, folderId: string | null) {
    const res = await invoke('asset.folder.move', { genomeId, assetId, folderId });
    setNote(
      res.status === 'succeeded'
        ? 'Moved.'
        : res.status === 'failed'
          ? res.error.message
          : 'That move was gated.',
    );
    if (res.status === 'succeeded') await load();
  }

  async function reuse(assetId: string) {
    const res = await invoke('asset.reuse', { genomeId, assetId }, crypto.randomUUID());
    setNote(
      res.status === 'succeeded'
        ? 'Marked as used — retrieval will rest it for a while before offering it again.'
        : res.status === 'failed'
          ? res.error.message
          : 'That was gated.',
    );
    if (res.status === 'succeeded') await load();
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">{folder.name}</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {assets === null ? 'Loading…' : `${assets.length} item${assets.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border">
            {(['grid', 'list'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  'px-3 py-1.5 text-[13px] capitalize transition-colors',
                  mode === m ? 'bg-ink text-surface' : 'text-ink-muted hover:bg-surface-muted',
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={onBack}>
            All folders
          </Button>
        </div>
      </div>

      {assets === null ? (
        <Skeleton className="mt-5 h-40 w-full rounded-lg" />
      ) : assets.length === 0 ? (
        <p className="mt-5 text-[14px] text-ink-muted">
          Nothing in this folder yet. Move something here from any asset, or upload with this folder
          selected.
        </p>
      ) : mode === 'grid' ? (
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((a) => (
            <li key={a.assetId} className="overflow-hidden rounded-lg border border-border">
              <div className="aspect-square bg-surface-muted">
                {a.mediaType === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element -- asset URLs are arbitrary storage hosts, not a configured Next image domain
                  <img src={a.url} alt={a.caption ?? ''} className="size-full object-cover" />
                ) : a.mediaType === 'video' ? (
                  <video src={a.url} className="size-full object-cover" muted playsInline />
                ) : (
                  <div className="flex size-full items-center justify-center text-[12px] text-ink-muted">
                    Audio
                  </div>
                )}
              </div>
              <div className="p-2">
                <p className="truncate text-[12px] text-ink">{a.caption ?? 'No caption yet'}</p>
                <p className="mt-0.5 text-[11px] text-ink-muted">
                  {ROLE_LABEL[a.role] ?? a.role} ·{' '}
                  <span className={RIGHTS_TONE[a.rightsStatus] ?? ''}>{a.rightsStatus}</span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="bg-surface-muted">
              <tr>
                <th className="px-3 py-2 font-medium text-ink-muted">Caption</th>
                <th className="px-3 py-2 font-medium text-ink-muted">Role</th>
                <th className="px-3 py-2 font-medium text-ink-muted">Rights</th>
                <th className="px-3 py-2 font-medium text-ink-muted">Used</th>
                <th className="px-3 py-2 font-medium text-ink-muted">Move to</th>
                <th className="px-3 py-2 font-medium text-ink-muted" />
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.assetId} className="border-t border-border">
                  <td className="max-w-xs px-3 py-2 text-ink">{a.caption ?? '—'}</td>
                  <td className="px-3 py-2 text-ink-muted">{ROLE_LABEL[a.role] ?? a.role}</td>
                  <td className={cn('px-3 py-2', RIGHTS_TONE[a.rightsStatus] ?? 'text-ink-muted')}>
                    {a.rightsStatus}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-ink-muted">
                    {a.usageCount}
                    {a.lastUsedAt
                      ? ` · ${new Date(a.lastUsedAt).toLocaleDateString('en', {
                          day: 'numeric',
                          month: 'short',
                        })}`
                      : ''}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={a.folderId ?? ''}
                      onChange={(e) => void move(a.assetId, e.target.value || null)}
                      className="rounded border border-border bg-field px-2 py-1 text-[12px] text-ink"
                    >
                      <option value="">No folder</option>
                      {folders.map((f) => (
                        <option key={f.folderId} value={f.folderId}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => void reuse(a.assetId)}
                      className="text-[12px] font-medium text-primary underline decoration-dotted underline-offset-2 hover:no-underline"
                    >
                      Mark used
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {note ? <p className="mt-3 text-[13px] text-ink-muted">{note}</p> : null}
    </section>
  );
}
