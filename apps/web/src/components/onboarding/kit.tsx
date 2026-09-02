'use client';

/**
 * The onboarding form parts, at `ui build/SparkSocial Onboarding.dc.html`'s own
 * numbers.
 *
 * These were previously built from the Figma screenshots and Tailwind's scale,
 * which is why they read as approximate: a 10px radius, a 10.38px chip radius
 * and a 12.76px dropzone radius all collapsed to `rounded-xl`, and a 57px select
 * became `h-[42px]`. The prototype specifies each of them, so each of them is
 * here literally.
 *
 * Every value below is native 1728-canvas px. These render inside `ProtoScale`,
 * which authors at the prototype's 891px column span and scales once — so
 * nothing here is pre-divided, and the relationships between values survive.
 *
 * Colours are the prototype's own: `#F3F4F8` section grounds, `#FFFFFF` fields,
 * `#0C0C0C` primary text, `#838383` secondary, `#F01C1C` destructive,
 * `#F35525` for the swatch remove cross, `#B0B0B0` for the info badge.
 */

/** Section heading — 18px/500, with the 21.6px info badge where the design has one. */
export function SectionLabel({
  children,
  info,
  weight = 500,
  size = 18,
}: {
  children: React.ReactNode;
  info?: string;
  /** "Pick a timezone" and "Enable Strict Compliance" are 700 in the prototype. */
  weight?: 500 | 700;
  size?: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: size, fontWeight: weight, color: '#0C0C0C' }}>{children}</span>
      {info ? (
        <div
          title={info}
          role="img"
          aria-label={info}
          style={{
            width: 21.6,
            height: 21.6,
            borderRadius: '50%',
            boxShadow: 'inset 0 0 0 1.3px #B0B0B0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            color: '#B0B0B0',
            cursor: 'help',
            flexShrink: 0,
          }}
        >
          i
        </div>
      ) : null}
    </div>
  );
}

/** The full-width select: 432×57, radius 10, white, 18px/500, 15×8 chevron. */
export function SelectField({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder,
  width = 432,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  ariaLabel: string;
  placeholder?: string;
  width?: number;
}) {
  return (
    <div style={{ position: 'relative', width, height: 57 }}>
      <select
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          height: 57,
          borderRadius: 10,
          background: '#FFFFFF',
          border: 'none',
          outline: 'none',
          appearance: 'none',
          padding: '0 46px 0 21px',
          fontSize: 18,
          fontWeight: 500,
          lineHeight: 1.269,
          color: value ? '#0C0C0C' : '#838383',
          cursor: 'pointer',
        }}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        width="15"
        height="8"
        viewBox="0 0 15 8"
        fill="none"
        aria-hidden
        style={{ position: 'absolute', left: width - 42, top: 25, display: 'block', pointerEvents: 'none' }}
      >
        <path d="m1 1 6.5 6L14 1" stroke="#0C0C0C" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** The paired timezone selects: 190×49, radius **15**, on `#F3F4F8`. */
export function SmallSelect({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  ariaLabel: string;
  placeholder?: string;
}) {
  return (
    <div style={{ position: 'relative', width: 190, height: 49 }}>
      <select
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          height: 49,
          borderRadius: 15,
          background: '#F3F4F8',
          border: 'none',
          outline: 'none',
          appearance: 'none',
          padding: '0 34px 0 18px',
          fontSize: 18,
          fontWeight: 400,
          color: value ? '#0C0C0C' : '#838383',
          cursor: 'pointer',
        }}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        width="11"
        height="5"
        viewBox="0 0 11 5"
        fill="none"
        aria-hidden
        style={{ position: 'absolute', left: 168, top: 23, display: 'block', pointerEvents: 'none' }}
      >
        <path d="m1 1 4.5 3L10 1" stroke="rgba(12,12,12,0.4)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** 55px tall, radius 10, white, 19px horizontal padding, 18px text. */
export function TextInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  onEnter,
  width = 433,
  disabled,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  ariaLabel: string;
  onEnter?: () => void;
  width?: number | string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      title={title}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) {
          e.preventDefault();
          onEnter();
        }
      }}
      style={{
        width,
        height: 55,
        borderRadius: 10,
        background: '#FFFFFF',
        border: 'none',
        outline: 'none',
        padding: '0 19px',
        fontSize: 18,
        fontWeight: 400,
        color: '#0C0C0C',
        display: 'block',
        opacity: disabled ? 0.5 : 1,
      }}
    />
  );
}

