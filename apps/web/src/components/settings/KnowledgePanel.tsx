'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { uploadToStorage, type PresignedUpload } from '@/lib/uploadToStorage';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { cn } from '@/lib/utils';
import { userMessage } from '@/lib/errorCopy';
import { notify, notifyResult } from '@/lib/notify';
import { Busy } from '@/components/brand/SparkLoader';

/**
 * `ONB-02` / §8.12 — what this brand knows, and the way in.
 *
 * ── Why this was the most consequential gap on the list ───────────────────
 *
 * `knowledge.ingest_site`, `knowledge.ingest_docs` and `brand.knowledge.attach`
 * were all real, tested and callable, and no screen called any of them. That did
 * not present as a missing feature; it presented as the *guardrail being wrong*.
 * `guard.claim_grounding` fails a draft by consulting exactly this corpus, so a
 * brand with nothing attached has every specific claim it makes flagged as
 * ungrounded — and had no way to feed the check it was failing. The guardrail
 * was working correctly the whole time.
 *
 * ── Three tools, two ways in, and one honest limit ────────────────────────
 *
 * Crawling a site and pasting documents are genuinely different actions with
 * different costs (a crawl is ~1¢ a page and takes real seconds; a paste is a
 * single embedding), so they are two controls rather than one clever one.
 *
 * The limit worth stating: **all three tools take text, not files.** A `.txt` or
 * `.md` file can be read in the browser and its contents pasted into the same
 * field a human would have typed into, which is what the file picker here does.
 * A PDF or a `.docx` cannot, without shipping a parser to do it — so those are
 * refused by name rather than accepted and silently mangled into whatever bytes
 * `FileReader` produces for a zip container.
 *
 * ── Why the claim tester is on this screen ───────────────────────────────
 *
 * `knowledge.ground_claim` runs the same check as the publish-time guardrail. It
 * belongs here because it is the only thing that makes the corpus *legible*: a
 * list of five documents tells you nothing about whether the sentence you want
 * to write will pass. Attaching a policy and then watching a claim go from
 * ungrounded to grounded is the feedback loop this feature actually needs.
 */

interface KnowledgeDoc {
  docId: string;
  chunks: number;
  chars: number;
  citationLabel?: string;
  attachedAt: string;
  preview: string;
}

interface KnowledgeList {
  genomeId: string;
  docs: KnowledgeDoc[];
  totalChunks: number;
  totalChars: number;
}

/** What `FileReader.readAsText` produces something useful for. Everything else needs a parser. */
const READABLE_EXTENSIONS = ['.txt', '.md', '.markdown', '.csv', '.json'];
const ACCEPT = READABLE_EXTENSIONS.join(',');

/** `brand.knowledge.attach`'s own ceiling, enforced here so a paste fails before the round trip. */
const MAX_DOC_CHARS = 20_000;

/** Matches the onboarding step's own cap, and sits well inside `asset.upload_url`'s 512MB. */
const PDF_MAX_MB = 20;

