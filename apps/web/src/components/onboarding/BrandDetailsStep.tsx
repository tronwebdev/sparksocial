'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/tools';

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
  const fileInput = useRef<HTMLInputElement>(null);

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

    try {
      const put = await fetch(presigned.output.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': file.type, 'x-ms-blob-type': 'BlockBlob' },
        body: file,
      });
      if (!put.ok) throw new Error(`Storage rejected the upload (${put.status}).`);
    } catch (e) {
      setUploading(false);
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'The upload could not reach storage.' });
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

  return (
    <div className="grid grid-cols-1 gap-6">
      <div>
        <label className="text-[13px] font-medium text-ink-muted" htmlFor="onb-oneliner">
          Tell SPARK a bit more about {brandName || 'your brand'}
        </label>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          One or two sentences, the way you would say it to somebody in the street. This is what every
          caption is written from.
        </p>
        <textarea
          id="onb-oneliner"
          value={oneLiner}
          onChange={(e) => setOneLiner(e.target.value)}
          onBlur={() => void saveText()}
          rows={3}
          maxLength={400}
          placeholder="We cut hair for men who want to look sharp without booking a whole afternoon."
          className="mt-2 w-full rounded-lg border border-border bg-field px-3 py-2 text-[14px] text-ink"
        />
      </div>

      <div>
        <label className="text-[13px] font-medium text-ink-muted" htmlFor="onb-niche">
          What kind of business is it?
        </label>
        <select
          id="onb-niche"
          value={niche}
          onChange={(e) => setNiche(e.target.value)}
          onBlur={() => void saveText()}
          className="mt-1.5 w-full rounded-lg border border-border bg-field px-3 py-2 text-[14px] text-ink"
        >
          <option value="">Choose one</option>
          {NICHES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className="text-[13px] font-medium text-ink-muted">Logo</p>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Used as a corner mark on posts. Six formats need one before they can be made at all.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload a logo'}
          </Button>
          {logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={logoUrl}
              alt="Brand logo"
              className="h-12 w-auto max-w-[160px] rounded border border-border bg-surface-muted object-contain p-1"
            />
          ) : (
            <span className="text-[13px] text-ink-muted">Nothing yet</span>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void uploadLogo(file);
          }}
        />
      </div>

      {savingText ? <p className="text-[13px] text-ink-muted">Saving…</p> : null}
      {message ? (
        <p className={message.kind === 'ok' ? 'text-[13px] text-ink-muted' : 'text-[13px] text-warn'}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