/** 44px tall pill, radius 10.38, hairline ring, 16px/500 label in `#838383`. */
export function TagChip({ children, onRemove }: { children: React.ReactNode; onRemove?: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        height: 44,
        padding: '0 15px',
        borderRadius: 10.38,
        background: '#FFFFFF',
        boxShadow: 'inset 0 0 0 0.69px rgba(12,12,12,0.1)',
      }}
    >
      <span style={{ fontSize: 16, fontWeight: 500, color: '#838383' }}>{children}</span>
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label="Remove" style={{ display: 'block', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}>
          <svg width="12.8" height="12.8" viewBox="0 0 13 13" fill="none" style={{ display: 'block' }} aria-hidden>
            <path d="M1.5 1.5l10 10M11.5 1.5l-10 10" stroke="#838383" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

/** 45×24.3, radius 154, 19px knob. `#3EC332` on, `#E4E4E4` off. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        position: 'relative',
        width: 45,
        height: 24.3,
        borderRadius: 154,
        background: checked ? '#3EC332' : '#E4E4E4',
        border: 'none',
        padding: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 0.2s ease',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2.6,
          left: checked ? 23.4 : 2.6,
          width: 19,
          height: 19,
          borderRadius: '50%',
          background: '#FFFFFF',
          transition: 'left 0.2s ease',
          boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        }}
      />
    </button>
  );
}

/** The `#F3F4F8` section that wraps an upload pair. Radius 10. */
export function UploadSection({ children, width = 547, height }: { children: React.ReactNode; width?: number; height?: number }) {
  return (
    <div style={{ position: 'relative', width, height, borderRadius: 10, background: '#F3F4F8' }}>{children}</div>
  );
}

/** 141×38.1, radius 9.89, white with a hairline ring and the four-stop sparkle. */
export function GenerateButton({
  label,
  onClick,
  disabled,
  title,
  left,
  top,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  left?: number;
  top?: number;
}) {
  const positioned = left !== undefined && top !== undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...(positioned ? { position: 'absolute', left, top } : {}),
        width: 141,
        height: 38.1,
        borderRadius: 9.89,
        background: '#FFFFFF',
        boxShadow: 'inset 0 0 0 0.66px rgba(12,12,12,0.1)',
        border: 'none',
        padding: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <svg width="20" height="19" viewBox="0 0 20 19" style={{ position: 'absolute', left: 10, top: 10, display: 'block' }} aria-hidden>
        <defs>
          <linearGradient id="kit-sparkle" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#6CE8FF" />
            <stop offset="0.27" stopColor="#F56BFF" />
            <stop offset="0.67" stopColor="#A341FF" />
            <stop offset="1" stopColor="#FEDEB5" />
          </linearGradient>
        </defs>
        <path d="M10 0.8 11.9 6.4 17.6 8.3 11.9 10.2 10 15.8 8.1 10.2 2.4 8.3 8.1 6.4Z" fill="url(#kit-sparkle)" />
        <path d="m16.6 12.2.9 2.6 2.5.9-2.5.9-.9 2.5-.9-2.5-2.5-.9 2.5-.9Z" fill="url(#kit-sparkle)" />
      </svg>
      <span style={{ position: 'absolute', left: 37, top: 10.3, fontSize: 14, fontWeight: 500, color: '#0C0C0C' }}>{label}</span>
    </button>
  );
}

/** The 545×1 rule the prototype puts under an upload section's header. */
export function SectionRule({ top, width = 545 }: { top: number; width?: number }) {
  return <div aria-hidden style={{ position: 'absolute', left: 0, top, width, height: 1, background: 'rgba(12,12,12,0.1)' }} />;
}

/**
 * 340×160, radius 12.76, **white** — not the dashed border the earlier version
 * drew. The prototype has no dash anywhere; the affordance is the white panel
 * against the `#F3F4F8` section and a purple ring on hover.
 */
