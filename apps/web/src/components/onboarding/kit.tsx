'use client';

import { cn } from '@/lib/utils';

/**
 * The parts the four onboarding card screens share, taken from the captures
 * rather than invented: `…192946` (brand details), `…193059` (docs),
 * `…193155` (brand kit), `…193231` (agent).
 *
 * All four use the same vocabulary — a labelled section, a dashed drop zone, a
 * bordered preview panel beside it, a green switch, removable chips, and a
 * refreshable suggestion list. Building them once is the difference between four
 * screens that agree and four that merely resemble each other.
 *
 * The two-column split is `…193155`'s and `…193231`'s: a 596px and a 436px card
 * respectively, each holding two columns of fields. `…192946` and `…193059` put
 * the drop zone and its preview side by side inside one section.
 */

/** Section heading, with the captures' info affordance where they draw one. */
export function SectionLabel({
  children,
  info,
  trailing,
  className,
}: {
  children: React.ReactNode;
  /** Renders the ⓘ the captures put beside several of these labels. */
  info?: string;
  /** Right-aligned control on the same row — "Generate logo", "Optional". */
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <span className="flex items-center gap-1.5 text-14 font-medium text-ink">
        {children}
        {info ? (
          <span
            role="img"
            aria-label={info}
            title={info}
            className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full border border-border text-[9px] text-ink-muted"
          >
            i
          </span>
        ) : null}
      </span>
      {trailing}
    </div>
  );
}

/** Helper copy under a label. */
export function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-13 leading-[1.5] text-ink-muted">{children}</p>;
}

/**
 * The dashed upload target. Four screens draw it with the same three lines:
 * a cloud glyph, "Drop files here or browse", the accepted formats, and a
 * Browse files button.
 *
 * It is a `<button>` wrapping a hidden `<input type=file>` rather than a styled
 * label, so keyboard users get it for free and drag-and-drop still works.
 */
export function DropZone({
  onFile,
  accept,
  formats,
  prompt = 'Drop files here or browse',
  busy,
  className,
}: {
  onFile: (file: File) => void;
  accept: string;
  /** The captures state the limit explicitly — "Png, Jpeg up to 500MB". */
  formats: string;
  prompt?: string;
  busy?: boolean;
  className?: string;
}) {
  const id = `dz-${prompt.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-border bg-white px-4 py-5 text-center',
        className,
      )}
    >
      <svg width="24" height="18" viewBox="0 0 24 18" fill="none" aria-hidden className="text-ink-muted">
        <path
          d="M6.5 16.5A5.5 5.5 0 0 1 6 5.6a6.5 6.5 0 0 1 12.4 1.6A4.5 4.5 0 0 1 17.5 16.5M12 15V7m0 0-3 3m3-3 3 3"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-13 font-medium text-ink">{prompt}</span>
      <span className="text-13 text-ink-muted">{formats}</span>
      <label
        htmlFor={id}
        className="mt-1.5 cursor-pointer rounded-[8px] border border-border bg-white px-3 py-1.5 text-13 text-ink transition-colors hover:bg-surface-muted"
      >
        {busy ? 'Uploading…' : 'Browse files'}
        <input
          id={id}
          type="file"
          accept={accept}
          className="sr-only"
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
 * The bordered panel beside a drop zone — "Logo Preview", "File Preview",
 * "Avatar Preview". Empty it shows a placeholder glyph; filled it shows the
 * thing plus the captures' red delete button.
 */
export function PreviewPanel({
  label,
  onClear,
  children,
  className,
}: {
  label: string;
  onClear?: () => void;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex w-[104px] shrink-0 flex-col gap-1.5', className)}>
      <span className="text-center text-13 text-ink-muted">{label}</span>
      <div className="relative flex h-[92px] items-center justify-center overflow-hidden rounded-[12px] border border-border bg-white">
        {children ?? (
          <svg width="26" height="24" viewBox="0 0 26 24" fill="none" aria-hidden className="text-ink-placeholder">
            <circle cx="17" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" />
            <path d="M2 21l6.5-8 5 6 3-3.5L24 21H2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        )}
        {onClear && children ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Remove ${label.toLowerCase()}`}
            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-[6px] bg-destructive text-white"
          >
            <svg width="10" height="11" viewBox="0 0 10 11" fill="none" aria-hidden>
              <path d="M1 3h8M3.5 3V1.8h3V3M2.2 3l.5 6.5h4.6L7.8 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** The green switch. On in the captures is `--ss-success`. */
export function Switch({
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
      className={cn(
        'relative h-[22px] w-[40px] shrink-0 rounded-full transition-colors disabled:opacity-40',
        checked ? 'bg-success' : 'bg-border',
      )}
    >
      <span
        className={cn(
          'absolute top-[3px] h-4 w-4 rounded-full bg-white transition-[left]',
          checked ? 'left-[21px]' : 'left-[3px]',
        )}
      />
    </button>
  );
}

/** A removable chip, as the captures draw under Brand Voice and the guardrails. */
export function Chip({ children, onRemove }: { children: React.ReactNode; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[8px] border border-border bg-white px-2 py-1 text-13 text-ink">
      {children}
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label="Remove" className="text-ink-muted hover:text-ink">
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden>
            <path d="M1 1l7 7M8 1l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </span>
  );
}

/**
 * The captures' "⟳ Suggestions" block: a refresh affordance over a list of
 * click-to-add values, fading out down the list.
 *
 * The refresh icon is drawn but inert — the suggestions in the capture are a
 * fixed list, and nothing in the backend generates alternatives. A control that
 * spins and changes nothing is worse than one that does not offer to.
 */
export function Suggestions({
  items,
  onPick,
}: {
  items: readonly string[];
  onPick: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-13 text-ink-muted">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M10.5 6a4.5 4.5 0 1 1-1.3-3.2M10.5 1v2.5H8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        Suggestions
      </span>
      <ul className="flex flex-col">
        {items.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => onPick(s)}
              // The capture fades successive suggestions out; the list is a
              // ranking, not four equal options.
              style={{ opacity: 1 - i * 0.22 }}
              className="text-left text-13 text-ink-muted transition-colors hover:text-ink"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A `<select>` matching the captures' field chrome. */
export function Select({
  value,
  onChange,
  children,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  ariaLabel: string;
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className="ss-field h-[42px] w-full rounded-[10px] border border-border bg-white px-3 text-14 text-ink outline-none"
    >
      {children}
    </select>
  );
}

/** A text input matching the captures' field chrome. */
export function TextField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  onEnter,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  ariaLabel: string;
  onEnter?: () => void;
  className?: string;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) {
          e.preventDefault();
          onEnter();
        }
      }}
      className={cn(
        'ss-field h-[42px] w-full rounded-[10px] border border-border bg-white px-3 text-14 text-ink outline-none placeholder:text-ink-placeholder',
        className,
      )}
    />
  );
}

/** The captures' guardrail lists offer these four, in this order. */
export const GUARDRAIL_SUGGESTIONS = [
  'Confidential Information',
  'Sensitive Data',
  'Personal Identifiable Information (PII)',
  'Proprietary Technology',
] as const;
