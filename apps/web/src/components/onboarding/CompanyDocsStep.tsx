'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/tools';

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
  const input = useRef<HTMLInputElement>(null);
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

    try {
      // `x-ms-blob-type` is Azure's requirement for a SAS upload — the same
      // header the logo and asset uploads send, and omitting it 400s.
      const put = await fetch(presigned.output.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': ACCEPT, 'x-ms-blob-type': 'BlockBlob' },
        body: file,
      });
      if (!put.ok) throw new Error(`Storage rejected the upload (${put.status}).`);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'The upload could not reach storage.');
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

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="rounded-xl border border-dashed border-border p-6 text-center">
        <p className="text-[15px] font-medium text-ink">Drop a PDF here, or browse</p>
        <p className="mt-1 text-[13px] text-ink-muted">
          A brand guideline, a price list, an FAQ. Up to {MAX_MB}MB, text PDFs — a scan has no words in it
          to read.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? 'Reading it…' : 'Browse files'}
        </Button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Cleared so the same file can be re-picked after a failure —
            // otherwise `change` never fires again and the control looks dead.
            e.target.value = '';
            if (file) void upload(file);
          }}
        />
      </div>

      {attached.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {attached.map((doc) => (
            <li
              key={doc.filename}
              className="flex flex-wrap items-baseline justify-between gap-3 rounded-lg border border-border p-3"
            >
              <span className="text-[14px] font-medium text-ink">{doc.filename}</span>
              {/* What was actually read, not "uploaded". The number of chunks is
                  the number of things retrieval can now find. */}
              <span className="text-[12.5px] text-ink-muted">
                {doc.pages} page{doc.pages === 1 ? '' : 's'} · {doc.characters.toLocaleString('en-US')}{' '}
                characters read · {doc.chunks} passage{doc.chunks === 1 ? '' : 's'} SPARK can quote
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="text-[13px] text-warn">{error}</p> : null}

      <a
        href="/brand-guideline-sample.pdf"
        download
        className="self-start text-[14px] font-medium text-brand-purple underline underline-offset-2"
      >
        Download a sample guideline
      </a>
    </div>
  );
}
