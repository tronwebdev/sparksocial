'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import { NICHES, resolveNiche } from '@sparksocial/shared';
import { BrandColorPicker, DropZone, PreviewTile, SectionLabel, SelectField, UploadSection, GenerateButton, SectionRule } from './kit';
import { ProtoScale } from './Stage';
import { uploadToStorage, type PresignedUpload } from '@/lib/uploadToStorage';
import { notify, notifyResult } from '@/lib/notify';
import { Busy, SparkLoader } from '@/components/brand/SparkLoader';

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
  /*
   * Resolved, not taken raw.
   *
   * `initialNiche` is the crawl's free-text category — "Jewellery brand / DTC
   * e-commerce" — which is not a member of `NICHES`, so assigning it directly
   * left the select on "Choose one" and the crawl's answer invisible.
   */
  const [niche, setNiche] = useState(() => resolveNiche(initialNiche).niche);
  /** What they typed after choosing "Something else" — see `effectiveNiche`. */
  const [otherNiche, setOtherNiche] = useState(() => resolveNiche(initialNiche).other);
  /**
   * The brand palette, here rather than only on the brand-kit step.
   *
   * `brand.logo.generate` reads the palette off governance, and the brand kit
   * is **two steps after** this one — so every logo generated during onboarding
   * was made before the brand had a colour, and telling the model to use the
   * palette changed nothing on the path people actually take. The kit still
   * owns colours; it opens on whatever was chosen here.
   */
  const [colors, setColors] = useState<string[]>([]);
  const [logoUrl, setLogoUrl] = useState('');
  const [savingText, setSavingText] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** A dropped file of the wrong type — said beside the drop zone, not as news. */
  const [fileError, setFileError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  /**
   * Open on whatever the crawl already found.
   *
   * Both of these were initialised empty and never read back, which was
   * harmless while nothing populated them server-side. It stopped being
   * harmless the moment `genome.bootstrap_from_url` started writing a palette,
   * fonts and a logo onto governance: the crawl would read `#146b33` and the
   * brand's real wordmark off the site, store both, and this screen — the very
   * next one — would show an empty swatch row and an empty logo tile.
   *
   * Worse than cosmetic. "Generate logo" is on this screen and takes the
   * palette, so a logo would be generated against no colours while the brand's
   * actual colours sat in the database; and anything picked here would
   * overwrite what the crawl found without anyone seeing what was lost.
   *
   * Found by walking the deployed flow, not by a test: the tool returned the
   * right kit and the screen below it was blank.
   */
  useEffect(() => {
    let live = true;
    void (async () => {
      const [gov, gen] = await Promise.all([
        invoke<{ brandColors?: string[]; logoUrl?: string }>('brand.governance.get', {}),
        invoke<{ genome?: { identity?: { one_liner?: string; category?: string } } }>('genome.get', { genomeId }),
      ]);

      if (!live) return;

      /* Only seed what is empty: a person who has already typed on this screen
         outranks anything a crawl proposed. */
      if (gov.status === 'succeeded') {
        if (gov.output.brandColors?.length) setColors((c) => (c.length ? c : gov.output.brandColors!));
        if (gov.output.logoUrl) setLogoUrl((u) => u || gov.output.logoUrl!);
      }

      /*
       * The sentence the crawl wrote.
       *
       * It was never loaded, and the field's placeholder is a hard-coded
       * example about AI agents — so a jewellery brand that had just been read
       * correctly showed an empty box suggesting it sold software. Worse than
       * blank: `canGenerateLogo` requires this field, so "Generate logo" sat
       * disabled saying "Add what your brand does first" about a brand whose
       * description was already in the database.
       */
      if (gen.status === 'succeeded') {
        const line = gen.output.genome?.identity?.one_liner?.trim();
        if (line) setOneLiner((v) => v || line);

        /* The category too, for a reload that skipped the crawl screen. */
        const category = gen.output.genome?.identity?.category;
        if (category) {
          const resolved = resolveNiche(category);
          if (resolved.niche) {
            setNiche((n) => n || resolved.niche);
            setOtherNiche((o) => o || resolved.other);
          }
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [genomeId]);

  /**
   * The niche actually recorded, from either half of the control.
   *
   * "Something else" used to save *nothing*: the list's own words went in and
   * that option was filtered out, so choosing it left `category` empty and the
   * logo prompt a word shorter — with no sign on screen that picking it had
   * been the same as picking nothing. It now reveals a text field, and whatever
   * is typed there is the category.
   */
  const effectiveNiche = niche === 'Something else' ? otherNiche.trim() : niche;

  /**
   * Both fields, because both are what the logo is generated from.
   *
   * `brand.logo.generate` reads `identity.one_liner` and `identity.category`
   * and nothing else about the brand. Without them the prompt degrades to "a
   * flat vector logo mark for {name}" — which still costs ~4¢ and still
   * produces a mark, just a generic one, with nothing on screen explaining why.
   */
  const canGenerateLogo = oneLiner.trim().length > 0 && effectiveNiche.length > 0;

  async function saveText() {
    const line = oneLiner.trim();
    if (!line && !effectiveNiche) return;

    setSavingText(true);
    const res = await invoke('genome.identity.set', {
      genomeId,
      identity: {
        ...(line ? { one_liner: line } : {}),
        // The list's own words, or theirs — `category` is display-only and
        // nothing in the engine branches on it (CLAUDE.md invariant 5), so a
        // readable label beats a slug and free text is as good as a listed one.
        ...(effectiveNiche ? { category: effectiveNiche } : {}),
      },
    });
    setSavingText(false);
    // Quiet on success: it saves on every blur, and the words are already on
    // screen — a card per field would bury the step. Only a failure says so.
    notifyResult(res, undefined, 'Couldn’t save your brand details');
  }

  /**
   * `…192946` draws a "Generate logo" action beside Upload Logo, and
   * `brand.logo.generate` has been in the registry the whole time with nothing
   * calling it. The generated URL goes through the same
   * `brand.governance.set({ logoUrl })` as an upload, so both paths leave the
   * brand row in one shape.
   */
  /** Persisted immediately: the logo reads it from governance, not from here. */
  async function saveColors(next: string[]) {
    setColors(next);
    await invoke('brand.governance.set', { brandColors: next.length ? next : null });
  }

  async function generateLogo() {
    setFileError(null);
    setGenerating(true);
    /*
      No brandId and no hint: the schema is `{ brandId?, hint? }` and both are
      optional, defaulting to the session's brand and to the genome as its own
      prompt. Passing `genomeId`/`brandName` — which is what this first said —
      would have been silently stripped by Zod and read as deliberate.
    */
    const res = await invoke<{ logoUrl: string }>('brand.logo.generate', {}, crypto.randomUUID());
    setGenerating(false);

    if (!notifyResult(res, undefined, 'Couldn’t generate a logo')) return;

    setLogoUrl(res.output.logoUrl);
    const saved = await invoke('brand.governance.set', { logoUrl: res.output.logoUrl });
    if (saved.status !== 'succeeded') {
      notify.error('Logo generated, but not saved', { body: 'Saving it to the brand failed.' });
    }
  }

  async function uploadLogo(file: File) {
    if (!IMAGE_TYPES.includes(file.type)) {
      setFileError('PNG, JPEG or WebP. A vector logo needs exporting to one of those.');
      return;
    }

    setUploading(true);
    setFileError(null);

    const presigned = await invoke<PresignedUpload>('asset.upload_url', {
      genomeId,
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    });
    if (!notifyResult(presigned, undefined, 'Couldn’t upload the logo')) {
      setUploading(false);
      return;
    }

    const put = await uploadToStorage(presigned.output.uploadUrl, file, file.type, presigned.output.headers);
    if (!put.ok) {
      setUploading(false);
      notify.error('Couldn’t upload the logo', { body: put.message });
      return;
    }

    const saved = await invoke('brand.governance.set', { logoUrl: presigned.output.readUrl });
    setUploading(false);
    if (!notifyResult(saved, 'Logo saved', 'Couldn’t save the logo')) return;
    setLogoUrl(presigned.output.readUrl);
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
            /*
              `#F3F4F8`, from the design's `NotchCard` for this field — 547x143,
              radius 10, filled. It was `#FFFFFF`: invisible on a white step
              card, so the brand description looked like loose placeholder text
              rather than something you type into. Same fault as the niche
              select beneath it; the design gives neither a border, because the
              fill is what makes them fields.
            */
            width: 547, borderRadius: 10, background: '#F3F4F8', border: 'none', outline: 'none',
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

          {/*
            "Something else" asks a question and used to ignore the answer.

            It is in the list precisely for the brands the short list does not
            cover, and choosing it saved no category at all — so the one option
            for an unusual business was the one that told the engine least about
            it. The field is the answer to the question the option asks.

            Same fill as the select above it, because it is the same control
            continued; the design has no state for this, so it follows the
            field it extends rather than inventing a treatment.
          */}
          {niche === 'Something else' ? (
            <input
              type="text"
              value={otherNiche}
              onChange={(e) => setOtherNiche(e.target.value)}
              onBlur={() => void saveText()}
              aria-label="Describe your business niche"
              placeholder="e.g. mobile car valeting"
              style={{
                width: 547,
                height: 63,
                borderRadius: 10,
                background: '#F3F4F8',
                border: 'none',
                outline: 'none',
                padding: '0 21px',
                fontSize: 18,
                fontWeight: 500,
                color: '#0C0C0C',
              }}
            />
          ) : null}
        </div>

        {/*
          Above the logo, because the logo is generated from it.

          Not a duplicate of the brand-kit step so much as the same control
          where it is first needed: that step is two ahead of this one, and a
          palette chosen after the logo cannot reach it. Both write
          `brandColors` through `brand.governance.set`, and the kit loads from
          governance on mount, so whichever is touched first is what the other
          opens on.
        */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <SectionLabel info="Used when SPARK generates a logo, and by every rendered post afterwards.">
            Brand Colours
          </SectionLabel>
          <BrandColorPicker colors={colors} onChange={(next) => void saveColors(next)} width={547} />
        </div>

        <UploadSection width={547} height={263}>
          <span style={{ position: 'absolute', left: 20, top: 24, fontSize: 18, fontWeight: 500, color: '#0C0C0C' }}>
            Upload Logo
          </span>
          <GenerateButton
            left={385}
            top={16.9}
            label={generating ? <Busy size={16}>Generating…</Busy> : 'Generate logo'}
            onClick={() => void generateLogo()}
            disabled={generating || !canGenerateLogo}
            title={
              canGenerateLogo
                ? 'Generate a logo from what your brand does and its niche.'
                : !oneLiner.trim() && !effectiveNiche
                  ? 'Add what your brand does and choose a niche first — the logo is generated from them.'
                  : !oneLiner.trim()
                    ? 'Add what your brand does first — the logo is generated from it.'
                    : 'Choose a niche first — the logo is generated from it.'
            }
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

        {fileError ? (
          <p role="alert" style={{ fontSize: 16, color: '#F01C1C' }}>
            {fileError}
          </p>
        ) : null}
        {savingText ? <SparkLoader size="inline" label="Saving…" /> : null}
      </div>
    </ProtoScale>
  );
}
