'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { ASSET_ROLES } from './roles';

/**
 * The upload half of the Asset Graph — `asset.upload_url` → PUT bytes
 * straight to storage → `asset.ingest_url`. Real since P0/P2; reached from no
 * screen until now.
 *
 * `x-ms-blob-type: BlockBlob` on the PUT is Azure's own requirement for a SAS
 * upload URL, not a SparkSocial convention — omit it and a real Azure PUT
 * returns 400. In dev mode (`AZURE_STORAGE_ACCOUNT` unset) the upload target
 * is `memory.blob.local`, which does not resolve — the PUT fails there by
 * construction, same as every other vendor call this session that needs a
 * key nobody has configured locally; `asset.ingest_url`/`.retrieve`/`.gaps`
 * are independently real and don't depend on a successful PUT to verify.
 */

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
};

function guessContentType(file: File): string | undefined {
  if (file.type) return file.type;
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  return CONTENT_TYPES[ext];
}

export function AssetUploadForm({ onIngested }: { onIngested: () => void }) {
  const { genome } = useSelectedGenome();
  const inputRef = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<string>(ASSET_ROLES[0]!.value);
  // Every asset used to upload as 'pending' unconditionally, with no screen
  // anywhere to ever move it to 'cleared' — since `asset.retrieve` and
  // `assets.inventory()` both hard-filter to `rightsStatus = 'cleared'`
  // (packages/db/src/scoped.ts) and the rights guardrail blocks anything
  // else at draft time (packages/guardrails/src/rights.ts §10), that meant
  // no upload through this form could ever actually be used. The guardrail's
  // real target is third-party material — UGC, licensed music, a cloned
  // likeness — not a business's own logo or product photos, which is what
  // this form is for; self-attestation defaulting to "yes" fits that case
  // and still lets someone uncheck it for a photo they don't yet have
  // clearance on.
  const [rightsCleared, setRightsCleared] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function upload(file: File) {
    if (!genome) return;
    const contentType = guessContentType(file);
    if (!contentType) {
      setMessage({ kind: 'err', text: 'Unrecognized file type.' });
      return;
    }

    setBusy(true);
    setMessage(null);

    const presigned = await invoke<{ uploadUrl: string; readUrl: string; key: string }>('asset.upload_url', {
      genomeId: genome.genomeId,
      filename: file.name,
      contentType,
      sizeBytes: file.size,
    });

    if (presigned.status !== 'succeeded') {
      setBusy(false);
      setMessage({ kind: 'err', text: presigned.status === 'failed' ? presigned.error.message : 'Upload was gated.' });
      return;
    }

    try {
      const put = await fetch(presigned.output.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': contentType, 'x-ms-blob-type': 'BlockBlob' },
        body: file,
      });
      if (!put.ok) throw new Error(`Storage rejected the upload (${put.status}).`);
    } catch (e) {
      setBusy(false);
      setMessage({
        kind: 'err',
        text: e instanceof Error ? e.message : 'The upload could not reach storage.',
      });
      return;
    }

    const mediaType = contentType.startsWith('image/') ? 'image' : contentType.startsWith('video/') ? 'video' : 'audio';
    const ingested = await invoke<{ assetId: string; caption: string }>(
      'asset.ingest_url',
      {
        genomeId: genome.genomeId,
        url: presigned.output.readUrl,
        assetRole: role,
        mediaType,
        rightsStatus: rightsCleared ? 'cleared' : 'pending',
        source: 'assets_library_upload',
      },
      // Not idempotent (a second call would duplicate the asset) — unique
      // per upload via the storage key, which is already unique per file.
      `asset-ingest:${presigned.output.key}`,
    );

    setBusy(false);
    if (ingested.status !== 'succeeded') {
      setMessage({ kind: 'err', text: ingested.status === 'failed' ? ingested.error.message : 'Ingest was gated.' });
      return;
    }
    setMessage({ kind: 'ok', text: `Added — captioned as "${ingested.output.caption}"` });
    if (inputRef.current) inputRef.current.value = '';
    onIngested();
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid grid-cols-1 gap-1">
        <label className="text-[12px] font-medium text-ink-muted" htmlFor="upload-role">
          Role
        </label>
        <select
          id="upload-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="h-10 rounded border border-border bg-surface px-3 text-[14px] text-ink"
        >
          {ASSET_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-1 gap-1">
        <label className="text-[12px] font-medium text-ink-muted" htmlFor="upload-file">
          File
        </label>
        <input
          id="upload-file"
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/wav"
          disabled={busy || !genome}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
          className="text-[13px] text-ink-muted file:mr-3 file:h-10 file:rounded file:border-0 file:bg-primary file:px-3 file:text-[13px] file:font-medium file:text-primary-foreground"
        />
      </div>
      <label className="flex h-10 items-center gap-2 text-[13px] text-ink-muted" htmlFor="upload-rights-cleared">
        <input
          id="upload-rights-cleared"
          type="checkbox"
          checked={rightsCleared}
          onChange={(e) => setRightsCleared(e.target.checked)}
          className="h-4 w-4"
        />
        This is my own photo/video, or I have permission to use it
      </label>
      {busy ? <Button size="sm" disabled>Uploading…</Button> : null}
      {message ? (
        <span className={`text-[13px] ${message.kind === 'ok' ? 'text-success' : 'text-destructive'}`}>{message.text}</span>
      ) : null}
    </div>
  );
}
