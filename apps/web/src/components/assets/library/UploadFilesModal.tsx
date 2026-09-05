'use client';

import { useCallback, useRef, useState } from 'react';
import { ModalShell } from '@/components/common/ModalShell';
import { invoke } from '@/lib/tools';
import { formatBytes } from '../AssetsLibraryScreen';
import { ASSET_ROLES } from '../roles';
import type { Folder } from './types';

/**
 * `Upload Files Modal` — `SparkSocial Assets Library.dc.html`.
 *
 *   panel      464,50 · 800x1020 at radius 28 on
 *              `linear-gradient(180deg,#7FE5F8 0%,#B9EFFA 12%,#EAFAFD 30%,#FFFFFF 52%)`
 *   title      32,38 · 23px/700; subtitle 32,76 · 18px/400 `#5B5B5B`
 *   dropzone   30,140 · 740x340 r8, `1.6px dashed rgba(90,90,90,.55)` over
 *              `rgba(255,255,255,.92)` — a 96px white disc holding a 76px
 *              `#63DEF5` disc and the cloud-up glyph, "Drag & Drop files here
 *              or" in 19px/600, a "Browse files" pill (h46 r9), then the
 *              formats and max-size lines in 15px/500 `#3B3B3B`
 *   rows       30,508 · 740 wide on `#F2F2F4` at radius 14 — 96 tall while
 *              uploading (a 6px bar on `#0C0C0C` filled by
 *              `90deg #6CE8FF → #A341FF → #FEDEB5`), 80 when done (a green
 *              tick, an edit and a delete button)
 *   edit view  a 322-wide file list at 30,508 beside a 388x200 preview at
 *              382,508, with File Name at 752 and Meta Description at 852
 *   footer     bottom 44, centred, gap 22 — Cancel and Continue (h54 r12),
 *              Continue at `opacity .5` until the upload finishes,
 *              `transition: opacity .2s`
 *
 * ── The prototype's four stages are this component's state machine ───────
 *
 *   0 drop → clicking the zone starts an upload
 *   1 uploading → a 2s timer in the prototype; here, the real PUT
 *   2 done → Continue moves on, as does the row's edit button
 *   3 edit metas → Continue closes and adds the files
 *
 * ── What is real ─────────────────────────────────────────────────────────
 *
 * The whole path: `asset.upload_url` → PUT the bytes straight to storage →
 * `asset.ingest_url`, then `asset.folder.move` to drop each new asset into the
 * folder that was open, and `asset.caption.set` for a meta description the user
 * typed. That is `AssetUploadForm`'s exact sequence — the same call order, the
 * same `x-ms-blob-type` header Azure requires, the same idempotency key derived
 * from the storage key — reproduced here rather than imported because the form
 * owns a different shape (one file, a role picker, a rights checkbox) and this
 * panel is a multi-file flow with its own stages.
 *
 * The progress bar is real for the ingest half and honest about the rest: a
 * browser `fetch` PUT reports no progress events, so the bar shows the stage
 * (uploading → ingesting → done) rather than animating a percentage nobody
 * measured.
 *
 * ── Two fields the design does not draw, and why they are here anyway ────
 *
 * **Role.** `asset.ingest_url` requires one and retrieval is by role, so an
 * unroled asset is invisible to every playbook. Defaulting silently would make
 * every upload from this screen unusable.
 *
 * **Rights.** `retrieveAssets` filters `rightsStatus = 'cleared'`
 * (`packages/db/src/scoped.ts`), so an asset ingested as `pending` is invisible
 * to *this very screen* — the first upload I ran through this panel completed,
 * landed in the folder, and then did not appear in it. There is no tool that
 * clears rights afterwards, so the choice has to be made here or the file is
 * effectively lost. It is a claim about permission, so it is unchecked by
 * default and says what staying unchecked means.
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
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  /* `asset.upload_url` has always accepted `application/pdf` (the onboarding
     docs step needs it); what was missing was `asset.ingest_url`'s `document`
     media type, so a PDF could reach storage and never become an asset. */
  '.pdf': 'application/pdf',
};

