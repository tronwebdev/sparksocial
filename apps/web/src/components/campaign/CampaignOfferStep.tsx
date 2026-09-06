'use client';

import Link from 'next/link';
import { InfoIcon, PANEL_CLIP, StepPanel, Switch } from './campaignChrome';

/**
 * `Step 3 — Offer Details`.
 *
 *   panel      199,222 · 638×806, clip `s3`, wash held to 48.96% so the brand
 *              card underneath it is not washed out
 *   brand card 43,157 · 551×442 r20 on `inset 0 0 0 1.276px rgba(12,12,12,0.1)`
 *   Edit       210,622 · 104×34 r7.482 · + Add New 324,622 on #0C0C0C
 *   CTA block  43,686 · 551×90 — an 18/600 label, the 45×24.324 switch at 146,
 *              and a 551×49 field that fades between 0.4 and 1
 *
 * ── What the brand card shows ─────────────────────────────────────────────
 *
 * The design fills it with one brand's fixture data: a name, a url, a
 * description, three tone chips, a timezone, an attached PDF, three colours and
 * two fonts. Six of those eight are real reads — `brand.governance.get` carries
 * the logo, colours, fonts, timezone and the agent's voice adjectives, and
 * `knowledge.list` carries the attached documents.
 *
 * The url and the free-text description are the two that are not: no tool
 * returns either. Rather than print a plausible-looking `www.` line that is not
 * the brand's, the card shows the newest knowledge document's own preview as
 * the description — which is literally what SPARK reads this brand as — and
 * gives the url line to the document count. A card in a wizard is exactly the
 * place a fabricated field would go unnoticed.
 */

export interface BrandCard {
  name: string;
  logoUrl?: string;
  colors: string[];
  fonts: { display?: string; body?: string };
  timezone: string;
  /** The agent's voice adjectives — the design's three tone chips. */
  voice: string[];
  docs: Array<{ docId: string; label: string; preview: string }>;
}

