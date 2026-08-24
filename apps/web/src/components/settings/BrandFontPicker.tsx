'use client';

import { BRAND_FONTS, fontStack } from '@sparksocial/shared';

/**
 * BRAND TYPE — M4's control, the prototype's "Choose Fonts".
 *
 * Two selects, display and body, over the faces the renderers can actually
 * resolve. The list is `BRAND_FONTS` from `@sparksocial/shared`, imported rather
 * than mirrored: a face this picker offered and the render path could not fetch
 * would be a setting that saved cleanly and changed no pixel, which is the exact
 * failure the enum exists to prevent.
 *
 * ── The preview is the point ──────────────────────────────────────────────
 *
 * A dropdown of font names is a list of words. Each option is *set in its own
 * face*, and the sample below shows the pair together on the brand's own colours,
 * because the mistake this control invites is a display face that looks fine in a
 * list and is unreadable at caption size.
 *
 * That requires the browser to have the faces, which it does not by default — so
 * the stylesheet below loads all six at once. Six families is a real cost and it
 * is paid only on this panel, which is the one screen where seeing them is the
 * whole task.
 *
 * ── Why "System default" is an option and not a blank ─────────────────────
 *
 * Clearing a choice is a thing owners do, and a select whose empty state is an
 * unlabelled blank row reads as broken. It also names what happens: the renderers
 * fall back to a system stack, which is what every brand rendered on before this
 * column existed.
 */

const GOOGLE_CSS = `https://fonts.googleapis.com/css2?${BRAND_FONTS.map(
  (f) => `family=${encodeURIComponent(f.family).replace(/%20/g, '+')}:wght@${f.weight}`,
).join('&')}&display=swap`;

export interface BrandFontsValue {
  display?: string;
  body?: string;
}

export function BrandFontPicker({
  value,
  onChange,
  /** The brand's own ground and type colours, so the sample is shown where it will be read. */
  ground,
  type,
}: {
  value: BrandFontsValue;
  onChange: (next: BrandFontsValue) => void;
  ground?: string;
  type?: string;
}) {
  // What the renderer will do, not what was typed: an unset body face falls back
  // to the display face, so the sample has to show that rather than a system font.
  const displayStack = fontStack(value.display);
  const bodyStack = fontStack(value.body ?? value.display);

  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href={GOOGLE_CSS} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          id="gov-font-display"
          label="Headlines"
          hint="Text-only posts and titles"
          value={value.display}
          onChange={(id) => onChange({ ...value, display: id })}
          filter={(role) => role !== 'body'}
        />
        <Select
          id="gov-font-body"
          label="Captions"
          hint={value.display && !value.body ? 'Following your headline font' : 'Running text on posts'}
          value={value.body}
          onChange={(id) => onChange({ ...value, body: id })}
          filter={() => true}
        />
      </div>

      {/* One sample, both faces, on the brand's own colours — the only check that
          catches a display face nobody can read at caption size. */}
      <div
        className="mt-3 rounded-lg border border-border p-4"
        style={{ backgroundColor: ground ?? '#0C0C0C' }}
      >
        <p
          className="text-[22px] leading-tight"
          style={{ color: type ?? '#FFFFFF', fontFamily: displayStack }}
        >
          Open late on Thursdays
        </p>
        <p className="mt-2 text-[14px]" style={{ color: type ?? '#FFFFFF', fontFamily: bodyStack }}>
          Book a chair before Friday and the first cut is on us — walk-ins welcome after six.
        </p>
      </div>
    </div>
  );
}

function Select({
  id,
  label,
  hint,
  value,
  onChange,
  filter,
}: {
  id: string;
  label: string;
  hint: string;
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  /** Playfair and Oswald thin out at caption size, so they are offered for headlines only. */
  filter: (role: string) => boolean;
}) {
  const options = BRAND_FONTS.filter((f) => filter(f.role));
  const chosen = BRAND_FONTS.find((f) => f.id === value);

  return (
    <div>
      <label className="block text-[12px] text-ink-muted" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="mt-1.5 w-full rounded-lg border border-border bg-field px-3 py-2 text-[14px] text-ink"
        // Set in the chosen face, so the closed select shows the type rather
        // than only naming it.
        style={value ? { fontFamily: fontStack(value) } : undefined}
      >
        <option value="">System default</option>
        {options.map((f) => (
          // `style` on an `<option>` is honoured by every browser this app
          // supports; where it is not, the name is still correct.
          <option key={f.id} value={f.id} style={{ fontFamily: fontStack(f.id) }}>
            {f.label}
          </option>
        ))}
      </select>
      {/* The chosen face's own note replaces the generic hint — "Headlines only,
          it thins out at small sizes" is the thing worth reading once a choice
          is made. */}
      <p className="mt-1 text-[12px] text-ink-muted">{chosen?.note ?? hint}</p>
    </div>
  );
}
