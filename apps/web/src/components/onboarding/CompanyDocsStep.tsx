'use client';

import { useState } from 'react';
import { invoke } from '@/lib/tools';
import { DropZone, PreviewPanel } from './kit';
import { uploadToStorage } from '@/lib/uploadToStorage';

/**
 * `F6` — "Upload company Docs (PDF)", with the sample guideline beside it.
 *
 * The prototype's tooltip says why it exists: *"Spark reads these documents to
 * learn your brand voice, offering and facts."* Until `brand.knowledge.attach_-
 * document` there was no way for a PDF to become anything the agent could read —
 * `brand.knowledge.attach` took text only — so this step had no writer and was
 * left out of onboarding entirely.
 *
 * ── Two steps, both real ──────────────────────────────────────────────────
 *
 * The file goes to blob storage through `asset.upload_url`, exactly as the logo
 * does, and then its URL goes to the tool, which fetches it, extracts the text
 * and splits it into retrievable chunks. Posting the bytes through a tool call
 * would put a multi-megabyte body on the audit path — every call is recorded in
 * `tool_calls`.
 *
 * ── The sample is a real PDF, and it is the shape of the answer ───────────
 *
 * The prototype offers "Download sample pdf guideline" and the temptation is a
 * pretty template. What ships is six headings and a sentence under each, because
 * the useful thing about the sample is that it shows how *short* a usable
 * guideline is — the failure mode here is somebody deciding they need to write a
 * brand book before they can finish setup.
 *
 * Skippable, like every other optional step. A brand with no documents is the
 * common case for the businesses this product is for.
 */

const ACCEPT = 'application/pdf';
/** Matches `document-reader.ts`'s own cap, stated here rather than discovered on upload. */
const MAX_MB = 25;

interface Attached {
  filename: string;
  pages: number;
  chunks: number;
  characters: number;
}

export function CompanyDocsStep({ genomeId }: { genomeId: string }) {
  const [busy, setBusy] = useState(false);
  const [attached, setAttached] = useState<Attached[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);

    if (file.type !== ACCEPT) {
      setError('PDF only. A Word file needs exporting to PDF first.');
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`That file is larger than ${MAX_MB}MB.`);
      return;
    }

    setBusy(true);

    const presigned = await invoke<{ uploadUrl: string; readUrl: string }>('asset.upload_url', {
      genomeId,
      filename: file.name,
      contentType: ACCEPT,
      sizeBytes: file.size,
    });
    if (presigned.status !== 'succeeded') {
      setBusy(false);
      setError(presigned.status === 'failed' ? presigned.error.message : 'That upload was gated.');
      return;
    }

    const put = await uploadToStorage(presigned.output.uploadUrl, file, ACCEPT);
    if (!put.ok) {
      setBusy(false);
      setError(put.message);
      return;
    }

    /**
     * Fresh rather than keyed on the filename: re-uploading a corrected version of
     * `handbook.pdf` must read the new file, and a stable key would replay the
     * first read's result instead. The key exists to make a *retry* safe, not to
     * deduplicate filenames.
     */
    const read = await invoke<Attached & { docId: string }>(
      'brand.knowledge.attach_document',
      { genomeId, url: presigned.output.readUrl, filename: file.name },
      crypto.randomUUID(),
    );
    setBusy(false);

    if (read.status !== 'succeeded') {
      // The tool's own message is the useful one here — "that PDF has no text in
      // it, it is probably a scan" is a different instruction from a failure.
      setError(read.status === 'failed' ? read.error.message : 'Reading that document was gated.');
      return;
    }

    setAttached((prev) => [
      ...prev,
      {
        filename: file.name,
        pages: read.output.pages,
        chunks: read.output.chunks,
        characters: read.output.characters,
      },
    ]);
  }

  const latest = attached[attached.length - 1];

  /*
    `…193059`: the drop zone and a File Preview panel side by side, then
    "Download sample pdf guideline" underneath. The upload logic above is
    untouched — this is the same three tool calls in the capture's layout.
  */
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <DropZone
          className="flex-1"
          accept={ACCEPT}
          formats={`PDF, Docs up to ${MAX_MB}MB`}
          busy={busy}
          onFile={(f) => void upload(f)}
        />

        <PreviewPanel
          label="File Preview"
          onClear={latest ? () => setAttached((prev) => prev.slice(0, -1)) : undefined}
        >
          {latest ? (
            <span className="flex flex-col items-center gap-1 px-1">
              <span className="flex h-9 w-7 items-center justify-center rounded-[4px] bg-destructive/10 text-[9px] font-semibold text-destructive">
                PDF
              </span>
              <span className="max-w-[92px] truncate text-[10px] text-ink-muted">{latest.filename}</span>
            </span>
          ) : null}
        </PreviewPanel>
      </div>

      {error ? (
        <p role="alert" className="text-13 text-destructive">
          {error}
        </p>
      ) : null}

      {/*
        What the read actually produced. Not in the capture, and kept because a
        PDF that attached with zero pages is the one outcome the user must not
        discover a week later — a scan with no text layer reads as success
        otherwise.
      */}
      {latest ? (
        <p className="text-13 text-ink-muted">
          Read {latest.pages} page{latest.pages === 1 ? '' : 's'} — {latest.chunks} passage
          {latest.chunks === 1 ? '' : 's'} SPARK can quote from.
        </p>
      ) : null}

      <a
        href="/brand-guideline-sample.pdf"
        download
        className="flex items-center gap-1.5 self-start text-13 text-ink underline"
      >
        <svg width="12" height="13" viewBox="0 0 12 13" fill="none" aria-hidden>
          <path d="M6 1v8m0 0L3 6m3 3 3-3M1 11.5h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Download sample pdf guideline
      </a>
    </div>
  );
}
