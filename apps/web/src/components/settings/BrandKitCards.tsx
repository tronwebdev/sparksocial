'use client';

import { useRef, useState, type DragEvent } from 'react';
import { BRAND_FONTS, fontStack } from '@sparksocial/shared';
import { cn } from '@/lib/utils';
import { KitRow, KitSection } from './KitSection';
import { GOOGLE_CSS } from './BrandFontPicker';

/**
 * The four cards at the top of `Settings WS Brand Kits.dc.html` — Workspace
 * logo, Color Theme, Brand Voice, Typography Style — drawn to the design.
 *
 * ── Why these are presentational ─────────────────────────────────────────
 *
 * Every value here is one field of `GovernancePanel`'s single draft, saved by
 * one `brand.governance.set`. Splitting the cards into components that each
 * owned their state would have four of them racing to write the same row, so
 * they take values and callbacks and own nothing but hover and drag.
 *
 * ── What changed, against what these cards used to be ───────────────────
 *
 * They were working forms in the design's grid: a URL field and two buttons
 * for the logo, named presets and labelled pickers for colour, four sliders
 * for voice, two selects and a sample for type. Measured against the
 * prototype every one of them was a different card under the same title.
 *
 * The design's interaction is coarser — one dropdown, a row of chips, a row
 * of swatches — and that is what the four cards now draw. The finer controls
 * are not dropped: the tone sliders, the caption face and the narration voice
 * move to `FineTuneCard` under the design's content, because the design has
 * nowhere for them and a brand that wants them should still find them.
 *
 * All geometry is card-relative, read off the prototype at 1728 wide.
 */

const LINE = 'rgba(12,12,12,0.1)';

/* ── Workspace logo ───────────────────────────────────────────────────── */

export function LogoCard({
  logoUrl,
  uploading,
  generating,
  onFile,
  onGenerate,
}: {
  logoUrl: string;
  uploading: boolean;
  generating: boolean;
  onFile: (file: File) => void;
  onGenerate: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  return (
    <KitSection
      title="Workspace logo"
      rule={71}
      style={{ minHeight: 321.6 }}
      headerRight={
        /* 161.4x43.6 at 448.6,14.8: white, radius 11.3, a 0.755 ring. */
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating || uploading}
          title="A flat placeholder mark to work with until you have your own logo."
          aria-label="Generate logo"
          className="flex h-[43.6px] w-[161.4px] items-center gap-[8px] rounded-[11.3px] bg-white pl-[11.4px] text-16 font-medium text-ink transition-colors hover:bg-[#F7F7F7] disabled:opacity-60 [@container(max-width:420px)]:w-[43.6px] [@container(max-width:420px)]:justify-center [@container(max-width:420px)]:pl-0"
          style={{ boxShadow: `inset 0 0 0 0.755px ${LINE}` }}
        >
          <svg width="23" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="m12 3 1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4L12 3ZM18.5 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          {/* The word goes before the button runs past the card. */}
          <span className="[@container(max-width:420px)]:hidden">{generating ? 'Generating…' : 'Generate logo'}</span>
        </button>
      }
    >
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />

      {/*
        Preview column at 31.5: its label centred over a 155x157 circle that
        starts 13 under it. The drop zone is the second column, 402.8x161.4 at
        207,117.9 — so it starts 31 below the label's top and 20 right of the
        circle.
      */}
      {/* Stacked when the card cannot hold both columns: 155 + 20 + a drop
          zone worth dropping on. At 1024 two-up the zone was 40px wide. */}
      <div className="mt-[15.3px] flex items-start gap-[20.3px] pl-[8.5px] [@container(max-width:520px)]:flex-col [@container(max-width:520px)]:items-center [@container(max-width:520px)]:pl-0">
        <div className="flex w-[155px] shrink-0 flex-col items-center">
          <span className="text-17 font-normal leading-[22px] text-ink-muted">Logo Preview</span>
          <span
            className="mt-[13.3px] flex h-[157px] w-[155px] items-center justify-center overflow-hidden rounded-full bg-white"
            style={{ boxShadow: 'inset 0 0 0 0.817px rgba(0,0,0,0.25)' }}
          >
            {logoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={logoUrl} alt="Brand logo" className="h-[70%] w-[70%] object-contain" />
            ) : (
              <span className="px-6 text-center text-13 text-ink-muted">No logo yet</span>
            )}
          </span>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              input.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          className={cn(
            'relative mt-[30.6px] flex h-[161.4px] min-w-0 max-w-[402.8px] flex-1 cursor-pointer flex-col items-center rounded-[14.6px] bg-white outline-none transition-shadow focus-visible:shadow-[0_0_0_2px_var(--ss-primary)] [@container(max-width:520px)]:mt-0 [@container(max-width:520px)]:w-full [@container(max-width:520px)]:flex-none',
            over && 'shadow-[inset_0_0_0_1.5px_#A341FF]',
          )}
        >
          <svg className="mt-[13.7px]" width="37" height="35" viewBox="0 0 37 35" fill="none" aria-hidden>
            <path
              d="M11 27.5H8.5a7 7 0 0 1-.9-13.94A10 10 0 0 1 27 11.5a7.5 7.5 0 0 1 1.5 14.85M18.5 18v14M13.5 22.5l5-5 5 5"
              stroke="#0C0C0C"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="mt-[8.5px] text-16 font-normal leading-[20px] text-ink">
            {uploading ? 'Uploading…' : 'Drop files here or browse'}
          </span>
          {/* The design says "Png, Jpeg up to 500MB". The upload takes PNG, JPEG
              and WebP, and a logo is never 500MB — so this says what is true. */}
          <span className="mt-[3.7px] text-16 font-normal leading-[20px] text-ink-muted">PNG, JPEG or WebP</span>
          <span
            className="mt-[10px] flex h-[35.5px] w-[114.4px] items-center justify-center rounded-[8.4px] bg-white text-16 font-medium text-ink-muted"
            style={{ boxShadow: 'inset 0 0 0 0.561px rgba(12,12,12,0.4)' }}
          >
            Browse files
          </span>
        </div>
      </div>
    </KitSection>
  );
}

