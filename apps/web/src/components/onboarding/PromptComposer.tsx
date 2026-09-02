'use client';

import { cn } from '@/lib/utils';

/**
 * The chat-style composer on the two prompt steps — brand name (`…192918`) and
 * company URL (`…193114`).
 *
 * Measured on `…193114` (frame 1440×930): the field runs 353→1103 at y 526.5,
 * **65px tall**, and its left edge settles at x=349.5 by y=552 — a corner profile
 * that solves to r≈30–32 against a 65px height, i.e. a full pill. Inside it: a
 * 26px leading glyph at x≈374, the placeholder from x≈421, and the mic at
 * x≈1069.
 *
 * It is bottom-anchored rather than flowing under the bubble, which is the whole
 * reason `StepShell` takes it as a separate `composer` slot: on these two screens
 * the frame reads as a conversation with a composer at the bottom, not a form.
 *
 * `icon` is the leading glyph — the mark on the brand-name step, a link glyph on
 * the URL step.
 */
export function PromptComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
  icon,
  disabled,
  type = 'text',
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  type?: string;
  autoFocus?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex h-[65px] w-full items-center gap-4 rounded-full bg-white pl-[21px] pr-6',
        'shadow-card',
      )}
    >
      <span className="flex shrink-0 items-center justify-center text-ink-muted">
        {icon ?? <ComposerFaceIcon />}
      </span>

      <input
        type={type}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim() && onSubmit) onSubmit();
        }}
        className="h-full min-w-0 flex-1 border-0 bg-transparent text-18 text-ink outline-none placeholder:text-ink-placeholder disabled:opacity-50"
      />

      {/*
        Dictation is drawn in both captures. It is a real control rather than
        decoration, so it says what it does — but the Web Speech API is not
        wired, and a button that looks live and does nothing is worse than one
        that admits it. Disabled with a title until there is something behind it.
      */}
      <button
        type="button"
        disabled
        title="Voice input is not available yet"
        aria-label="Voice input (unavailable)"
        className="shrink-0 text-ink-muted opacity-40"
      >
        <svg width="18" height="24" viewBox="0 0 18 24" fill="none" aria-hidden>
          <rect x="6" y="1" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.6" />
          <path d="M1.75 10.5a7.25 7.25 0 0 0 14.5 0M9 17.75V23" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/**
 * The two leading glyphs, from `SparkSocial Onboarding.dc.html`.
 *
 * I had been rendering the Spark mark on the brand-name step and a chain-link on
 * the URL step. Neither is what the prototype draws. The brand-name composer
 * carries a *face* outline built from four divs - a ring, a rounded mouth bar
 * and two eyes - and the URL composer carries a globe. Both are authored here at
 * the prototype's native pixels and then scaled by `SHRINK`, so the proportions
 * stay exact rather than being re-guessed against a smaller box.
 *
 * `SHRINK` is 65/77: the composer measures 77px tall on the 1728 canvas and 65px
 * on the frame this shell is built at. It is a ratio between two measured
 * heights, not a fudge factor.
 */
const SHRINK = 65 / 77;

export function ComposerFaceIcon() {
  const n = 40.9;
  return (
    <span
      aria-hidden
      style={{ display: 'block', width: n * SHRINK, height: n * SHRINK }}
    >
      <span
        style={{
          position: 'relative',
          display: 'block',
          width: n,
          height: n,
          transform: `scale(${SHRINK})`,
          transformOrigin: 'top left',
        }}
      >
        <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', boxShadow: 'inset 0 0 0 1.4px #838383' }} />
        <span style={{ position: 'absolute', left: 7.7, top: 14.2, width: 25.5, height: 11.5, borderRadius: 9, boxShadow: 'inset 0 0 0 1.2px #838383' }} />
        <span style={{ position: 'absolute', left: 13.4, top: 18.2, width: 3.6, height: 3.6, borderRadius: '50%', background: '#838383' }} />
        <span style={{ position: 'absolute', left: 24.1, top: 18.2, width: 3.6, height: 3.6, borderRadius: '50%', background: '#838383' }} />
      </span>
    </span>
  );
}

export function ComposerGlobeIcon() {
  const n = 31.4;
  return (
    <svg
      width={n * SHRINK}
      height={n * SHRINK}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      style={{ display: 'block' }}
    >
      <circle cx="16" cy="16" r="14.6" stroke="#000000" strokeWidth="2" />
      <ellipse cx="16" cy="16" rx="6.6" ry="14.6" stroke="#000000" strokeWidth="2" />
      <path d="M2 11h28M2 21h28" stroke="#000000" strokeWidth="2" />
    </svg>
  );
}
