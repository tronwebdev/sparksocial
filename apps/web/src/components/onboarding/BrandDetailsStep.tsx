'use client';

import { useState } from 'react';
import { invoke } from '@/lib/tools';
import { DropZone, PreviewPanel, SectionLabel, Select } from './kit';
import { uploadToStorage } from '@/lib/uploadToStorage';

/**
 * `F6`'s "Brand Details" — the prototype's second screen, and `M8`'s logo.
 *
 * Three answers on one screen, matching the design: a sentence about the brand,
 * its niche, and a logo. Grouped rather than split because they are the same
 * question — "what is this brand" — and because the flow's length was F6's
 * finding.
 *
 * ── Where each one goes ───────────────────────────────────────────────────
 *
 * The sentence is `identity.one_liner`, which `text-writer.ts` reads on every
 * caption. The niche is `identity.category`, which the crawl guesses and this
 * lets somebody correct before the guess propagates. The logo is
 * `brands.logo_url`, which reaches `resolveKit` at render time — so a brand that
 * uploads one here has its mark on its first post rather than on whichever post
 * follows the day somebody finds the settings screen.
 *
 * ── Why the logo is not an asset ──────────────────────────────────────────
 *
 * `asset.upload_url` puts the bytes in storage and the URL goes on the brand row.
 * Deliberately no `asset.ingest_url` afterwards, matching the Brand Kit panel: a
 * logo in the Asset Graph would be eligible for retrieval into posts as though it
 * were footage, and it would count against the reuse cooldown.
 *
 * Everything here is optional and everything saves as you go, so leaving early
 * loses nothing that was entered.
 */

/**
 * A short list, deliberately. The crawl already guesses a category and the
 * playbook engine never branches on it (invariant 5) — this exists so a wrong
 * guess can be corrected, not to route anything, so a taxonomy of two hundred
 * would be work for no effect.
 */
