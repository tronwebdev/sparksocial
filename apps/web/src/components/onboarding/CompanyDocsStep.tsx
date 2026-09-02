'use client';

import { useState } from 'react';
import { invoke } from '@/lib/tools';
import { DropZone, PreviewTile } from './kit';
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
/**
 * `asset.upload_url` bounds `sizeBytes` at `512 * 1024 * 1024`, and the
 * prototype's four drop zones all read "up to 500MB". I had this at 25MB with a
 * comment claiming it matched a reader-side cap; there is no such cap, so the
 * number was mine and it was rejecting files the backend would have taken.
 */
const MAX_MB = 500;

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
    The notch card on `SparkSocial Onboarding.dc.html`, at its own numbers. The
    card is 581x309.5 at (576,174) and the form lives *inside* it, so every value
    below is card-relative from the drop zone's own origin at (66,69):

      drop zone      0,0     340x160, radius 12.76
      File Preview   380,4   14px #838383  (the tile draws its own label)
      preview tile   360,28.2
      sample link    5,194   17x20 glyph, 18px/500 #838383, gap 10

    What was wrong before: I had wrapped this in an `#F3F4F8` `UploadSection`,
    which is the treatment the *logo* and *avatar* zones get because they sit on
    the grey background. This one sits on the white card, and the prototype gives
    it no fill and a 1.26px ring instead - a white box on a white card is not a
    box at all. Same reason the glyph here is the file-with-fold rather than the
    image glyph the other three use.
  */
  return (
    <ProtoScale native={515}>
      <div style={{ position: 'relative', width: 515, height: 218 }}>
        <DropZone
          left={0}
          top={0}
          outlined
          glyph="document"
          accept={ACCEPT}
          formats={`PDF, Docs up to ${MAX_MB}MB`}
          busy={busy}
          onFile={(f) => void upload(f)}
        />

        <PreviewTile
          left={360}
          top={28.2}
          label="File Preview"
          onClear={latest ? () => setAttached((prev) => prev.slice(0, -1)) : undefined}
        >
          {latest ? (
            <>
              <span
                style={{
                  position: 'absolute',
                  left: 38,
                  top: 36.8,
                  display: 'flex',
                  width: 54,
                  height: 54,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                  background: 'rgba(240,28,28,0.08)',
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#F01C1C',
                }}
              >
                PDF
              </span>
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 119.2,
                  width: '100%',
                  textAlign: 'center',
                  padding: '0 6px',
                  fontSize: 10.6,
                  color: '#838383',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {latest.filename}
              </span>
            </>
          ) : null}
        </PreviewTile>

        <a
          href="/brand-guideline-sample.pdf"
          download
          style={{
            position: 'absolute',
            left: 5,
            top: 194,
            height: 24,
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            fontSize: 18,
            fontWeight: 500,
            lineHeight: 1.33,
            color: '#838383',
            textDecoration: 'none',
          }}
        >
          <svg width="17" height="20" viewBox="0 0 17 20" fill="none" aria-hidden style={{ display: 'block' }}>
            <path d="M8.5 1v12m0 0L4 8.6m4.5 4.4L13 8.6" stroke="#000000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M1.5 15.5v1.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.5" stroke="#000000" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Download sample pdf guideline
        </a>
      </div>

      {/*
        Both hang below the 309.5 card rather than inside it. The read result is
        not in the prototype and is kept: a scanned PDF with no text layer
        attaches successfully and yields nothing, which is the one outcome the
        owner must not discover a week later.
      */}
      {error ? (
        <p role="alert" style={{ marginTop: 14, fontSize: 16, color: '#F01C1C' }}>
          {error}
        </p>
      ) : null}
      {latest ? (
        <p style={{ marginTop: 14, fontSize: 16, color: '#838383' }}>
          Read {latest.pages} page{latest.pages === 1 ? '' : 's'} — {latest.chunks} passage
          {latest.chunks === 1 ? '' : 's'} SPARK can quote from.
        </p>
      ) : null}
    </ProtoScale>
  );
}