/* ── Color Theme ──────────────────────────────────────────────────────── */

/** The design's ten template tiles, less the last, which is "your own". */
const TEMPLATE_COLOURS = ['#0097FD', '#1AFB06', '#6C71FF', '#6CE8FF', '#DAFF6C', '#FF6CBA', '#41FFDC', '#FF6063', '#A341FF'];

/** Positional, as `resolveKit` reads them. */
const COLOUR_ROLE = ['Background', 'Text', 'Accent'];

export function ColorThemeCard({
  colors,
  onChange,
  normalise,
}: {
  colors: string[];
  onChange: (next: string[]) => void;
  /** A stored value as `#rrggbb`, for the native input that can show nothing else. */
  normalise: (c: string) => string;
}) {
  /*
    A template fills the next empty role. With all three set it replaces the
    accent, which is the role a swatch row is usually being used to pick —
    replacing the background on a click would repaint every post.
  */
  const pick = (c: string) => onChange(colors.length < 3 ? [...colors, c] : [colors[0]!, colors[1]!, c]);

  return (
    <KitSection title="Color Theme" rule={61.8} style={{ minHeight: 321.6 }}>
      {/* Row at 80.8: the label, then three 35.9 swatches from 176 on an 8px pitch. */}
      <div className="mt-[18px] flex h-[38.5px] items-center gap-[17.3px]">
        <span className="w-[136px] shrink-0 text-18 font-normal text-ink">Selected Colors</span>
        <div className="flex items-center gap-[8px]">
          {colors.length === 0 ? <span className="text-14 text-ink-muted">Pick from the templates below</span> : null}
          {colors.map((c, i) => (
            <span key={`${c}-${i}`} className="group relative block h-[35.9px] w-[35.9px]">
              {/* The swatch is its own editor: a native colour input laid over it. */}
              <label
                className="block h-full w-full cursor-pointer rounded-[10px]"
                style={{ background: c, boxShadow: `inset 0 0 0 1.258px ${LINE}` }}
                title={`${COLOUR_ROLE[i] ?? 'Extra'} — ${c}. Click to change.`}
              >
                <input
                  type="color"
                  value={normalise(c)}
                  onChange={(e) => onChange(colors.map((x, j) => (j === i ? e.target.value : x)))}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  aria-label={`${COLOUR_ROLE[i] ?? 'Extra'} colour`}
                />
              </label>
              {/* The design's 17.2px badge at the swatch's top right, × in #F35525. */}
              <button
                type="button"
                onClick={() => onChange(colors.filter((_, j) => j !== i))}
                aria-label={`Remove ${COLOUR_ROLE[i]?.toLowerCase() ?? 'colour'} ${c}`}
                className="absolute -right-[6px] -top-[2.5px] flex h-[17.2px] w-[17.2px] items-center justify-center rounded-[4.8px] bg-white opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                style={{ boxShadow: `inset 0 0 0 0.603px ${LINE}` }}
              >
                <svg width="7" height="7" viewBox="0 0 7 7" fill="none" aria-hidden>
                  <path d="m1 1 5 5M6 1 1 6" stroke="#F35525" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* 574.5x153.3 white at 146, radius 11.4; tiles at 20.6,85 on a 54.5 pitch. */}
      <div className="relative mt-[26.7px] h-[153.3px] rounded-[11.4px] bg-white">
        <span className="absolute left-[17.2px] top-[16.3px] text-20 font-medium text-ink-muted">Colors templates</span>
        <div className="absolute left-[20.6px] right-[12px] top-[85px] flex flex-wrap gap-[11.85px]">
          {TEMPLATE_COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => pick(c)}
              title={colors.length < 3 ? `Use ${c} as ${COLOUR_ROLE[colors.length]?.toLowerCase()}` : `Use ${c} as accent`}
              className="h-[42.66px] w-[42.66px] rounded-[11.85px] transition-transform hover:scale-105"
              style={{ background: c, boxShadow: `inset 0 0 0 1.496px ${LINE}` }}
            />
          ))}
          <label
            className="relative flex h-[42.66px] w-[42.66px] cursor-pointer items-center justify-center rounded-[11.85px]"
            style={{ boxShadow: 'inset 0 0 0 1.496px rgba(12,12,12,0.4)' }}
            title="Your own colour"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path d="M12.6 3.6 16.4 7.4M3 17l1-4.2L13.9 2.9a1.6 1.6 0 0 1 2.3 0l.9.9a1.6 1.6 0 0 1 0 2.3L7.2 16 3 17Z" stroke="#838383" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
            <input
              type="color"
              defaultValue="#A341FF"
              onChange={(e) => pick(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Add your own colour"
            />
          </label>
        </div>
      </div>
    </KitSection>
  );
}

/* ── Brand Voice ──────────────────────────────────────────────────────── */

export type Tone = { formal: number; playful: number; technical: number; bold: number };

export const TONE_AXES = [
  { key: 'formal', label: 'Formal', low: 'Casual', high: 'Formal' },
  { key: 'playful', label: 'Playful', low: 'Serious', high: 'Playful' },
  { key: 'technical', label: 'Technical', low: 'Plain', high: 'Technical' },
  { key: 'bold', label: 'Bold', low: 'Measured', high: 'Bold' },
] as const;

/**
 * The dropdown's entries. Each is a point in the same four-axis tone space the
 * sliders write, so choosing one is exactly a slider preset and the agent reads
 * no new field. Named in the design's "Calm/Formal" pattern.
 */
const VOICE_PRESETS: ReadonlyArray<{ name: string; tone: Tone }> = [
  { name: 'Calm/Formal', tone: { formal: 0.8, playful: 0.2, technical: 0.5, bold: 0.3 } },
  { name: 'Friendly/Casual', tone: { formal: 0.25, playful: 0.7, technical: 0.3, bold: 0.5 } },
  { name: 'Bold/Confident', tone: { formal: 0.5, playful: 0.4, technical: 0.4, bold: 0.85 } },
  { name: 'Expert/Technical', tone: { formal: 0.7, playful: 0.2, technical: 0.85, bold: 0.5 } },
  { name: 'Playful/Witty', tone: { formal: 0.2, playful: 0.9, technical: 0.2, bold: 0.7 } },
];

/** Past this distance from the middle an axis is a trait worth naming. */
const LEAN = 0.15;

const matchPreset = (t: Tone) =>
  VOICE_PRESETS.find((p) => TONE_AXES.every((a) => Math.abs(p.tone[a.key] - t[a.key]) < 0.02));

export function VoiceCard({ tone, onChange }: { tone: Tone; onChange: (next: Tone) => void }) {
  const preset = matchPreset(tone);
  /*
    The chips are the traits the tone actually has — each axis that leans,
    named by the side it leans to. × returns that axis to the middle, so a chip
    removed is a trait the agent stops leaning into, not a word deleted from a
    list it never read.
  */
  const traits = TONE_AXES.filter((a) => Math.abs(tone[a.key] - 0.5) >= LEAN).map((a) => ({
    key: a.key,
    label: tone[a.key] > 0.5 ? a.high : a.low,
  }));

  return (
    <KitSection title="Brand Voice" rule={71} style={{ minHeight: 272 }}>
      <label htmlFor="gov-voice-preset" className="mt-[18px] block text-18 font-medium leading-[23px] text-ink">
        Select Brand Voice:
      </label>
      {/* 576x57 white at 128, radius 10; the value at 21 in 18/500. */}
      <div className="relative mt-[15px] h-[57px] rounded-[10px] bg-white">
        <select
          id="gov-voice-preset"
          value={preset?.name ?? ''}
          onChange={(e) => {
            const p = VOICE_PRESETS.find((x) => x.name === e.target.value);
            if (p) onChange(p.tone);
          }}
          className="h-full w-full cursor-pointer appearance-none rounded-[10px] bg-transparent pl-[21px] pr-[48px] text-18 font-medium text-ink outline-none focus-visible:shadow-[0_0_0_2px_var(--ss-primary)]"
        >
          {preset ? null : <option value="">Custom</option>}
          {VOICE_PRESETS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <Chevron className="pointer-events-none absolute right-[24px] top-1/2 -translate-y-1/2" colour="#0C0C0C" />
      </div>

      <div className="mt-[17px] flex flex-wrap gap-[8px]">
        {traits.length === 0 ? (
          <span className="flex h-[44px] items-center text-16 text-ink-muted">Balanced — no strong lean</span>
        ) : null}
        {traits.map((t) => (
          <span
            key={t.key}
            className="flex h-[44px] items-center gap-[14px] rounded-[10.4px] bg-white pl-[15px] pr-[13px] text-16 font-medium text-ink-muted"
            style={{ boxShadow: `inset 0 0 0 0.692px ${LINE}` }}
          >
            {t.label}
            <button
              type="button"
              onClick={() => onChange({ ...tone, [t.key]: 0.5 })}
              aria-label={`Stop leaning ${t.label.toLowerCase()}`}
              className="flex h-[12.8px] w-[12.8px] items-center justify-center text-ink-muted hover:text-ink"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                <path d="m1 1 9 9M10 1 1 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        ))}
      </div>
    </KitSection>
  );
}

/* ── Typography Style ─────────────────────────────────────────────────── */

export function TypographyCard({
  display,
  onChange,
}: {
  display: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const chosen = BRAND_FONTS.find((f) => f.id === display);
  return (
    <KitSection title="Typography Style" rule={61.8} style={{ minHeight: 272 }}>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href={GOOGLE_CSS} />

      {/* Row at 79.9, 42 tall: the label left, the face itself right in 36/700. */}
      <div className="mt-[18px] flex h-[42px] items-center justify-between gap-4 pl-[3px]">
        <span className="shrink-0 text-18 font-normal text-ink">Selected Font</span>
        <span
          className="truncate text-36 font-bold leading-[42px] text-ink [@container(max-width:420px)]:text-24"
          style={{ fontFamily: fontStack(display) }}
          title={chosen?.note}
        >
          {chosen?.label ?? 'System'}
        </span>
      </div>

      {/* 580x72 white at 156, radius 11.4; the face's name at 21 in 20/500 muted. */}
      <div className="relative mt-[34px] h-[72px] rounded-[11.4px] bg-white">
        <select
          aria-label="Headline font"
          value={display ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="h-full w-full cursor-pointer appearance-none rounded-[11.4px] bg-transparent pl-[21px] pr-[48px] text-20 font-medium text-ink-muted outline-none focus-visible:shadow-[0_0_0_2px_var(--ss-primary)]"
          style={display ? { fontFamily: fontStack(display) } : undefined}
        >
          <option value="">System default</option>
          {BRAND_FONTS.filter((f) => f.role !== 'body').map((f) => (
            <option key={f.id} value={f.id} style={{ fontFamily: fontStack(f.id) }}>
              {f.label}
            </option>
          ))}
        </select>
        <Chevron className="pointer-events-none absolute right-[26px] top-1/2 -translate-y-1/2" colour="#838383" />
      </div>
    </KitSection>
  );
}

/* ── The four, in the design's two rows ───────────────────────────────── */

export function BrandKitGrid({ children }: { children: [React.ReactNode, React.ReactNode, React.ReactNode, React.ReactNode] }) {
  const [logo, colour, voice, type] = children;
  return (
    <>
      <KitRow>
        {logo}
        {colour}
      </KitRow>
      <KitRow>
        {voice}
        {type}
      </KitRow>
    </>
  );
}

function Chevron({ className, colour }: { className?: string; colour: string }) {
  return (
    <svg className={className} width="16" height="9" viewBox="0 0 16 9" fill="none" aria-hidden>
      <path d="m1 1 7 7 7-7" stroke={colour} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