/**
 * A PDF is filed as knowledge, not as footage.
 *
 * `asset.ingest_url` refuses a document in any other role — the composer pulls
 * a beat's asset in by role and renders anything that isn't audio as a picture,
 * so a PDF filed as `product_shot` would end up as a frame in a video. See that
 * tool's `DOCUMENT_ROLES` guard.
 */
const DOCUMENT_ROLES = ['knowledge', 'brand_kit'];

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function PdfGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size * 1.14} viewBox="0 0 14 16" fill="none" aria-hidden>
      <path
        d="M2.5 2.6A1.6 1.6 0 0 1 4.1 1h5l4 4v8.4a1.6 1.6 0 0 1-1.6 1.6h-7.4a1.6 1.6 0 0 1-1.6-1.6V2.6Z"
        stroke="#F35525"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M9.1 1v4h4" stroke="#F35525" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

interface Staged {
  id: string;
  file: File;
  name: string;
  meta: string;
  assetId: string | null;
  /** A local object URL, revoked on close. */
  preview: string;
  error: string | null;
}

type Stage = 'drop' | 'uploading' | 'done' | 'edit';

export function UploadFilesModal({
  genomeId,
  folder,
  onClose,
  onDone,
}: {
  genomeId: string;
  folder: Folder;
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const [stage, setStage] = useState<Stage>('drop');
  const [files, setFiles] = useState<Staged[]>([]);
  const [selected, setSelected] = useState(0);
  const [role, setRole] = useState<string>('product_screen');
  const [rightsCleared, setRightsCleared] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    files.forEach((f) => URL.revokeObjectURL(f.preview));
    onClose();
  }, [files, onClose]);

  async function uploadOne(file: File): Promise<Staged> {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    const contentType = CONTENT_TYPES[ext];
    const staged: Staged = {
      id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      name: file.name,
      meta: '',
      assetId: null,
      preview: URL.createObjectURL(file),
      error: null,
    };

    if (!contentType) {
      return { ...staged, error: `${ext || 'That file type'} is not one the Asset Graph accepts.` };
    }

    const presigned = await invoke<{ uploadUrl: string; readUrl: string; key: string }>('asset.upload_url', {
      genomeId,
      filename: file.name,
      contentType,
      sizeBytes: file.size,
    });
    if (presigned.status !== 'succeeded') {
      return { ...staged, error: presigned.status === 'failed' ? presigned.error.message : 'Upload was gated.' };
    }

    /* `x-ms-blob-type` is Azure's own requirement for a SAS upload, not a
       SparkSocial convention — omit it and a real PUT answers 400. */
    try {
      const put = await fetch(presigned.output.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': contentType, 'x-ms-blob-type': 'BlockBlob' },
        body: file,
      });
      if (!put.ok) return { ...staged, error: `Storage refused the file (${put.status}).` };
    } catch {
      return {
        ...staged,
        error:
          'The browser could not reach storage. Locally that is expected — the dev upload target does not resolve without AZURE_STORAGE_ACCOUNT.',
      };
    }

    const mediaType = contentType.startsWith('image/')
      ? 'image'
      : contentType.startsWith('video/')
        ? 'video'
        : contentType === 'application/pdf'
          ? 'document'
          : 'audio';
    /* The picker offers every role, and most files are media — a PDF picked
       while the role still reads `product_screen` is filed as knowledge rather
       than rejected after it has already uploaded. */
    const assetRole = mediaType === 'document' && !DOCUMENT_ROLES.includes(role) ? 'knowledge' : role;
    const ingested = await invoke<{ assetId: string; caption: string }>(
      'asset.ingest_url',
      {
        genomeId,
        url: presigned.output.readUrl,
        assetRole,
        mediaType,
        rightsStatus: rightsCleared ? 'cleared' : 'pending',
        source: 'assets_library_upload',
        filename: file.name,
        sizeBytes: file.size,
      },
      /* Not idempotent — a second call duplicates the asset — so the key is the
         storage key, which is already unique per file. */
      `asset-ingest:${presigned.output.key}`,
    );
    if (ingested.status !== 'succeeded') {
      return { ...staged, error: ingested.status === 'failed' ? ingested.error.message : 'Ingest was gated.' };
    }

    /* Into the folder that was open, which is the only reason this panel knows
       about a folder at all. */
    await invoke(
      'asset.folder.move',
      { genomeId, assetId: ingested.output.assetId, folderId: folder.folderId },
      `asset-move:${ingested.output.assetId}:${folder.folderId}`,
    );

    return { ...staged, assetId: ingested.output.assetId };
  }

  async function start(list: FileList | File[]) {
    const picked = Array.from(list).slice(0, 10);
    if (picked.length === 0) return;
    setStage('uploading');
    setNote(null);
    const results: Staged[] = [];
    for (const file of picked) {
      // eslint-disable-next-line no-await-in-loop -- one at a time: each is a
      // separate presign + PUT + ingest, and a burst of parallel PUTs is how a
      // storage account starts returning 503s.
      results.push(await uploadOne(file));
    }
    setFiles(results);
    setSelected(0);
    setStage('done');
    const failed = results.filter((r) => r.error);
    if (failed.length) setNote(failed[0]!.error);
  }

  async function continueFlow() {
    if (stage === 'uploading') {
      setNote('Wait for the upload to finish');
      return;
    }
    if (stage === 'done') {
      setStage('edit');
      return;
    }
    /* Stage 3: persist any meta description the user typed, then close. */
    setBusy(true);
    for (const f of files) {
      if (!f.assetId || !f.meta.trim()) continue;
      // eslint-disable-next-line no-await-in-loop -- same reason as above.
      await invoke(
        'asset.caption.set',
        { genomeId, assetId: f.assetId, caption: f.meta.trim() },
        `asset-caption:${f.assetId}`,
      );
    }
    setBusy(false);
    files.forEach((f) => URL.revokeObjectURL(f.preview));
    onDone(files.filter((f) => f.assetId).length);
  }

  const sel = files[selected];

  return (
    <ModalShell
      top={50}
      height={1020}
      width={800}
      radius={28}
      background="var(--ss-grad-lib-upload)"
      label="Upload files"
      onClose={close}
    >
      <div className="px-[32px] pt-[38px]">
        <p className="text-[23px] font-bold text-ink">Upload Files</p>
        <p className="mt-[14px] text-18 font-normal" style={{ color: '#5B5B5B' }}>
          Drag &amp; Drop to upload files instantly
        </p>
      </div>

      <div className="px-[30px] pt-[35px]">
        {/* 30,140 · 740x340 — the 35 above is what puts it there, given the
            title at 38 and the subtitle at 76. */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (stage === 'drop') void start(e.dataTransfer.files);
          }}
          disabled={stage !== 'drop'}
          className="flex h-[340px] w-full flex-col items-center justify-center gap-[12px] rounded-lg transition-colors hover:bg-white disabled:opacity-70"
          style={{ border: '1.6px dashed rgba(90,90,90,0.55)', background: 'rgba(255,255,255,0.92)' }}
        >
          <span
            className="flex h-[96px] w-[96px] items-center justify-center rounded-full bg-white"
            style={{ boxShadow: '0 8px 24px -12px rgba(12,12,12,0.25)' }}
          >
            <span className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-lib-upload-disc">
              <svg width="36" height="31" viewBox="0 0 21 18" fill="none" aria-hidden>
                <path d="M5.4 14.5H4.8A3.8 3.8 0 0 1 4 7a5.4 5.4 0 0 1 10.6-1.2A4.3 4.3 0 0 1 16 14.4h-.9" stroke="#0C0C0C" strokeWidth="1.4" strokeLinecap="round" />
                <path d="M10.5 16.6V9.2m0 0-2.7 2.7m2.7-2.7 2.7 2.7" stroke="#0C0C0C" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </span>

          <span className="mt-[6px] text-[19px] font-semibold text-ink">Drag &amp; Drop files here or</span>
          <span
            className="flex h-[46px] items-center rounded-[9px] bg-white px-[20px] text-16 font-medium"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.3)', color: '#3B3B3B' }}
          >
            Browse files
          </span>
          <span className="mt-[8px] text-15 font-medium" style={{ color: '#3B3B3B' }}>
            File formats: JPEG, PNG, WEBP, HEIC, MP4, MOV, WEBM, MP3, WAV, M4A, PDF
          </span>
          <span className="text-15 font-medium" style={{ color: '#3B3B3B' }}>
            Max Size: 500MB
          </span>
        </button>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={Object.keys(CONTENT_TYPES).join(',')}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void start(e.target.files);
          }}
        />

        {/*
          The role picker the design has no field for. Retrieval is by role, so
          an asset ingested without one is invisible to every playbook — see the
          note in this file's header.
        */}
        {stage === 'drop' ? (
          <div className="mt-[16px] flex flex-wrap items-center gap-x-[22px] gap-y-[10px]">
            <label className="flex items-center gap-[12px] text-15 font-medium text-ink">
              What is this?
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="h-[44px] rounded-[10px] bg-white px-[14px] text-15 font-medium text-ink outline-none"
                style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
              >
                {ASSET_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-[10px] text-15 font-medium text-ink">
              <input
                type="checkbox"
                checked={rightsCleared}
                onChange={(e) => setRightsCleared(e.target.checked)}
                className="h-[18px] w-[18px] accent-[#0C0C0C]"
              />
              I have the rights to use these
            </label>

            {!rightsCleared ? (
              <p className="w-full text-[13.5px] text-ink-muted">
                Retrieval only returns rights-cleared assets, so anything uploaded without this stays out of the
                library and out of every draft until it is cleared.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ── the staged rows ────────────────────────────────────────────── */}
      {stage === 'uploading' ? (
        <div className="mx-[30px] mt-[28px] h-[96px] rounded-[14px]" style={{ background: '#F2F2F4' }}>
          <div className="flex items-center gap-[14px] px-[16px] pt-[22px]">
            <FileGlyph />
            <div className="min-w-0 flex-1">
              <p className="truncate text-17 font-semibold text-ink">Uploading…</p>
              <div className="mt-[6px] flex items-center gap-[9px]">
                <span className="text-[14.5px] font-medium" style={{ color: '#5B5B5B' }}>
                  sending to storage
                </span>
                <span className="block h-[11px] w-[11px] rounded-full" style={{ background: '#A341FF' }} />
                <span className="text-[14.5px] font-medium" style={{ color: '#3B3B3B' }}>
                  Uploading
                </span>
              </div>
            </div>
          </div>
          {/*
            Indeterminate on purpose. `fetch` reports no progress for a PUT, so
            the design's 6% → 38% → 100% has nothing behind it; this animates
            the stage rather than a percentage nobody measured.
          */}
          <div className="mx-[16px] mt-[10px] h-[6px] overflow-hidden rounded-[6px]" style={{ background: '#0C0C0C' }}>
            <div className="h-full w-1/3 animate-shimmer rounded-[6px] bg-lib-progress motion-reduce:w-2/3" />
          </div>
        </div>
      ) : null}

      {stage === 'done' ? (
        <ul className="mx-[30px] mt-[28px] flex flex-col gap-[12px]">
          {files.map((f) => (
            <li key={f.id} className="relative h-[80px] rounded-[14px]" style={{ background: '#F2F2F4' }}>
              <div className="flex items-center gap-[14px] px-[16px] pt-[14px]">
                <FileGlyph />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-17 font-semibold text-ink">{f.name}</p>
                  <div className="mt-[4px] flex items-center gap-[9px]">
                    <span className="text-[14.5px] font-medium" style={{ color: '#5B5B5B' }}>
                      {formatBytes(f.file.size)}
                    </span>
                    {f.error ? (
                      <span className="truncate text-[14.5px] font-medium text-destructive" title={f.error}>
                        {f.error}
                      </span>
                    ) : (
                      <span
                        className="flex h-[17px] w-[17px] items-center justify-center rounded-full"
                        style={{ background: '#22B14C' }}
                      >
                        <svg width="9" height="8" viewBox="0 0 9 8" fill="none" aria-hidden>
                          <path d="m1 4 2.2 2.2L8 1" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSelected(files.indexOf(f));
                    setStage('edit');
                  }}
                  aria-label={`Edit ${f.name}`}
                  className="flex h-[44px] w-[44px] items-center justify-center rounded-[10px] bg-white transition-shadow hover:shadow-[inset_0_0_0_1.4px_#838383]"
                  style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
                >
                  <PencilGlyph color="#5B5B5B" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(f.preview);
                    const next = files.filter((x) => x.id !== f.id);
                    setFiles(next);
                    if (next.length === 0) setStage('drop');
                  }}
                  aria-label={`Remove ${f.name}`}
                  className="flex h-[44px] w-[44px] items-center justify-center rounded-[10px] bg-white transition-colors hover:bg-[rgba(243,85,37,0.06)]"
                  style={{ boxShadow: 'inset 0 0 0 1px rgba(243,85,37,0.55)' }}
                >
                  <TrashGlyph />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {/* ── edit metas ─────────────────────────────────────────────────── */}
      {stage === 'edit' && sel ? (
        <div className="flex gap-[30px] px-[30px] pt-[28px]">
          <ul className="flex w-[322px] shrink-0 flex-col gap-[12px]">
            {files.map((f, i) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => setSelected(i)}
                  className="relative h-[76px] w-full rounded-[14px] text-left transition-shadow hover:shadow-[inset_0_0_0_1.6px_#63DEF5]"
                  style={{
                    background: '#F2F2F4',
                    boxShadow: i === selected ? 'inset 0 0 0 1.8px #63DEF5' : 'none',
                  }}
                >
                  {/* A blob URL for a PDF paints nothing as a CSS background —
                      a page thumbnail needs a renderer this screen does not
                      have — so a document shows its glyph instead of a
                      convincingly blank white tile. */}
                  {isPdf(f.file) ? (
                    <span className="absolute left-[14px] top-[14px] flex h-[48px] w-[48px] items-center justify-center rounded-[9px] bg-white">
                      <PdfGlyph size={22} />
                    </span>
                  ) : (
                    <span
                      className="absolute left-[14px] top-[14px] block h-[48px] w-[48px] rounded-[9px] bg-white bg-cover bg-center"
                      style={{ backgroundImage: `url(${f.preview})` }}
                    />
                  )}
                  <span className="absolute left-[74px] right-[40px] top-[14px] truncate text-[15.5px] font-semibold text-ink">
                    {f.name}
                  </span>
                  <span className="absolute left-[74px] top-[41px] flex items-center gap-[8px]">
                    <span className="text-[13.5px] font-medium" style={{ color: '#5B5B5B' }}>
                      {formatBytes(f.file.size)}
                    </span>
                    {f.assetId ? (
                      <span className="flex h-[15px] w-[15px] items-center justify-center rounded-full" style={{ background: '#22B14C' }}>
                        <svg width="8" height="7" viewBox="0 0 9 8" fill="none" aria-hidden>
                          <path d="m1 4 2.2 2.2L8 1" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    ) : null}
                  </span>
                  <span className="absolute right-[16px] top-[30px]">
                    <PencilGlyph color={i === selected ? '#0C0C0C' : '#838383'} size={15} />
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="min-w-0 flex-1">
            <div className="relative h-[200px] w-full overflow-hidden rounded-[14px]" style={{ background: '#F2F2F4' }}>
              {isPdf(sel.file) ? (
                <span className="absolute inset-[12px] flex flex-col items-center justify-center gap-[10px] rounded-[10px] bg-white">
                  <PdfGlyph size={40} />
                  <span className="max-w-[80%] truncate text-[13.5px] font-medium" style={{ color: '#5B5B5B' }}>
                    {sel.name}
                  </span>
                </span>
              ) : (
                <span
                  className="absolute inset-[12px] rounded-[10px] bg-white bg-contain bg-center bg-no-repeat"
                  style={{ backgroundImage: `url(${sel.preview})` }}
                />
              )}
              <span
                className="absolute left-[22px] top-[22px] flex h-[28px] items-center rounded-[7px] px-[10px] text-[12.5px] font-semibold text-white"
                style={{ background: 'rgba(12,12,12,0.75)' }}
              >
                {formatBytes(sel.file.size)}
              </span>
            </div>

            <label className="mt-[18px] block text-[15.5px] font-semibold text-ink" htmlFor="lib-upload-name">
              File Name
            </label>
            <input
              id="lib-upload-name"
              value={sel.name}
              onChange={(e) =>
                setFiles((prev) => prev.map((f, i) => (i === selected ? { ...f, name: e.target.value } : f)))
              }
              className="mt-[8px] h-[54px] w-full rounded-xl bg-white px-[18px] text-[15.5px] font-medium text-ink outline-none"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.28)' }}
            />

            <label className="mt-[18px] block text-[15.5px] font-semibold text-ink" htmlFor="lib-upload-meta">
              Meta Description
            </label>
            <input
              id="lib-upload-meta"
              value={sel.meta}
              onChange={(e) =>
                setFiles((prev) => prev.map((f, i) => (i === selected ? { ...f, meta: e.target.value } : f)))
              }
              placeholder="Enter text"
              className="mt-[8px] h-[54px] w-full rounded-xl bg-white px-[18px] text-[15.5px] font-medium text-ink outline-none placeholder:text-[#B0B0B0]"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.28)' }}
            />
            <p className="mt-[8px] text-[13.5px] text-ink-muted">
              This becomes the asset&rsquo;s caption, which is what retrieval searches — leave it blank and SPARK
              keeps the one it wrote itself.
            </p>
          </div>
        </div>
      ) : null}

      {note ? <p className="px-[30px] pt-[18px] text-15 text-ink-muted">{note}</p> : null}

      {/* ── footer ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-[22px] px-[30px] pb-[44px] pt-[30px]">
        <button
          type="button"
          onClick={close}
          className="flex h-[54px] items-center rounded-xl bg-white px-[34px] text-17 font-medium transition-shadow"
          style={{ boxShadow: '0 10px 26px -16px rgba(12,12,12,0.4), inset 0 0 0 1px rgba(131,131,131,0.15)', color: '#5B5B5B' }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void continueFlow()}
          disabled={busy}
          style={{
            opacity: stage === 'done' || stage === 'edit' ? 1 : 0.5,
            boxShadow: '0 10px 26px -16px rgba(12,12,12,0.4), inset 0 0 0 1px rgba(131,131,131,0.15)',
          }}
          className="flex h-[54px] items-center gap-[18px] rounded-xl bg-white px-[26px] transition-opacity duration-200 active:scale-[0.985] motion-reduce:transition-none"
        >
          <span className="text-17 font-semibold text-ink">{busy ? 'Saving…' : 'Continue'}</span>
          <svg width="9" height="16" viewBox="0 0 8 16" fill="none" aria-hidden>
            <path d="m1 1 6 7-6 7" stroke="#0C0C0C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </ModalShell>
  );
}

function FileGlyph() {
  return (
    <span className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[9px] bg-white">
      <svg width="18" height="22" viewBox="0 0 16 20" fill="none" aria-hidden>
        <path d="M1.5 3A2 2 0 0 1 3.5 1h6l5 5v11a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V3Z" stroke="#5B5B5B" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M9.5 1v5h5" stroke="#5B5B5B" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function PencilGlyph({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="m12.4 4.2 3.4 3.4M2.2 17.8l.7-3.3a2 2 0 0 1 .54-1L11.2 5.7a1.7 1.7 0 0 1 2.4 0l1.4 1.4a1.7 1.7 0 0 1 0 2.4l-7.8 7.8a2 2 0 0 1-1 .54l-3.3.7-.7-.74Z"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden>
      <path
        d="M1 3.8h12M5 3.5V2.2C5 1.5 5.5 1 6.2 1h1.6c.7 0 1.2.5 1.2 1.2v1.3M2.6 3.8l.7 9.7c.05.8.7 1.4 1.5 1.4h4.4c.8 0 1.45-.6 1.5-1.4l.7-9.7"
        stroke="#F35525"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5.6 6.8v4.6M8.4 6.8v4.6" stroke="#F35525" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