export function DropZone({
  onFile,
  accept,
  formats,
  prompt = 'Drop files here or browse',
  busy,
  disabled,
  title,
  width = 340,
  height = 160,
  left,
  top,
  outlined,
  glyph = 'image',
}: {
  onFile: (file: File) => void;
  accept: string;
  formats: string;
  prompt?: string;
  busy?: boolean;
  disabled?: boolean;
  title?: string;
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  /**
   * The docs drop zone is the one that sits on the white notch card rather than
   * inside an `#F3F4F8` section, so the prototype gives it no fill and a
   * `1.26px` ring instead - white-on-white would be invisible. The other three
   * (logo, avatar, audio) keep the fill.
   */
  outlined?: boolean;
  /** `document` swaps the image glyph for the prototype's file-with-fold. */
  glyph?: 'image' | 'document';
}) {
  const id = `dz-${prompt.replace(/\W+/g, '-').toLowerCase()}`;
  const positioned = left !== undefined && top !== undefined;
  return (
    <div
      title={title}
      onDragOver={(e) => !disabled && e.preventDefault()}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      style={{
        ...(positioned ? { position: 'absolute', left, top } : { position: 'relative' }),
        width,
        height,
        borderRadius: 12.76,
        background: outlined ? 'transparent' : '#FFFFFF',
        boxShadow: outlined ? 'inset 0 0 0 1.26px rgba(12,12,12,0.1)' : undefined,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <svg width="32" height="31" viewBox="0 0 32 31" fill="none" style={{ position: 'absolute', left: width / 2 - 16, top: 22, display: 'block' }} aria-hidden>
        {glyph === 'document' ? (
          <>
            <path d="M8 4h10.5L26 11.5V25a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z" stroke="#0C0C0C" strokeWidth="1.7" strokeLinejoin="round" />
            <path d="M18 4v8h8" stroke="#0C0C0C" strokeWidth="1.7" strokeLinejoin="round" />
            <path d="M15.5 23.5v-6m0 0-2.7 2.7m2.7-2.7 2.7 2.7" stroke="#0C0C0C" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : (
          <>
            <path d="M4 21.5V8.2A4.2 4.2 0 0 1 8.2 4h15.6A4.2 4.2 0 0 1 28 8.2v9.6" stroke="#0C0C0C" strokeWidth="1.7" strokeLinecap="round" />
            <path d="m4 19.5 5.4-5.4a2.6 2.6 0 0 1 3.7 0l6.4 6.4" stroke="#0C0C0C" strokeWidth="1.7" strokeLinecap="round" />
            <circle cx="20.4" cy="10.6" r="2.1" stroke="#0C0C0C" strokeWidth="1.6" />
            <path d="M16 25.5v-6m0 0-2.7 2.7m2.7-2.7 2.7 2.7" stroke="#0C0C0C" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
      </svg>
      <span style={{ position: 'absolute', left: 0, right: 0, top: 63, textAlign: 'center', fontSize: 14, color: '#0C0C0C' }}>{prompt}</span>
      <span style={{ position: 'absolute', left: 0, right: 0, top: 83.7, textAlign: 'center', fontSize: 14, color: '#838383' }}>{formats}</span>
      <label
        htmlFor={id}
        style={{
          position: 'absolute',
          left: width / 2 - 50,
          top: 113,
          width: 100,
          height: 31,
          borderRadius: 7.35,
          background: '#FFFFFF',
          boxShadow: 'inset 0 0 0 0.49px rgba(12,12,12,0.4)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13.8,
          fontWeight: 500,
          color: '#838383',
        }}
      >
        {busy ? 'Uploading…' : 'Browse files'}
        <input
          id={id}
          type="file"
          accept={accept}
          disabled={disabled}
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

/**
 * 129.7×129.7, radius 13.94, on `#F3F4F8` with a 1.38px ring, its label 14px
 * above it and the prototype's `#F01C1C` delete tile inside.
 */
export function PreviewTile({
  label,
  onClear,
  children,
  left,
  top,
}: {
  label: string;
  onClear?: () => void;
  children?: React.ReactNode;
  left?: number;
  top?: number;
}) {
  const positioned = left !== undefined && top !== undefined;
  return (
    <div style={positioned ? { position: 'absolute', left, top } : { position: 'relative' }}>
      <span style={{ position: 'absolute', left: 20, top: -24, fontSize: 14, color: '#838383', whiteSpace: 'nowrap' }}>{label}</span>
      <div
        style={{
          position: 'relative',
          width: 129.7,
          height: 129.7,
          borderRadius: 13.94,
          background: '#F3F4F8',
          boxShadow: 'inset 0 0 0 1.38px rgba(12,12,12,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {children ?? (
          <svg width="42" height="42" viewBox="0 0 42 42" fill="none" aria-hidden style={{ display: 'block' }}>
            <circle cx="34" cy="8" r="7.8" fill="#838383" />
            <path
              d="M0 40.4c0 .7.5 1.2 1.2 1.2h39.2c.7 0 1.2-.5 1.2-1.2V29.1c0-.3-.1-.6-.4-.9l-6.5-6.6a1.2 1.2 0 0 0-1.8 0l-6 6.1c-.5.5-1.3.5-1.8 0L13.9 16.4a1.2 1.2 0 0 0-1.8 0L.4 28.2c-.3.3-.4.6-.4.9v11.3Z"
              fill="#838383"
            />
          </svg>
        )}
        {onClear && children ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Remove ${label.toLowerCase()}`}
            style={{
              position: 'absolute',
              left: 91,
              top: 7.8,
              width: 31,
              height: 31,
              borderRadius: 7.16,
              background: '#F01C1C',
              boxShadow: 'inset 0 0 0 0.48px rgba(12,12,12,0.4)',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="16" height="18" viewBox="0 0 16 18" fill="none" style={{ display: 'block' }} aria-hidden>
              <path
                d="M1 4.5h14M5.5 4.5V3a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 10.5 3v1.5m2.5 0V15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4.5M6.2 8v6M9.8 8v6"
                stroke="#FFFFFF"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** A chosen colour: 38.5px, radius 12.6, with the `#F35525` remove cross. */
export function Swatch({ hex, onRemove }: { hex: string; onRemove?: () => void }) {
  return (
    <div style={{ position: 'relative', width: 38.5, height: 38.5, borderRadius: 12.6, background: hex, boxShadow: 'inset 0 0 0 1.26px rgba(12,12,12,0.1)' }}>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${hex}`}
          style={{
            position: 'absolute',
            right: -6,
            top: -6,
            width: 17.2,
            height: 17.2,
            borderRadius: 4.78,
            background: '#FFFFFF',
            boxShadow: 'inset 0 0 0 0.6px rgba(12,12,12,0.1)',
            border: 'none',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <svg width="7" height="7" viewBox="0 0 7 7" fill="none" style={{ display: 'block' }} aria-hidden>
            <path d="M1 1l5 5M6 1 1 6" stroke="#F35525" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

/** A palette option: 42.7px, radius 11.85. */
export function PaletteSwatch({ hex, onPick }: { hex: string; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`Add ${hex}`}
      style={{ width: 42.7, height: 42.7, borderRadius: 11.85, background: hex, border: 'none', padding: 0, cursor: 'pointer' }}
    />
  );
}

/** The 15px refresh glyph, its 14px/500 label, and the 16px/500 pickable list. */
/**
 * The prototype draws a refresh arc beside the word "Suggestions" and then does
 * nothing with it - its two lists are string constants. A reload glyph that
 * does not reload is the sort of small lie that teaches people to distrust the
 * rest of the screen, so here the row is the button the icon promises: it deals
 * the next four out of a longer pool.
 *
 * The individual suggestions stay clickable to add, which is what the prototype
 * wires (`sug.add`).
 */
export function Suggestions({
  items,
  onPick,
  onRegenerate,
}: {
  items: readonly string[];
  onPick: (value: string) => void;
  onRegenerate?: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onRegenerate}
        disabled={!onRegenerate}
        title={onRegenerate ? 'Show four different suggestions' : undefined}
        style={{
          marginTop: 14,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          paddingLeft: 19,
          background: 'none',
          border: 'none',
          cursor: onRegenerate ? 'pointer' : 'default',
        }}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style={{ display: 'block' }} aria-hidden>
          <path d="M13 7.5a5.5 5.5 0 1 1-1.6-3.9M13 1v3.2h-3.2" stroke="#000000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ fontSize: 14, fontWeight: 500, color: '#838383' }}>Suggestions</span>
      </button>
      <div style={{ marginTop: 9, paddingLeft: 19, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        {items.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.66, color: '#0C0C0C', cursor: 'pointer', background: 'none', border: 'none', padding: 0, textAlign: 'left' }}
          >
            {s}
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * The prototype's four of each come first, so the initial render is the design;
 * the rest are what "Suggestions" deals out on later presses. Guardrails, unlike
 * the palette, are not a closed set - these are the ones that recur across the
 * regulated niches this product sells into.
 */
const RESTRICTED_POOL = [
  'Confidential Information',
  'Sensitive Data',
  'Personal Identifiable Information (PII)',
  'Proprietary Technology',
  'Unreleased products',
  'Staff names and rotas',
  'Customer complaints',
  'Legal disputes',
  'Pricing negotiations',
  'Politics and elections',
  'Religion',
  'Competitor pricing',
] as const;

const CLAIMS_POOL = [
  'Guaranteed results',
  'Medical or health claims',
  'Financial return promises',
  'Competitor disparagement',
  'Cheapest in the market',
  'Clinically proven',
  'Instant results',
  'Risk free',
  'Number one in the area',
  'Award winning',
  'Fully booked urgency',
  'Lifetime guarantee',
] as const;

/** Four at a time, wrapping - `round` is a press count, not an index. */
function deal(pool: readonly string[], round: number): readonly string[] {
  const start = (round * 4) % pool.length;
  return Array.from({ length: 4 }, (_, i) => pool[(start + i) % pool.length] as string);
}

export const guardrailSuggestions = {
  restricted: (round: number) => deal(RESTRICTED_POOL, round),
  claims: (round: number) => deal(CLAIMS_POOL, round),
};

/** The prototype's seven palette entries. The fourth is `--ss-cyan`. */
export const PALETTE = ['#0097FD', '#1AFB06', '#6C71FF', '#6CE8FF', '#DAFF6C', '#FF6CBA', '#41FFDC'] as const;