export function OfferStep({
  brand,
  ctaOn,
  ctaUrl,
  onToggleCta,
  onCtaUrl,
}: {
  brand: BrandCard | null;
  ctaOn: boolean;
  ctaUrl: string;
  onToggleCta: () => void;
  onCtaUrl: (v: string) => void;
}) {
  const doc = brand?.docs[0];
  return (
    <StepPanel x={199} y={222} w={638} h={806} clip={PANEL_CLIP.s3} wash="bg-cmp-panel-tall">
      <span className="absolute left-[43px] top-[42px] whitespace-nowrap text-[16px] font-normal leading-[1.43]" style={{ color: 'rgb(131,131,131)' }}>
        Campaign Offer Details
      </span>
      <InfoIcon className="absolute left-[224px] top-[42px]" title="What this campaign points people at. SPARK writes every post around it." />

      <h2 className="absolute left-[43px] top-[78px] whitespace-nowrap text-[25px] font-semibold leading-[1.43] text-black">
        What is this campaign about?
      </h2>
      <p className="absolute left-[43px] top-[114px] whitespace-nowrap text-[18px] font-normal leading-[0.9987]" style={{ color: 'rgb(131,131,131)' }}>
        Provide me with an anchor, and I&rsquo;ll craft the messaging.
      </p>

      {/* ── brand card ──────────────────────────────────────────────────── */}
      <div
        className="absolute left-[43px] top-[157px] h-[442px] w-[551px] rounded-xl bg-white"
        style={{ boxShadow: 'inset 0 0 0 1.276px rgba(12,12,12,0.1)' }}
      >
        <span className="absolute left-[27px] top-[24px] whitespace-nowrap text-[16px] font-medium leading-[1.273]" style={{ color: 'rgb(131,131,131)' }}>
          This is the brand I&rsquo;ll write as.
        </span>
        <div aria-hidden className="absolute left-0 top-[64px] h-px w-[551px]" style={{ background: 'rgba(131,131,131,0.2)' }} />

        <div className="absolute left-[25px] top-[73px] h-[255px] w-[387px]">
          <div
            className="absolute left-[1px] top-0 h-[63px] w-[63px] rounded-full bg-surface-200 bg-cover bg-center"
            style={{
              backgroundImage: brand?.logoUrl ? `url('${brand.logoUrl}')` : undefined,
              boxShadow: 'inset 0 0 0 0.67px rgba(131,131,131,0.4)',
            }}
          />
          <span className="absolute left-[76px] top-[4px] whitespace-nowrap text-[25px] font-semibold leading-[1.269] text-black">
            {brand?.name ?? '—'}
          </span>
          <span className="absolute left-[76px] top-[37px] whitespace-nowrap text-[18px] font-medium leading-[1.269] text-link-blue">
            {brand ? `${brand.docs.length} source ${brand.docs.length === 1 ? 'document' : 'documents'}` : ''}
          </span>

          <span className="absolute left-[1px] top-[78px] line-clamp-2 block w-[386px] text-[16px] font-medium leading-[1.269]" style={{ color: 'rgb(131,131,131)' }}>
            {doc?.preview ??
              'Nothing is attached yet. SPARK will write from the brand voice alone until you add a document.'}
          </span>

          {/* Tone chips — the agent's own voice adjectives, up to three. */}
          <div className="absolute left-[1px] top-[132px] flex h-[26.751px] w-[247px] items-center gap-[5px]">
            {(brand?.voice ?? []).slice(0, 3).map((v) => (
              <span
                key={v}
                className="inline-flex h-[26.751px] items-center rounded-[9.26px] bg-white px-[12px] text-[14.267px] font-medium capitalize"
                style={{ boxShadow: 'inset 0 0 0 0.617px rgba(12,12,12,0.2)', color: 'rgb(131,131,131)' }}
              >
                {v}
              </span>
            ))}
          </div>

          <span className="absolute left-[1px] top-[176px] whitespace-nowrap text-[14px] font-medium leading-[1.269]" style={{ color: 'rgb(131,131,131)' }}>
            {brand?.timezone ?? '—'}
          </span>

          {doc ? (
            <div
              className="absolute left-0 top-[208px] h-[47px] w-[271px] rounded"
              style={{ background: 'var(--ss-field-bg)', boxShadow: 'inset 0 0 0 1.379px rgba(12,12,12,0.1)' }}
            >
              <span aria-hidden className="absolute left-[7px] top-[4px] flex h-[37px] w-[37px] items-center justify-center rounded-[7px] bg-white text-[10px] font-bold" style={{ color: 'rgb(131,131,131)' }}>
                DOC
              </span>
              <span className="absolute left-[47px] top-[14px] block max-w-[214px] truncate text-[14px] font-medium leading-none" style={{ color: 'rgb(131,131,131)' }}>
                {doc.label}
              </span>
            </div>
          ) : null}
        </div>

        {/* Brand colours */}
        <div className="absolute left-[26px] top-[344px] h-[28.782px] w-[201px]">
          <span className="absolute left-0 top-[5.453px] whitespace-nowrap text-[14px] font-medium leading-none" style={{ color: 'rgb(131,131,131)' }}>
            Brand Colors:
          </span>
          {(brand?.colors ?? []).slice(0, 3).map((c, i) => (
            <span
              key={`${c}-${i}`}
              className="absolute top-0 inline-block h-[28.782px] w-[28.782px] rounded-[7.995px]"
              style={{ left: [102, 137.04, 172.218][i], background: c, boxShadow: 'inset 0 0 0 1.009px rgba(12,12,12,0.1)' }}
            />
          ))}
        </div>

        {/* Font styles */}
        <div className="absolute left-[26px] top-[394.166px] h-[26px] w-[263.04px]">
          <span className="absolute left-0 top-[4.287px] whitespace-nowrap text-[14px] font-medium leading-none" style={{ color: 'rgb(131,131,131)' }}>
            Font Styles:
          </span>
          <span className="absolute left-[102px] top-[1px] whitespace-nowrap text-[20px] font-bold leading-none text-ink">
            {brand?.fonts.display ?? '—'}
          </span>
          <span className="absolute left-[170.04px] top-0 whitespace-nowrap text-[20px] font-bold leading-[1.3] text-ink">
            {brand?.fonts.body ? `, ${brand.fonts.body}` : ''}
          </span>
        </div>
      </div>

      {/* Both go to the Brand Kit, which is where a brand is actually edited. */}
      <Link
        href="/settings/brand-kit"
        className="absolute left-[210px] top-[622px] flex h-[34px] w-[104px] items-center justify-center rounded-[7.482px] bg-white text-[16px] font-normal text-black transition-colors hover:bg-surface-200 active:scale-[0.97]"
        style={{ boxShadow: 'inset 0 0 0 0.762px rgb(131,131,131)' }}
      >
        Edit
      </Link>
      <Link
        href="/settings/brand-kit"
        className="absolute left-[324px] top-[622px] flex h-[34px] w-[104px] items-center justify-center rounded-[7.482px] bg-ink text-[16px] font-normal text-white transition-colors hover:bg-ink-800 active:scale-[0.97]"
      >
        + Add New
      </Link>

      {/* ── CTA URL ─────────────────────────────────────────────────────── */}
      <div className="absolute left-[43px] top-[686px] h-[90px] w-[551px]">
        <span className="absolute left-[1px] top-[1px] whitespace-nowrap text-[18px] font-semibold leading-none text-ink">Enable CTA URL</span>
        <div className="absolute left-[146px] top-0">
          <Switch on={ctaOn} onChange={onToggleCta} label="Enable CTA URL" />
        </div>
        <InfoIcon className="absolute left-[209px] top-[2px]" title="Where this campaign's posts send people. Saved on the campaign, not on the brand." />

        <div
          className="absolute left-0 top-[41px] h-[49px] w-[551px] rounded bg-white transition-opacity duration-200"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)', opacity: ctaOn ? 1 : 0.4 }}
        >
          <input
            type="url"
            inputMode="url"
            aria-label="Campaign CTA URL"
            placeholder="https://"
            disabled={!ctaOn}
            value={ctaUrl}
            onChange={(e) => onCtaUrl(e.target.value)}
            className="absolute left-[19px] top-0 h-[49px] w-[512px] bg-transparent text-[18px] font-normal text-ink outline-none"
          />
        </div>
      </div>
    </StepPanel>
  );
}