const NICHES = [
  'Trades and services',
  'Food and drink',
  'Health and fitness',
  'Beauty and grooming',
  'Retail and e-commerce',
  'Professional services',
  'Software',
  'Property',
  'Education',
  'Hospitality',
  'Creative and events',
  'Something else',
];

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function BrandDetailsStep({
  genomeId,
  brandName,
  initialNiche,
}: {
  genomeId: string;
  brandName: string;
  /** What the crawl inferred, so the field opens on the guess rather than empty. */
  initialNiche?: string;
}) {
  const [oneLiner, setOneLiner] = useState('');
  const [niche, setNiche] = useState(initialNiche ?? '');
  const [logoUrl, setLogoUrl] = useState('');
  const [savingText, setSavingText] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [generating, setGenerating] = useState(false);

  async function saveText() {
    const line = oneLiner.trim();
    if (!line && !niche) return;

    setSavingText(true);
    setMessage(null);
    const res = await invoke('genome.identity.set', {
      genomeId,
      identity: {
        ...(line ? { one_liner: line } : {}),
        // The list's own words go in — `category` is display-only and nothing in
        // the engine branches on it, so a readable label beats a slug.
        ...(niche && niche !== 'Something else' ? { category: niche } : {}),
      },
    });
    setSavingText(false);
    setMessage(
      res.status === 'succeeded'
        ? { kind: 'ok', text: 'Saved.' }
        : { kind: 'err', text: res.status === 'failed' ? res.error.message : 'That needs approval first.' },
    );
  }

  /**
   * `…192946` draws a "Generate logo" action beside Upload Logo, and
   * `brand.logo.generate` has been in the registry the whole time with nothing
   * calling it. The generated URL goes through the same
   * `brand.governance.set({ logoUrl })` as an upload, so both paths leave the
   * brand row in one shape.
   */
  async function generateLogo() {
    setMessage(null);
    setGenerating(true);
    /*
      No brandId and no hint: the schema is `{ brandId?, hint? }` and both are
      optional, defaulting to the session's brand and to the genome as its own
      prompt. Passing `genomeId`/`brandName` — which is what this first said —
      would have been silently stripped by Zod and read as deliberate.
    */
    const res = await invoke<{ logoUrl: string }>('brand.logo.generate', {}, crypto.randomUUID());
    setGenerating(false);

    if (res.status !== 'succeeded') {
      setMessage({
        kind: 'err',
        text: res.status === 'failed' ? res.error.message : 'Generating a logo needs approval first.',
      });
      return;
    }

    setLogoUrl(res.output.logoUrl);
    const saved = await invoke('brand.governance.set', { logoUrl: res.output.logoUrl });
    if (saved.status !== 'succeeded') {
      setMessage({ kind: 'err', text: 'Generated, but saving it to the brand failed.' });
    }
  }

  async function uploadLogo(file: File) {
    if (!IMAGE_TYPES.includes(file.type)) {
      setMessage({ kind: 'err', text: 'PNG, JPEG or WebP. A vector logo needs exporting to one of those.' });
      return;
    }

    setUploading(true);
    setMessage(null);

    const presigned = await invoke<{ uploadUrl: string; readUrl: string }>('asset.upload_url', {
      genomeId,
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    });
    if (presigned.status !== 'succeeded') {
      setUploading(false);
      setMessage({
        kind: 'err',
        text: presigned.status === 'failed' ? presigned.error.message : 'That upload was gated.',
      });
      return;
    }

    const put = await uploadToStorage(presigned.output.uploadUrl, file, file.type);
    if (!put.ok) {
      setUploading(false);
      setMessage({ kind: 'err', text: put.message });
      return;
    }

    const saved = await invoke('brand.governance.set', { logoUrl: presigned.output.readUrl });
    setUploading(false);
    if (saved.status !== 'succeeded') {
      setMessage({
        kind: 'err',
        text: saved.status === 'failed' ? saved.error.message : 'Saving the logo was gated.',
      });
      return;
    }
    setLogoUrl(presigned.output.readUrl);
    setMessage({ kind: 'ok', text: 'Logo saved.' });
  }

  /*
    `…192946`: a textarea, a "Choose Business Niche" select, then an "Upload Logo"
    section carrying a "Generate logo" action, a drop zone and a Logo Preview
    panel beside it.

    All three tool calls above are untouched — `genome.identity.set` on blur,
    `asset.upload_url` + `brand.governance.set` for the logo. `brand.logo.generate`
    is new here and already existed in the registry; the capture draws the button
    and the tool was never wired to anything.
  */
  return (
    <div className="flex flex-col gap-4">
      <textarea
        value={oneLiner}
        onChange={(e) => setOneLiner(e.target.value)}
        onBlur={() => void saveText()}
        rows={3}
        aria-label={`What ${brandName || 'your brand'} does`}
        placeholder="We create intelligent AI agents that simplify tasks and enhance productivity for businesses."
        className="ss-field w-full resize-none rounded-[12px] border border-border bg-input px-3 py-2.5 text-14 leading-[1.5] text-ink outline-none placeholder:text-ink-placeholder"
      />

      <div className="flex flex-col gap-1.5">
        <SectionLabel>Choose Business Niche</SectionLabel>
        <Select value={niche} onChange={(v) => { setNiche(v); void saveText(); }} ariaLabel="Business niche">
          <option value="">Choose one</option>
          {NICHES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-2.5 rounded-[14px] border border-border p-3">
        <SectionLabel
          trailing={
            <button
              type="button"
              onClick={() => void generateLogo()}
              disabled={generating || !brandName.trim()}
              className="flex items-center gap-1.5 rounded-[8px] border border-border bg-white px-2.5 py-1.5 text-13 text-ink transition-colors hover:bg-surface-muted disabled:opacity-40"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M6 1l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" fill="url(#sparkle)" />
                <defs>
                  <linearGradient id="sparkle" x1="0" y1="0" x2="1" y2="1">
                    <stop stopColor="#6CE8FF" />
                    <stop offset="1" stopColor="#A341FF" />
                  </linearGradient>
                </defs>
              </svg>
              {generating ? 'Generating…' : 'Generate logo'}
            </button>
          }
        >
          Upload Logo
        </SectionLabel>

        <div className="flex items-start gap-3">
          <DropZone
            className="flex-1"
            accept={IMAGE_TYPES.join(',')}
            formats="Png, Jpeg up to 500MB"
            busy={uploading}
            onFile={(f) => void uploadLogo(f)}
          />
          <PreviewPanel label="Logo Preview" onClear={logoUrl ? () => setLogoUrl('') : undefined}>
            {logoUrl ? <img src={logoUrl} alt="" className="max-h-[84px] max-w-[96px] object-contain" /> : null}
          </PreviewPanel>
        </div>
      </div>

      {message ? (
        <p
          role={message.kind === 'err' ? 'alert' : undefined}
          className={message.kind === 'err' ? 'text-13 text-destructive' : 'text-13 text-ink-muted'}
        >
          {message.text}
        </p>
      ) : null}
      {savingText ? <p className="text-13 text-ink-muted">Saving…</p> : null}
    </div>
  );
}
