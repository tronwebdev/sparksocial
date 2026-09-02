'use client';

import { useState } from 'react';
import { invoke } from '@/lib/tools';
import { DropZone, PreviewTile, SectionLabel, SelectField, UploadSection, GenerateButton, SectionRule } from './kit';
import { ProtoScale } from './Stage';
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
    `…192946` at the prototype's own numbers: a 547-wide column with the
    one-liner, the niche select, and a `#F3F4F8` Upload Logo section 547×263
    holding a Generate button at 385,16.9, a rule at y=71, a 340×160 drop zone at
    20,86 and a 129.7 preview tile at 385,114.2.

    Rendered inside `ProtoScale`, so every value is native 1728-canvas px. The
    three tool calls above are untouched.
  */
  return (
    <ProtoScale native={547}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, width: 547 }}>
        <textarea
          value={oneLiner}
          onChange={(e) => setOneLiner(e.target.value)}
          onBlur={() => void saveText()}
          rows={3}
          aria-label={`What ${brandName || 'your brand'} does`}
          placeholder="We create intelligent AI agents that simplify tasks and enhance productivity for businesses."
          style={{
            width: 547, borderRadius: 10, background: '#FFFFFF', border: 'none', outline: 'none',
            padding: '18px 19px', fontSize: 18, lineHeight: 1.5, color: '#0C0C0C', resize: 'none',
          }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <SectionLabel>Choose Business Niche</SectionLabel>
          <SelectField
            width={547}
            ariaLabel="Business niche"
            placeholder="Choose one"
            value={niche}
            onChange={(v: string) => {
              setNiche(v);
              void saveText();
            }}
            options={NICHES.map((n) => ({ value: n, label: n }))}
          />
        </div>

        <UploadSection width={547} height={263}>
          <span style={{ position: 'absolute', left: 20, top: 24, fontSize: 18, fontWeight: 500, color: '#0C0C0C' }}>
            Upload Logo
          </span>
          <GenerateButton
            left={385}
            top={16.9}
            label={generating ? 'Generating…' : 'Generate logo'}
            onClick={() => void generateLogo()}
            disabled={generating}
          />
          <SectionRule top={71} />
          <DropZone
            left={20}
            top={86}
            accept={IMAGE_TYPES.join(',')}
            formats="Png, Jpeg up to 500MB"
            busy={uploading}
            onFile={(f) => void uploadLogo(f)}
          />
          <PreviewTile left={385} top={114.2} label="Logo Preview" onClear={logoUrl ? () => setLogoUrl('') : undefined}>
            {logoUrl ? <img src={logoUrl} alt="" style={{ maxWidth: 118, maxHeight: 118, objectFit: 'contain' }} /> : null}
          </PreviewTile>
        </UploadSection>

        {message ? (
          <p
            role={message.kind === 'err' ? 'alert' : undefined}
            style={{ fontSize: 16, color: message.kind === 'err' ? '#F01C1C' : '#838383' }}
          >
            {message.text}
          </p>
        ) : null}
        {savingText ? <p style={{ fontSize: 16, color: '#838383' }}>Saving…</p> : null}
      </div>
    </ProtoScale>
  );
}