export function KnowledgePanel() {
  const { genome } = useSelectedGenome();
  const genomeId = genome?.genomeId;

  const [list, setList] = useState<KnowledgeList | null>(null);
  /* The list failing to load. What a crawl, attach, upload or check came to is a notification. */
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'crawl' | 'attach' | 'check' | null>(null);

  const [siteUrl, setSiteUrl] = useState('');
  const [maxPages, setMaxPages] = useState(5);

  const [docId, setDocId] = useState('');
  const [docText, setDocText] = useState('');

  const [claim, setClaim] = useState('');
  const [claimResult, setClaimResult] = useState<{ grounded: boolean; fixAction?: string } | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const [busyDoc, setBusyDoc] = useState(false);

  const load = useCallback(async () => {
    if (!genomeId) return;
    const res = await invoke<KnowledgeList>('knowledge.list', { genomeId });
    if (res.status === 'succeeded') {
      setList(res.output);
      setError(null);
    } else {
      setError(res.status === 'failed' ? userMessage(res.error) : 'Knowledge is not visible to this role.');
    }
  }, [genomeId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function crawl() {
    if (!genomeId || !siteUrl.trim()) return;
    setBusy('crawl');
    /**
      * Fresh rather than keyed on the URL: a site is re-crawled precisely because
      * it changed, and a stable key would return the previous crawl forever.
      */
    const res = await invoke<{ attached: { docId: string }[]; failure?: string }>(
      'knowledge.ingest_site',
      { genomeId, url: siteUrl.trim(), maxPages },
      crypto.randomUUID(),
    );
    setBusy(null);
    if (!notifyResult(res, undefined, 'Couldn’t read that site')) return;
    // The tool reports a `failure` rather than throwing when a crawl reaches a
    // real site and finds nothing worth attaching. Surfaced as-is: "0 pages
    // attached" with no reason is the kind of result people retry three times.
    if (res.output.failure) notify.warning('Nothing attached from that site', { body: res.output.failure });
    else notify.success(`Attached ${res.output.attached.length} page${res.output.attached.length === 1 ? '' : 's'}`);
    setSiteUrl('');
    await load();
  }

  async function attachDoc() {
    if (!genomeId || !docId.trim() || !docText.trim()) return;
    if (docText.length > MAX_DOC_CHARS) {
      notify.warning('That document is too long', {
        body: `That is ${docText.length.toLocaleString()} characters; the limit is ${MAX_DOC_CHARS.toLocaleString()}. Split it into sections.`,
      });
      return;
    }
    setBusy('attach');
    // Fresh rather than keyed on `docId`, so editing a document's text and
     // re-attaching it under the same id saves the edit instead of replaying the
     // first version.
    const res = await invoke<{ docId: string }>(
      'brand.knowledge.attach',
      { genomeId, docId: docId.trim(), text: docText, citationLabel: docId.trim() },
      crypto.randomUUID(),
    );
    setBusy(null);
    if (!notifyResult(res, undefined, 'Couldn’t attach that document')) return;
    notify.success(`Attached “${res.output.docId}”`);
    setDocId('');
    setDocText('');
    await load();
  }

  /**
   * The PDF path — `3.3`'s "brand-guideline upload", which onboarding has had
   * since `2.5b` and settings did not.
   *
   * Different from `readFile` below in a way worth stating: a text file is read
   * *in the browser* and shown to the person before anything is attached, so they
   * review exactly what SPARK will see. A PDF cannot be read client-side without
   * a parser, so it is uploaded and `brand.knowledge.attach_document` extracts
   * the text server-side — which means the review happens *after* the upload
   * rather than before it. That is a real asymmetry, not an oversight, and it is
   * why this reports what the tool extracted rather than claiming success.
   */
  async function uploadDocument(file: File) {
    if (!genome || busyDoc) return;
    if (file.size > PDF_MAX_MB * 1024 * 1024) {
      notify.warning(`That file is larger than ${PDF_MAX_MB}MB`);
      return;
    }
    setBusyDoc(true);

    const presigned = await invoke<PresignedUpload>('asset.upload_url', {
      genomeId: genome.genomeId,
      filename: file.name,
      contentType: 'application/pdf',
      sizeBytes: file.size,
    });
    if (!notifyResult(presigned, undefined, 'Couldn’t upload that PDF')) {
      setBusyDoc(false);
      return;
    }

    const put = await uploadToStorage(presigned.output.uploadUrl, file, 'application/pdf', presigned.output.headers);
    if (!put.ok) {
      setBusyDoc(false);
      notify.error('Couldn’t upload that PDF', { body: put.message });
      return;
    }

    const read = await invoke<{ docId: string; chunks?: number }>(
      'brand.knowledge.attach_document',
      { genomeId: genome.genomeId, url: presigned.output.readUrl, filename: file.name },
      crypto.randomUUID(),
    );
    setBusyDoc(false);

    // The tool's own wording is the useful one — "that PDF has no text in it,
    // it is probably a scan" is an instruction, not a failure — and it becomes
    // the notification's detail line.
    if (!notifyResult(read, undefined, 'Couldn’t read that document')) return;
    notify.success(`Read “${file.name}”`, { body: `Attached as ${read.output.docId}.` });
    await load();
  }

  /**
   * Reads the file in the browser and drops its text into the same field a human
   * would have typed into — so the review step before attaching is identical
   * either way, and nothing is uploaded that the person has not seen.
   */
  function readFile(file: File) {
    const lower = file.name.toLowerCase();
    if (!READABLE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      notify.warning(`${file.name} can’t be read here`, {
        body: 'It needs a parser SPARK does not have. Plain text, Markdown, CSV or JSON — or paste the text in directly.',
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setDocText(text.slice(0, MAX_DOC_CHARS));
      // A filename is a better default id than an empty box, and the person can
      // still change it before attaching.
      if (!docId.trim()) setDocId(file.name.replace(/\.[^.]+$/, ''));
      if (text.length > MAX_DOC_CHARS) {
        notify.warning(`Only the first part of ${file.name} was loaded`, {
          body: `It is longer than ${MAX_DOC_CHARS.toLocaleString()} characters. Check it before attaching.`,
        });
      } else {
        notify.success(`Loaded ${file.name}`, { body: 'Review it, then attach.' });
      }
    };
    reader.onerror = () => notify.error(`Couldn’t read ${file.name}`);
    reader.readAsText(file);
  }

  async function checkClaim() {
    if (!genomeId || !claim.trim()) return;
    setBusy('check');
    setClaimResult(null);
    const res = await invoke<{ grounded: boolean; ungroundedClaims: string[]; fixAction?: string }>(
      'knowledge.ground_claim',
      { genomeId, claim: claim.trim() },
    );
    setBusy(null);
    if (!notifyResult(res, undefined, 'Couldn’t check that claim')) return;
    setClaimResult({ grounded: res.output.grounded, ...(res.output.fixAction ? { fixAction: res.output.fixAction } : {}) });
  }

  if (!genomeId) return null;

  return (
    <section className="rounded-[16px] shadow-[inset_0_0_0_1px_rgba(131,131,131,0.22)] bg-white p-6 max-sm:p-4">
      <h2 className="text-18 font-semibold text-ink">What this brand knows</h2>
      <p className="mt-1 max-w-prose text-14 text-ink-muted">
        Policies, FAQs, spec sheets, pages from your site. SPARK checks every specific claim it writes against
        this material before publishing — so anything you cannot back up here gets flagged rather than posted.
      </p>

      {error ? <p className="mt-3 text-13 text-destructive">{error}</p> : null}

      {/* ── What is attached. First, because it is the answer to "did that work?" ── */}
      <div className="mt-5">
        {list === null && !error ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : list && list.docs.length === 0 ? (
          <div className="rounded-lg border border-warn/40 bg-warn/10 p-3">
            <p className="text-13 font-medium text-ink">Nothing attached yet</p>
            <p className="mt-1 text-13 text-ink-muted">
              Until something is, every specific claim SPARK writes — a price, a turnaround time, a guarantee —
              will be held rather than published. The fastest fix is to point it at your own site below.
            </p>
          </div>
        ) : list ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-13 font-medium text-ink-muted">
                {list.docs.length} document{list.docs.length === 1 ? '' : 's'}
              </p>
              <p className="text-12 tabular-nums text-ink-muted">
                {list.totalChars.toLocaleString()} characters · {list.totalChunks} embedded chunk
                {list.totalChunks === 1 ? '' : 's'}
              </p>
            </div>
            <ul className="mt-2 grid grid-cols-1 gap-2">
              {list.docs.map((d) => (
                <li key={d.docId} className="rounded-[12px] shadow-[inset_0_0_0_1px_rgba(131,131,131,0.22)] p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    {/*
                      `docId` is a URL for a crawled source, and a URL has no
                      spaces to wrap at: measured on the deployed
                      `/settings/brand-kits` at 430px it was the one element
                      past the viewport, ending at 462. `break-all` is the only
                      thing that breaks an unbroken token, and `min-w-0` is what
                      allows a flex item to be narrower than its own content.
                    */}
                    <p className="min-w-0 break-all font-mono text-12 text-ink">{d.docId}</p>
                    <div className="flex shrink-0 items-center gap-2">
                      {d.chunks > 1 ? <Badge variant="neutral">{d.chunks} chunks</Badge> : null}
                      <span className="text-12 tabular-nums text-ink-muted">
                        {d.chars.toLocaleString()} chars
                      </span>
                      <span className="text-12 text-ink-muted">
                        {new Date(d.attachedAt).toLocaleDateString('en', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                  </div>
                  {d.citationLabel && d.citationLabel !== d.docId ? (
                    <p className="mt-0.5 text-12 text-ink-muted">{d.citationLabel}</p>
                  ) : null}
                  <p className="mt-1 line-clamp-2 text-12 text-ink-muted">{d.preview}</p>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      {/* ── The two ways in ─────────────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-[12px] shadow-[inset_0_0_0_1px_rgba(131,131,131,0.22)] p-4">
          <p className="text-13 font-medium text-ink">Read my website</p>
          <p className="mt-1 text-12 text-ink-muted">
            SPARK opens each page and reads it. Roughly a cent a page, and it takes a few seconds per page —
            leave this open while it runs.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1 max-cq-canvas:min-w-0 max-cq-canvas:basis-full">
              <label className="block text-12 text-ink-muted" htmlFor="kn-url">
                Address
              </label>
              <Input
                id="kn-url"
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                placeholder="https://example.com/about"
                className="mt-1"
              />
            </div>
            <div className="w-24">
              <label className="block text-12 text-ink-muted" htmlFor="kn-pages">
                Pages
              </label>
              <Input
                id="kn-pages"
                type="number"
                min={1}
                max={20}
                value={maxPages}
                onChange={(e) => setMaxPages(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
                className="mt-1"
              />
            </div>
            <Button disabled={busy !== null || !siteUrl.trim()} onClick={() => void crawl()}>
              {busy === 'crawl' ? <Busy>Reading…</Busy> : 'Read'}
            </Button>
          </div>
        </div>

        <div className="rounded-[12px] shadow-[inset_0_0_0_1px_rgba(131,131,131,0.22)] p-4">
          <p className="text-13 font-medium text-ink">Add a document</p>
          {/*
            This said "PDFs and Word documents need a parser SPARK does not
            have — open them and paste instead", directly above an "Upload a
            PDF" button. Both halves were stale in opposite directions:
            `brand.knowledge.attach_document` has parsed PDFs since it landed,
            and the button beside this text calls it. Word is still true.
          */}
          <p className="mt-1 text-12 text-ink-muted">
            Paste the text, or load a plain-text, Markdown, CSV or JSON file. PDFs upload and are read for
            you. Word documents need a parser SPARK does not have — export to PDF, or paste the text.
          </p>

          <label className="mt-3 block text-12 text-ink-muted" htmlFor="kn-docid">
            What is it called
          </label>
          <Input
            id="kn-docid"
            value={docId}
            onChange={(e) => setDocId(e.target.value)}
            placeholder="Returns policy"
            className="mt-1"
          />

          <label className="mt-3 block text-12 text-ink-muted" htmlFor="kn-text">
            The text
          </label>
          <textarea
            id="kn-text"
            value={docText}
            onChange={(e) => setDocText(e.target.value)}
            rows={5}
            className="mt-1 w-full rounded-[12px] shadow-[inset_0_0_0_1px_rgba(131,131,131,0.22)] bg-white px-3 py-2 text-13 text-ink"
            placeholder="Paste the policy, FAQ or spec sheet here."
          />
          <p className="mt-1 text-11 tabular-nums text-ink-muted">
            {docText.length.toLocaleString()} / {MAX_DOC_CHARS.toLocaleString()} characters
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readFile(file);
                // Cleared so choosing the same file twice fires `change` again.
                e.target.value = '';
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
              Load a file
            </Button>
            {/*
              The PDF route, separate from "Load a file" on purpose. A text file
              is read here and shown to you before anything is attached; a PDF has
              to be uploaded first so the server can extract its text. Two
              buttons, because they behave differently and one label would hide
              that.
            */}
            <input
              ref={pdfInput}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadDocument(f);
                e.target.value = '';
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={busyDoc}
              onClick={() => pdfInput.current?.click()}
            >
              {busyDoc ? <Busy>Reading…</Busy> : 'Upload a PDF'}
            </Button>
            <Button
              size="sm"
              disabled={busy !== null || !docId.trim() || !docText.trim()}
              onClick={() => void attachDoc()}
            >
              {busy === 'attach' ? <Busy>Attaching…</Busy> : 'Attach'}
            </Button>
          </div>
        </div>
      </div>

      {/* ── The feedback loop ───────────────────────────────────────────── */}
      <div className="mt-4 rounded-[12px] shadow-[inset_0_0_0_1px_rgba(131,131,131,0.22)] p-4">
        <p className="text-13 font-medium text-ink">Will this claim pass?</p>
        <p className="mt-1 text-12 text-ink-muted">
          The same check SPARK runs before publishing. Try a sentence you want it to be able to write.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[240px] flex-1 max-cq-canvas:min-w-0 max-cq-canvas:basis-full">
            <Input
              value={claim}
              onChange={(e) => {
                setClaim(e.target.value);
                setClaimResult(null);
              }}
              placeholder="We turn most repairs around in 48 hours."
              aria-label="A claim to check"
            />
          </div>
          <Button variant="outline" disabled={busy !== null || !claim.trim()} onClick={() => void checkClaim()}>
            {busy === 'check' ? <Busy>Checking…</Busy> : 'Check'}
          </Button>
        </div>

        {claimResult ? (
          <div
            className={cn(
              'mt-3 rounded-lg border p-3',
              claimResult.grounded ? 'border-success/30 bg-success/10' : 'border-warn/40 bg-warn/10',
            )}
          >
            <p className="text-13 font-medium text-ink">
              {claimResult.grounded ? 'Grounded — SPARK can write this.' : 'Not grounded — this would be held.'}
            </p>
            {claimResult.fixAction ? <p className="mt-1 text-13 text-ink-muted">{claimResult.fixAction}</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
