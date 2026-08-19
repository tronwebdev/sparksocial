'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/tools';
import { ASSET_ROLES } from './roles';

/**
 * `asset.rights.set` / `.cooldown.check` / `.reuse` / `.folder.*` — real
 * since 17 Aug 2026, reached from no screen until now. Opened from a click
 * on an `AssetSearchGrid` card (which previously had no `onClick` at all);
 * the base fields (caption/role/rightsStatus/usageCount) are the same
 * `asset.retrieve` row the grid already fetched, passed straight through as
 * props rather than re-fetched — there's no `asset.get` single-asset read
 * tool, and the grid's own data is already current.
 */

export interface DetailAsset {
  assetId: string;
  role: string;
  caption: string | null;
  usageCount: number;
  lastUsedAt: string | null;
  rightsStatus: string;
  folderId: string | null;
}

const RIGHTS_OPTIONS = ['cleared', 'pending', 'restricted'] as const;

export function AssetDetailPanel({
  asset,
  genomeId,
  open,
  onClose,
  onChanged,
}: {
  asset: DetailAsset | null;
  genomeId: string;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [rightsStatus, setRightsStatus] = useState(asset?.rightsStatus ?? 'pending');
  const [rightsBusy, setRightsBusy] = useState(false);

  const [cooldown, setCooldown] = useState<{ inCooldown: boolean; lastUsedDaysAgo?: number } | null>(null);
  const [cooldownBusy, setCooldownBusy] = useState(false);

  const [folders, setFolders] = useState<{ folderId: string; name: string }[] | null>(null);
  const [folderId, setFolderId] = useState<string>(asset?.folderId ?? '');
  const [folderBusy, setFolderBusy] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderOpen, setNewFolderOpen] = useState(false);

  const [reuseBusy, setReuseBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!asset) return;
    setRightsStatus(asset.rightsStatus);
    setFolderId(asset.folderId ?? '');
    setCooldown(null);
    setMessage(null);
  }, [asset]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const res = await invoke<{ folders: { folderId: string; name: string }[] }>('asset.folder.list', { genomeId });
      if (res.status === 'succeeded') setFolders(res.output.folders);
    })();
  }, [open, genomeId]);

  if (!open || !asset) return null;

  async function setRights(next: (typeof RIGHTS_OPTIONS)[number]) {
    setRightsBusy(true);
    setMessage(null);
    const res = await invoke<{ rightsStatus: string }>('asset.rights.set', { genomeId, assetId: asset!.assetId, rightsStatus: next });
    setRightsBusy(false);
    if (res.status === 'succeeded') {
      setRightsStatus(res.output.rightsStatus);
      onChanged();
    } else {
      setMessage({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That request was gated.' });
    }
  }

  async function checkCooldown() {
    setCooldownBusy(true);
    setMessage(null);
    const res = await invoke<{ results: { assetId: string; inCooldown: boolean; lastUsedDaysAgo?: number }[] }>('asset.cooldown.check', {
      genomeId,
      assetIds: [asset!.assetId],
    });
    setCooldownBusy(false);
    if (res.status === 'succeeded') {
      setCooldown(res.output.results[0] ?? null);
    } else {
      setMessage({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That request was gated.' });
    }
  }

  async function moveToFolder(next: string) {
    setFolderBusy(true);
    setMessage(null);
    const res = await invoke<{ folderId: string | null }>('asset.folder.move', {
      genomeId,
      assetId: asset!.assetId,
      folderId: next || null,
    });
    setFolderBusy(false);
    if (res.status === 'succeeded') {
      setFolderId(res.output.folderId ?? '');
      onChanged();
    } else {
      setMessage({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That request was gated.' });
    }
  }

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    setFolderBusy(true);
    setMessage(null);
    const res = await invoke<{ folderId: string; name: string }>('asset.folder.create', { genomeId, name }, crypto.randomUUID());
    if (res.status === 'succeeded') {
      setFolders((f) => [...(f ?? []), res.output]);
      setNewFolderName('');
      setNewFolderOpen(false);
      await moveToFolder(res.output.folderId);
    } else {
      setFolderBusy(false);
      setMessage({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That request was gated.' });
    }
  }

  async function markUsed() {
    setReuseBusy(true);
    setMessage(null);
    const res = await invoke<{ usageCount: number }>('asset.reuse', { genomeId, assetId: asset!.assetId }, crypto.randomUUID());
    setReuseBusy(false);
    if (res.status === 'succeeded') {
      setMessage({ kind: 'ok', text: `Marked used — usage count now ${res.output.usageCount}.` });
      onChanged();
    } else {
      setMessage({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That request was gated.' });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" role="dialog" aria-label="Asset detail">
      <div className="flex max-h-[85vh] w-[520px] max-w-full flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-[16px] font-semibold text-ink">{ASSET_ROLES.find((r) => r.value === asset.role)?.label ?? asset.role}</h2>
          <button type="button" onClick={onClose} className="text-[14px] text-ink-muted hover:text-ink">
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <p className="text-[14px] text-ink">{asset.caption ?? '(no caption)'}</p>
          <p className="mt-1 text-[12px] text-ink-muted">
            used {asset.usageCount}× {asset.lastUsedAt ? `· last used ${new Date(asset.lastUsedAt).toLocaleDateString()}` : ''}
          </p>

          <div className="mt-5 rounded-lg border border-border p-4">
            <p className="text-[13px] font-medium text-ink">Rights status</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {RIGHTS_OPTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={rightsBusy}
                  onClick={() => void setRights(r)}
                  className={`rounded-full border px-3 py-1.5 text-[13px] capitalize disabled:opacity-50 ${
                    rightsStatus === r ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-ink hover:bg-surface-muted'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-medium text-ink">Reuse cooldown</p>
              <Button size="sm" variant="outline" disabled={cooldownBusy} onClick={() => void checkCooldown()}>
                {cooldownBusy ? 'Checking…' : 'Check cooldown'}
              </Button>
            </div>
            {cooldown ? (
              <p className="mt-2 text-[13px] text-ink-muted">
                <Badge variant={cooldown.inCooldown ? 'warn' : 'success'} className="mr-2">
                  {cooldown.inCooldown ? 'in cooldown' : 'clear to reuse'}
                </Badge>
                {cooldown.lastUsedDaysAgo !== undefined ? `last used ${cooldown.lastUsedDaysAgo}d ago` : 'never used'}
              </p>
            ) : null}
          </div>

          <div className="mt-3 rounded-lg border border-border p-4">
            <p className="text-[13px] font-medium text-ink">Folder</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value={folderId}
                disabled={folderBusy || folders === null}
                onChange={(e) => void moveToFolder(e.target.value)}
                className="h-9 rounded border border-border bg-surface px-2 text-[13px] text-ink disabled:opacity-50"
              >
                <option value="">No folder</option>
                {(folders ?? []).map((f) => (
                  <option key={f.folderId} value={f.folderId}>
                    {f.name}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="outline" onClick={() => setNewFolderOpen((v) => !v)}>
                {newFolderOpen ? 'Cancel' : '+ New folder'}
              </Button>
            </div>
            {newFolderOpen ? (
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="e.g. B-roll"
                  className="h-9 flex-1 rounded border border-border bg-input px-2 text-[13px] text-ink placeholder:text-ink-placeholder"
                />
                <Button size="sm" disabled={folderBusy || !newFolderName.trim()} onClick={() => void createFolder()}>
                  Create
                </Button>
              </div>
            ) : null}
          </div>

          <div className="mt-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[13px] font-medium text-ink">Mark as used</p>
                <p className="text-[12px] text-ink-muted">
                  For assets referenced outside a tracked publish — Assemble captures, Direct+Finish. A real
                  publish already records this automatically.
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={reuseBusy} onClick={() => void markUsed()}>
                {reuseBusy ? 'Recording…' : 'Mark used'}
              </Button>
            </div>
          </div>

          {message ? (
            <p className={`mt-3 text-[13px] ${message.kind === 'ok' ? 'text-success' : 'text-destructive'}`}>{message.text}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
