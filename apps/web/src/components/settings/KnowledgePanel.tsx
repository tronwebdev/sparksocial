'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { cn } from '@/lib/utils';

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

export function KnowledgePanel() {
  const { genome } = useSelectedGenome();
  const genomeId = genome?.genomeId;

  const [list, setList] = useState<KnowledgeList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<'crawl' | 'attach' | 'check' | null>(null);

  const [siteUrl, setSiteUrl] = useState('');
  const [maxPages, setMaxPages] = useState(5);

  const [docId, setDocId] = useState('');
  const [docText, setDocText] = useState('');

  const [claim, setClaim] = useState('');
  const [claimResult, setClaimResult] = useState<{ grounded: boolean; fixAction?: string } | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!genomeId) return;
    const res = await invoke<KnowledgeList>('knowledge.list', { genomeId });
    if (res.status === 'succeeded') {
      setList(res.output);
      setError(null);
    } else {
      setError(res.status === 'failed' ? res.error.message : 'Knowledge is not visible to this role.');
    }
  }, [genomeId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function crawl() {
    if (!genomeId || !siteUrl.trim()) return;
    setBusy('crawl');
    setNote(null);
    const res = await invoke<{ attached: { docId: string }[]; failure?: string }>('knowledge.ingest_site', {
      genomeId,
      url: siteUrl.trim(),
      maxPages,
    });
    setBusy(null);
    if (res.status !== 'succeeded') {
      setNote({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That crawl was held for review.' });
      return;
    }
    // The tool reports a `failure` rather than throwing when a crawl reaches a
    // real site and finds nothing worth attaching. Surfaced as-is: "0 pages
    // attached" with no reason is the kind of result people retry three times.
    setNote(
      res.output.failure
        ? { kind: 'err', text: res.output.failure }
        : { kind: 'ok', text: `Attached ${res.output.attached.length} page${res.output.attached.length === 1 ? '' : 's'}.` },
    );
    setSiteUrl('');
    await load();
  }

  async function attachDoc() {
    if (!genomeId || !docId.trim() || !docText.trim()) return;
    if (docText.length > MAX_DOC_CHARS) {
      setNote({ kind: 'err', text: `That is ${docText.length.toLocaleString()} characters; the limit is ${MAX_DOC_CHARS.toLocaleString()}. Split it into sections.` });
      return;
    }
    setBusy('attach');
    setNote(null);
    const res = await invoke<{ docId: string }>('brand.knowledge.attach', {
      genomeId,
      docId: docId.trim(),
      text: docText,
      citationLabel: docId.trim(),
    });
    setBusy(null);
    if (res.status !== 'succeeded') {
      setNote({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That request was held for review.' });
      return;
    }
    setNote({ kind: 'ok', text: `Attached “${res.output.docId}”.` });
    setDocId('');
    setDocText('');
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
      setNote({
        kind: 'err',
        text: `${file.name} needs a parser SPARK does not have. Plain text, Markdown, CSV or JSON — or paste the text in directly.`,
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
      setNote(
        text.length > MAX_DOC_CHARS
          ? { kind: 'err', text: `${file.name} is longer than ${MAX_DOC_CHARS.toLocaleString()} characters — only the first part was loaded. Check it before attaching.` }
          : { kind: 'ok', text: `Loaded ${file.name}. Review it, then attach.` },
      );
    };
    reader.onerror = () => setNote({ kind: 'err', text: `Could not read ${file.name}.` });
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
    if (res.status !== 'succeeded') {
      setNote({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That check was held for review.' });
      return;
    }
    setClaimResult({ grounded: res.output.grounded, ...(res.output.fixAction ? { fixAction: res.output.fixAction } : {}) });
  }

  if (!genomeId) return null;

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">What this brand knows</h2>
      <p className="mt-1 max-w-prose text-[14px] text-ink-muted">
        Policies, FAQs, spec sheets, pages from your site. SPARK checks every specific claim it writes against
        this material before publishing — so anything you cannot back up here gets flagged rather than posted.
      </p>

      {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}
      {note ? (
        <p className={cn('mt-3 text-[13px]', note.kind === 'ok' ? 'text-success' : 'text-destructive')}>{note.text}</p>
      ) : null}

      {/* ── What is attached. First, because it is the answer to "did that work?" ── */}
      <div className="mt-5">
        {list === null && !error ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : list && list.docs.length === 0 ? (
          <div className="rounded-lg border border-warn/40 bg-warn/10 p-3">
            <p className="text-[13px] font-medium text-ink">Nothing attached yet</p>
            <p className="mt-1 text-[13px] text-ink-muted">
              Until something is, every specific claim SPARK writes — a price, a turnaround time, a guarantee —
              will be held rather than published. The fastest fix is to point it at your own site below.
            </p>
          </div>
        ) : list ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[13px] font-medium text-ink-muted">
                {list.docs.length} document{list.docs.length === 1 ? '' : 's'}
              </p>
              <p className="text-[12px] tabular-nums text-ink-muted">
                {list.totalChars.toLocaleString()} characters · {list.totalChunks} embedded chunk
                {list.totalChunks === 1 ? '' : 's'}
              </p>
            </div>
            <ul className="mt-2 grid grid-cols-1 gap-2">
              {list.docs.map((d) => (
                <li key={d.docId} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-mono text-[12px] text-ink">{d.docId}</p>
                    <div className="flex shrink-0 items-center gap-2">
                      {d.chunks > 1 ? <Badge variant="neutral">{d.chunks} chunks</Badge> : null}
                      <span className="text-[12px] tabular-nums text-ink-muted">
                        {d.chars.toLocaleString()} chars
                      </span>
                      <span className="text-[12px] text-ink-muted">
                        {new Date(d.attachedAt).toLocaleDateString('en', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                  </div>
                  {d.citationLabel && d.citationLabel !== d.docId ? (
                    <p className="mt-0.5 text-[12px] text-ink-muted">{d.citationLabel}</p>
                  ) : null}
                  <p className="mt-1 line-clamp-2 text-[12px] text-ink-muted">{d.preview}</p>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      {/* ── The two ways in ─────────────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <p className="text-[13px] font-medium text-ink">Read my website</p>
          <p className="mt-1 text-[12px] text-ink-muted">
            SPARK opens each page and reads it. Roughly a cent a page, and it takes a few seconds per page —
            leave this open while it runs.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <label className="block text-[12px] text-ink-muted" htmlFor="kn-url">
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
              <label className="block text-[12px] text-ink-muted" htmlFor="kn-pages">
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
              {busy === 'crawl' ? 'Reading…' : 'Read'}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border p-4">
          <p className="text-[13px] font-medium text-ink">Add a document</p>
          <p className="mt-1 text-[12px] text-ink-muted">
            Paste the text, or load a plain-text, Markdown, CSV or JSON file. PDFs and Word documents need a
            parser SPARK does not have — open them and paste instead.
          </p>

          <label className="mt-3 block text-[12px] text-ink-muted" htmlFor="kn-docid">
            What is it called
          </label>
          <Input
            id="kn-docid"
            value={docId}
            onChange={(e) => setDocId(e.target.value)}
            placeholder="Returns policy"
            className="mt-1"
          />

          <label className="mt-3 block text-[12px] text-ink-muted" htmlFor="kn-text">
            The text
          </label>
          <textarea
            id="kn-text"
            value={docText}
            onChange={(e) => setDocText(e.target.value)}
            rows={5}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink"
            placeholder="Paste the policy, FAQ or spec sheet here."
          />
          <p className="mt-1 text-[11px] tabular-nums text-ink-muted">
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
            <Button
              size="sm"
              disabled={busy !== null || !docId.trim() || !docText.trim()}
              onClick={() => void attachDoc()}
            >
              {busy === 'attach' ? 'Attaching…' : 'Attach'}
            </Button>
          </div>
        </div>
      </div>

      {/* ── The feedback loop ───────────────────────────────────────────── */}
      <div className="mt-4 rounded-lg border border-border p-4">
        <p className="text-[13px] font-medium text-ink">Will this claim pass?</p>
        <p className="mt-1 text-[12px] text-ink-muted">
          The same check SPARK runs before publishing. Try a sentence you want it to be able to write.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[240px] flex-1">
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
            {busy === 'check' ? 'Checking…' : 'Check'}
          </Button>
        </div>

        {claimResult ? (
          <div
            className={cn(
              'mt-3 rounded-lg border p-3',
              claimResult.grounded ? 'border-success/30 bg-success/10' : 'border-warn/40 bg-warn/10',
            )}
          >
            <p className="text-[13px] font-medium text-ink">
              {claimResult.grounded ? 'Grounded — SPARK can write this.' : 'Not grounded — this would be held.'}
            </p>
            {claimResult.fixAction ? <p className="mt-1 text-[13px] text-ink-muted">{claimResult.fixAction}</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
