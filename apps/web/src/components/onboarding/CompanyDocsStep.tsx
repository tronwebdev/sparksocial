'use client';

import { useState } from 'react';
import { invoke } from '@/lib/tools';
import { DropZone, PreviewTile, UploadSection } from './kit';
import { ProtoScale } from './Stage';
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
    `…193059` at the prototype's own numbers: a 547-wide `#F3F4F8` section
    holding a 340x160 white drop zone and a 129.7 File Preview tile, with the
    sample-guideline link beneath. Rendered inside `ProtoScale`, so every value
    here is native 1728-canvas px.
  */
  return (
    <ProtoScale native={547}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, width: 547 }}>
        <UploadSection width={547} height={263}>
          <div style={{ position: 'relative', height: 263 }}>
            <DropZone
              left={20}
              top={86}
              accept={ACCEPT}
              formats={`PDF, Docs up to ${MAX_MB}MB`}
              busy={busy}
              onFile={(f) => void upload(f)}
            />
            <div>
              <PreviewTile
                left={385}
                top={114.2}
                label="File Preview"
                onClear={latest ? () => setAttached((prev) => prev.slice(0, -1)) : undefined}
              >
                {latest ? (
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: 8 }}>
                    <span style={{ display: 'flex', width: 46, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: 'rgba(240,28,28,0.08)', fontSize: 13, fontWeight: 600, color: '#F01C1C' }}>
                      PDF
                    </span>
                    <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: '#838383' }}>
                      {latest.filename}
                    </span>
                  </span>
                ) : null}
              </PreviewTile>
            </div>
          </div>
        </UploadSection>

        {error ? (
          <p role="alert" style={{ fontSize: 16, color: '#F01C1C' }}>
            {error}
          </p>
        ) : null}

        {/*
          What the read produced. Not in the prototype, and kept: a scanned PDF
          with no text layer attaches successfully and yields nothing, which is
          the one outcome the owner must not find out about a week later.
        */}
        {latest ? (
          <p style={{ fontSize: 16, color: '#838383' }}>
            Read {latest.pages} page{latest.pages === 1 ? '' : 's'} — {latest.chunks} passage
            {latest.chunks === 1 ? '' : 's'} SPARK can quote from.
          </p>
        ) : null}

        <a
          href="/brand-guideline-sample.pdf"
          download
          style={{ display: 'flex', alignItems: 'center', gap: 7, alignSelf: 'flex-start', fontSize: 16, fontWeight: 500, color: '#0C0C0C', textDecoration: 'underline' }}
        >
          <svg width="15" height="16" viewBox="0 0 15 16" fill="none" aria-hidden>
            <path d="M7.5 1v9m0 0L4 6.5m3.5 3.5L11 6.5M1 14h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Download sample pdf guideline
        </a>
      </div>
    </ProtoScale>
  );
}
