'use client';

import { useState } from 'react';
import { ModalShell } from '@/components/common/ModalShell';
import { invoke } from '@/lib/tools';
import type { Folder } from './types';

/**
 * The two folder actions that need a confirmation step — Rename and Delete.
 *
 * Share is here too, for a reason worth writing down: the first version just
 * called `navigator.clipboard.writeText` and toasted "copied". That call is
 * refused whenever the page lacks user activation or is not the focused
 * document, and the honest failure message — "your browser blocked the
 * clipboard" — leaves the person without the one thing they asked for. A panel
 * that shows the link cannot fail to share it; the Copy button is then a
 * convenience rather than the whole feature.
 *
 * Neither panel is in `SparkSocial Assets Library.dc.html` — the prototype's
 * `⋯` only toasts "mock" — so both are built to the Create Folder modal's own
 * frame from that file (radius 28, its gradient, the same footer pair) at the
 * smaller height the content needs.
 */

function Footer({
  onCancel,
  onConfirm,
  confirmLabel,
  busy,
  danger = false,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  busy: boolean;
  danger?: boolean;
}) {
  return (
    <div className="mt-[30px] flex items-center justify-center gap-[26px]">
      <button
        type="button"
        onClick={onCancel}
        className="flex h-[52px] items-center gap-[11px] rounded-[11px] px-[22px] transition-colors hover:bg-white"
        style={{ background: 'rgba(255,255,255,0.6)', boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.4)' }}
      >
        <svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden>
          <path d="m1.5 1.5 12 12m0-12-12 12" stroke="#838383" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        <span className="text-17 font-medium" style={{ color: '#838383' }}>
          Cancel
        </span>
      </button>

      <button
        type="button"
        onClick={onConfirm}
        disabled={busy}
        className="flex h-[52px] items-center gap-[14px] rounded-[11px] px-[20px] text-18 font-semibold transition-opacity hover:opacity-90 active:scale-[0.985] disabled:opacity-60"
        style={danger ? { background: '#F35525', color: '#FFFFFF' } : { background: 'var(--ss-lib-toggle)', color: '#0C0C0C' }}
      >
        {confirmLabel}
      </button>
    </div>
  );
}

export function ShareFolderModal({
  folder,
  url,
  onClose,
}: {
  folder: Folder;
  url: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied('done');
      return;
    } catch {
      /* Fall through to the pre-Clipboard-API path, which only needs the
         selection and works in contexts that refuse the async call. */
    }
    try {
      const field = document.getElementById('lib-folder-share') as HTMLInputElement | null;
      field?.select();
      setCopied(document.execCommand('copy') ? 'done' : 'failed');
    } catch {
      setCopied('failed');
    }
  }

  return (
    <ModalShell
      top={300}
      height={400}
      width={620}
      radius={28}
      background="var(--ss-grad-lib-create)"
      label="Share folder"
      onClose={onClose}
    >
      <p className="pt-[54px] text-center text-[26px] font-bold text-ink">Share “{folder.name}”</p>
      <p className="mx-auto mt-[10px] max-w-[420px] text-center text-15 leading-[1.5] text-ink-muted">
        {/* Said plainly, because "share" usually means "anyone with the link".
            This one does not: there is no public review page yet, so the link
            lands on sign-in for anyone outside the workspace. */}
        Anyone in this workspace who opens this link lands on the folder. It is not a public link —
        people outside the workspace will be asked to sign in.
      </p>

      <div className="px-[70px] pt-[26px]">
        <div className="flex items-center gap-[10px]">
          <input
            id="lib-folder-share"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="h-[56px] min-w-0 flex-1 rounded-[14px] bg-white px-[18px] text-15 font-medium text-ink outline-none"
            style={{ boxShadow: '0 10px 30px -22px rgba(12,12,12,0.35), inset 0 0 0 1px rgba(131,131,131,0.12)' }}
          />
          <button
            type="button"
            onClick={() => void copy()}
            className="h-[56px] shrink-0 rounded-[12px] px-[20px] text-16 font-semibold text-ink transition-opacity hover:opacity-90"
            style={{ background: 'var(--ss-lib-toggle)' }}
          >
            {copied === 'done' ? 'Copied' : 'Copy'}
          </button>
        </div>
        {copied === 'failed' ? (
          <p className="mt-[10px] text-14 text-ink-muted">
            Your browser blocked the copy — select the link above and copy it manually.
          </p>
        ) : null}
      </div>

      <div className="mt-[26px] flex items-center justify-center">
        <button
          type="button"
          onClick={onClose}
          className="flex h-[52px] items-center rounded-[11px] px-[26px] transition-colors hover:bg-white"
          style={{ background: 'rgba(255,255,255,0.6)', boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.4)' }}
        >
          <span className="text-17 font-medium" style={{ color: '#838383' }}>
            Done
          </span>
        </button>
      </div>
    </ModalShell>
  );
}

export function RenameFolderModal({
  genomeId,
  folder,
  onClose,
  onRenamed,
}: {
  genomeId: string;
  folder: Folder;
  onClose: () => void;
  onRenamed: (name: string) => void;
}) {
  const [name, setName] = useState(folder.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const next = name.trim();
    if (busy || !next) return;
    if (next === folder.name) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    /* `idempotent: true` — the same name twice is the same state, so `invoke`
       needs no key here (unlike `asset.folder.create`, where it does). */
    const res = await invoke<{ name: string }>('asset.folder.rename', {
      genomeId,
      folderId: folder.folderId,
      name: next,
    });
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    onRenamed(res.output.name);
  }

  return (
    <ModalShell
      top={300}
      height={400}
      width={620}
      radius={28}
      background="var(--ss-grad-lib-create)"
      label="Rename folder"
      onClose={onClose}
    >
      <p className="pt-[54px] text-center text-[26px] font-bold text-ink">Rename Folder</p>

      <div className="px-[90px] pt-[30px]">
        <label htmlFor="lib-folder-rename" className="block text-17 font-medium text-ink">
          Folder Name
        </label>
        <input
          id="lib-folder-rename"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
          className="mt-[10px] h-[66px] w-full rounded-[14px] bg-white px-[24px] text-17 font-medium text-ink outline-none"
          style={{ boxShadow: '0 10px 30px -22px rgba(12,12,12,0.35), inset 0 0 0 1px rgba(131,131,131,0.12)' }}
        />
        <p className="mt-[10px] text-14 text-ink-muted">
          Only the folder’s name changes. Nothing inside it moves.
        </p>
        {error ? <p className="mt-[12px] text-15 text-destructive">{error}</p> : null}
      </div>

      <Footer onCancel={onClose} onConfirm={() => void save()} confirmLabel={busy ? 'Saving…' : 'Save'} busy={busy} />
    </ModalShell>
  );
}

export function DeleteFolderModal({
  genomeId,
  folder,
  onClose,
  onDeleted,
}: {
  genomeId: string;
  folder: Folder;
  onClose: () => void;
  onDeleted: (unfiled: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await invoke<{ unfiled: number }>('asset.folder.delete', {
      genomeId,
      folderId: folder.folderId,
    });
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    onDeleted(res.output.unfiled);
  }

  return (
    <ModalShell
      top={290}
      height={420}
      width={620}
      radius={28}
      background="var(--ss-grad-lib-create)"
      label="Delete folder"
      onClose={onClose}
    >
      <p className="pt-[50px] text-center text-[26px] font-bold text-ink">Delete “{folder.name}”?</p>

      <div className="px-[70px] pt-[20px]">
        {/* The single most important thing this panel does is say that the files
            survive — "delete" on a folder full of a business's footage reads as
            catastrophic unless it is spelled out. It matches what the tool does:
            `asset.folder.delete` nulls `folderId` and keeps every row. */}
        <p className="text-center text-16 leading-[1.55] text-ink">
          {folder.assetCount === 0
            ? 'This folder is empty, so nothing else changes.'
            : `The ${folder.assetCount} ${folder.assetCount === 1 ? 'file' : 'files'} inside are not deleted.`}{' '}
          <span className="text-ink-muted">
            {folder.assetCount === 0
              ? 'The folder itself is removed.'
              : 'They stay in the Asset Graph without a folder, SPARK can still use them, and posts that already reference them keep working. To remove a file for good, delete it from inside the folder first.'}
          </span>
        </p>
        {error ? <p className="mt-[14px] text-center text-15 text-destructive">{error}</p> : null}
      </div>

      <Footer
        onCancel={onClose}
        onConfirm={() => void remove()}
        confirmLabel={busy ? 'Deleting…' : 'Delete folder'}
        busy={busy}
        danger
      />
    </ModalShell>
  );
}

/**
 * The folder picker behind "File…" in the Unfiled view — the way back for an
 * asset that a folder delete left loose.
 */
export function PickFolderModal({
  genomeId,
  asset,
  assetName,
  folders,
  onClose,
  onFiled,
}: {
  genomeId: string;
  asset: string;
  assetName: string;
  folders: Folder[];
  onClose: () => void;
  onFiled: (folderName: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function file(f: Folder) {
    if (busy) return;
    setBusy(f.folderId);
    setError(null);
    const res = await invoke('asset.folder.move', { genomeId, assetId: asset, folderId: f.folderId }, `asset-move:${asset}:${f.folderId}`);
    setBusy(null);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    onFiled(f.name);
  }

  return (
    <ModalShell
      top={240}
      height={520}
      width={620}
      radius={28}
      background="var(--ss-grad-lib-create)"
      label="Choose a folder"
      onClose={onClose}
    >
      <p className="pt-[50px] text-center text-[26px] font-bold text-ink">Move to a folder</p>
      <p className="mx-auto mt-[8px] max-w-[420px] truncate text-center text-15 text-ink-muted" title={assetName}>
        {assetName}
      </p>

      <div className="mt-[22px] max-h-[280px] overflow-y-auto px-[70px]">
        {folders.length === 0 ? (
          <p className="py-[30px] text-center text-16 text-ink-muted">
            There are no folders yet. Create one first, then file this here.
          </p>
        ) : (
          <ul className="flex flex-col gap-[9px]">
            {folders.map((f) => (
              <li key={f.folderId}>
                <button
                  type="button"
                  onClick={() => void file(f)}
                  disabled={busy !== null}
                  className="flex h-[58px] w-full items-center justify-between rounded-[13px] bg-white px-[18px] transition-shadow hover:shadow-[0_10px_26px_-18px_rgba(12,12,12,0.5)] disabled:opacity-60"
                  style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.12)' }}
                >
                  <span className="truncate text-16 font-semibold text-ink">{f.name}</span>
                  <span className="ml-[12px] shrink-0 text-14 font-medium" style={{ color: '#838383' }}>
                    {busy === f.folderId ? 'Moving…' : `${f.assetCount} ${f.assetCount === 1 ? 'file' : 'files'}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {error ? <p className="mt-[12px] text-center text-15 text-destructive">{error}</p> : null}
      </div>

      <div className="mt-[22px] flex items-center justify-center">
        <button
          type="button"
          onClick={onClose}
          className="flex h-[52px] items-center rounded-[11px] px-[26px] transition-colors hover:bg-white"
          style={{ background: 'rgba(255,255,255,0.6)', boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.4)' }}
        >
          <span className="text-17 font-medium" style={{ color: '#838383' }}>
            Cancel
          </span>
        </button>
      </div>
    </ModalShell>
  );
}
