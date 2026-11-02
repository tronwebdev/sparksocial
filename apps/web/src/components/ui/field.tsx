'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * The product's form controls, in the prototypes' vocabulary.
 *
 * ── Why this exists alongside `Input` ─────────────────────────────────────
 *
 * `Input` is the onboarding/auth field: 69px, a filled `--ss-field` box, 18px
 * muted text. It is right where it is drawn and wrong everywhere else — on a
 * settings panel (`--ss-panel`, the same #F3F4F8) it is the panel's own colour
 * and vanishes. Every screen without a prototype then invented its own box:
 * `h-8 rounded border border-border bg-input`, `h-9 … shadow-[inset…0.22]`,
 * `h-10 rounded border bg-surface`, a native date input with no frame at all.
 * Seven treatments of one thing is what "the input fields are not uniform" was.
 *
 * What the designs actually draw, wherever a value is typed or chosen, is one
 * box — white, a 1px inset hairline, no stroke — at three heights:
 *
 *   sm  44  toolbars, filters, inline rows   Automation/Discovery search (46,
 *                                            15/500), Team/Import search (43,
 *                                            16/500), Brand Kits chips (44)
 *   md  54  a labelled field on a panel      Assets Library File Name (54,
 *           or in a modal                    15.5/500), Brand Kits Restricted
 *                                            Topics / Watermark rows (54–55)
 *   lg  58  the wizard's fields              Automation Frequency / Start date
 *                                            (58, 16.5/500, padding 0 20)
 *
 * The rule for picking one: a labelled field is `md`; a control sharing a row
 * with a button or other controls is `sm`; the automation/campaign wizards are
 * `lg`.
 *
 * ── Two tones, one box ────────────────────────────────────────────────────
 *
 * The 26 Settings prototypes set their type larger and lighter than the rest
 * of the product: labels 18/500 ink over 18/500 field text (Overview, Personal
 * Profile, the Team modals, Brand Kits' "Restricted Topics and phrases"), a
 * 16/500 search, r10 corners and a 0.2 hairline. Everywhere else labels are
 * 600 and a step smaller (Automation's 16.5/600, Assets' 15.5/600) on r12 and
 * 0.28. Radius and hairline follow `.ss-settings` in CSS; type cannot (it is
 * the fluid Tailwind scale), so `SettingsShell` sets `ControlToneProvider`
 * and the type maps below read it.
 *
 * Focus is the app's one 1.5px purple ring (`.ss-field`), the same as `Input`.
 */

export type ControlSize = 'sm' | 'md' | 'lg';
export type ControlTone = 'product' | 'settings';

const ToneContext = React.createContext<ControlTone>('product');

/** Sets the type tone for every control below it. `SettingsShell` uses it. */
export function ControlToneProvider({ tone, children }: { tone: ControlTone; children: React.ReactNode }) {
  return <ToneContext.Provider value={tone}>{children}</ToneContext.Provider>;
}

export function useControlTone(): ControlTone {
  return React.useContext(ToneContext);
}

/** Height, inline padding and type — kept apart because a wrapped control puts
 *  the height on the frame and the rest on the element inside it. */
const H: Record<ControlSize, string> = {
  sm: 'h-control-sm',
  md: 'h-control-md',
  lg: 'h-control-lg',
};
const PX: Record<ControlSize, string> = {
  sm: 'px-4',
  md: 'px-[18px]',
  lg: 'px-5',
};
const TYPE: Record<ControlTone, Record<ControlSize, string>> = {
  product: { sm: 'text-15', md: 'text-16', lg: 'text-17' },
  settings: { sm: 'text-16', md: 'text-18', lg: 'text-18' },
};

/** The same steps for a box that holds an absolutely-placed trailing icon. */
const TRAIL_PAD: Record<ControlSize, string> = {
  sm: 'pr-10',
  md: 'pr-11',
  lg: 'pr-12',
};
const TRAIL_POS: Record<ControlSize, string> = {
  sm: 'right-4',
  md: 'right-[18px]',
  lg: 'right-5',
};

/** Text inside the box: 500 ink on the placeholder grey (`.ss-settings`
 *  re-points the placeholder to the settings prototypes' #838383). */
const TEXT = 'font-medium text-ink placeholder:text-ink-placeholder';

/**
 * The class string for the box itself, for the rare control that is not one of
 * the components below (a custom trigger, a read-only value) but must still
 * read as a field.
 */
export function controlClass(size: ControlSize = 'md', className?: string, tone: ControlTone = 'product') {
  return cn(
    'ss-control ss-field w-full outline-none transition-[outline-color]',
    H[size],
    PX[size],
    TYPE[tone][size],
    TEXT,
    className,
  );
}

/* ── Label ─────────────────────────────────────────────────────────────── */

/**
 * The label over a control. Product: 600 ink, 9px above — Automation's
 * `font-size:16.5px;font-weight:600` + `margin-top:9px`, Assets' 15.5/600.
 * Settings: 18/500 ink, 10px above (`ModalField`, Overview, Brand Kits).
 * `sm` steps each down for filter rows; no design draws a labelled 44px field.
 */
const LABEL: Record<ControlTone, Record<ControlSize, string>> = {
  product: {
    sm: 'mb-1.5 text-14 font-semibold',
    md: 'mb-[9px] text-16 font-semibold',
    lg: 'mb-[9px] text-17 font-semibold',
  },
  settings: {
    sm: 'mb-2 text-16 font-medium',
    md: 'mb-[10px] text-18 font-medium',
    lg: 'mb-[10px] text-18 font-medium',
  },
};

export const FieldLabel = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement> & { size?: ControlSize }
>(({ size = 'md', className, ...props }, ref) => {
  const tone = useControlTone();
  return <label ref={ref} className={cn('block text-ink', LABEL[tone][size], className)} {...props} />;
});
FieldLabel.displayName = 'FieldLabel';

/**
 * `FieldLabel`'s type on a `<span>`, for a `<label>` that wraps its control —
 * a nested `<label>` would be invalid, and the caption must still match.
 */
export function FieldCaption({
  size = 'md',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { size?: ControlSize }) {
  const tone = useControlTone();
  return <span className={cn('block text-ink', LABEL[tone][size], className)} {...props} />;
}

/** Help text under a control — Automation's 14.5/500, 9px below. */
export function FieldHint({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-2 text-14 font-medium text-ink-muted', className)} {...props} />;
}

/* ── Text ──────────────────────────────────────────────────────────────── */

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  fieldSize?: ControlSize;
  leadingIcon?: React.ReactNode;
  trailingSlot?: React.ReactNode;
  invalid?: boolean;
  /** Extra classes for the `<input>` when an icon makes `className` the frame. */
  inputClassName?: string;
}

/**
 * A text-like `<input>` in the control box. Without icons the input *is* the
 * box, so `className` (width, `tabular-nums`, margins) lands on it directly;
 * with an icon the box becomes a wrapper and `className` lands there instead —
 * either way `className` is the box.
 */
export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  ({ fieldSize = 'md', leadingIcon, trailingSlot, invalid, className, inputClassName, ...props }, ref) => {
    const tone = useControlTone();
    if (!leadingIcon && !trailingSlot) {
      return (
        <input
          ref={ref}
          data-invalid={invalid ? 'true' : undefined}
          aria-invalid={invalid || props['aria-invalid'] || undefined}
          className={controlClass(fieldSize, cn('min-w-0', inputClassName, className), tone)}
          {...props}
        />
      );
    }
    return (
      <div
        data-invalid={invalid ? 'true' : undefined}
        className={cn(
          'ss-control ss-field flex w-full items-center gap-2.5 transition-[outline-color]',
          H[fieldSize],
          PX[fieldSize],
          className,
        )}
      >
        {leadingIcon ? <span className="shrink-0 text-control-icon">{leadingIcon}</span> : null}
        <input
          ref={ref}
          aria-invalid={invalid || props['aria-invalid'] || undefined}
          className={cn(
            'h-full w-full min-w-0 bg-transparent p-0 outline-none disabled:cursor-not-allowed',
            TYPE[tone][fieldSize],
            TEXT,
            inputClassName,
          )}
          {...props}
        />
        {trailingSlot ? <span className="shrink-0">{trailingSlot}</span> : null}
      </div>
    );
  },
);
TextField.displayName = 'TextField';

/* ── Textarea ──────────────────────────────────────────────────────────── */

/** Vertical padding, so the first line sits where a single-line field's does. */
const AREA_PAD: Record<ControlSize, string> = {
  sm: 'py-2.5',
  md: 'py-[15px]',
  lg: 'py-[17px]',
};

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  fieldSize?: ControlSize;
  invalid?: boolean;
}

/** The control box, grown downwards. Height comes from `rows` or the caller. */
export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ fieldSize = 'md', invalid, className, ...props }, ref) => {
    const tone = useControlTone();
    return (
      <textarea
        ref={ref}
        data-invalid={invalid ? 'true' : undefined}
        aria-invalid={invalid || props['aria-invalid'] || undefined}
        className={cn(
          'ss-control ss-field block w-full leading-[1.4] outline-none transition-[outline-color]',
          PX[fieldSize],
          AREA_PAD[fieldSize],
          TYPE[tone][fieldSize],
          TEXT,
          className,
        )}
        {...props}
      />
    );
  },
);
TextArea.displayName = 'TextArea';

/* ── Select ────────────────────────────────────────────────────────────── */

/** Automation's dropdown chevron: 13×8, `#5B5B5B` at 1.6. */
function Chevron() {
  return (
    <svg width="13" height="8" viewBox="0 0 13 8" fill="none" aria-hidden className="block">
      <path d="m1 1 5.5 6L12 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface SelectFieldProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  fieldSize?: ControlSize;
  invalid?: boolean;
  /** Extra classes for the `<select>` itself; `className` is the box. */
  selectClassName?: string;
}

/**
 * A native `<select>` in the control box with the design's chevron. Native so
 * keyboard, type-ahead and the mobile picker keep working; the box and the
 * chevron are the only paint.
 */
export const SelectField = React.forwardRef<HTMLSelectElement, SelectFieldProps>(
  ({ fieldSize = 'md', invalid, className, selectClassName, children, ...props }, ref) => {
    const tone = useControlTone();
    return (
      <div
        data-invalid={invalid ? 'true' : undefined}
        className={cn('ss-control ss-field relative w-full transition-[outline-color]', H[fieldSize], className)}
      >
        <select
          ref={ref}
          aria-invalid={invalid || props['aria-invalid'] || undefined}
          className={cn(
            'h-full w-full min-w-0 cursor-pointer appearance-none truncate rounded-[inherit] bg-transparent outline-none disabled:cursor-not-allowed',
            PX[fieldSize],
            TYPE[tone][fieldSize],
            TRAIL_PAD[fieldSize],
            TEXT,
            selectClassName,
          )}
          {...props}
        >
          {children}
        </select>
        <span
          className={cn(
            'pointer-events-none absolute top-1/2 -translate-y-1/2 text-control-chevron',
            TRAIL_POS[fieldSize],
          )}
        >
          <Chevron />
        </span>
      </div>
    );
  },
);
SelectField.displayName = 'SelectField';

/* ── Date / time ───────────────────────────────────────────────────────── */

/** Automation's "Start date" glyph: 18×19, `#838383` at 1.8. */
function CalendarGlyph() {
  return (
    <svg width="18" height="19" viewBox="0 0 24 25" fill="none" aria-hidden className="block">
      <rect x="2.7" y="4.1" width="18.6" height="18.4" rx="4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M2.9 9.9h18.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.1 1.9v3.8M18.5 1.9v3.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Calendar's clock (`SparkSocial Calendar.dc.html`), at the calendar glyph's size. */
function ClockGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden className="block">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4.4V8l2.4 1.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface DateFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  type?: 'date' | 'time' | 'datetime-local' | 'month';
  fieldSize?: ControlSize;
  invalid?: boolean;
  inputClassName?: string;
}

/**
 * A native date/time input in the control box, with the design's calendar (or
 * clock) where the browser would draw its own indicator. The native picker is
 * kept — see `.ss-date-input` in tokens.css for how the drawn icon opens it.
 *
 * An empty field reads in the muted grey, as the design's "DD/MM/YY" does,
 * rather than in ink as if a date were already set.
 */
export const DateField = React.forwardRef<HTMLInputElement, DateFieldProps>(
  ({ type = 'date', fieldSize = 'md', invalid, className, inputClassName, ...props }, ref) => {
    const tone = useControlTone();
    const empty = props.value === '' || (props.value === undefined && props.defaultValue === undefined);
    return (
      <div
        data-invalid={invalid ? 'true' : undefined}
        className={cn('ss-control ss-field relative w-full transition-[outline-color]', H[fieldSize], className)}
      >
        <input
          ref={ref}
          type={type}
          aria-invalid={invalid || props['aria-invalid'] || undefined}
          className={cn(
            'ss-date-input relative h-full w-full min-w-0 appearance-none rounded-[inherit] bg-transparent outline-none disabled:cursor-not-allowed',
            PX[fieldSize],
            TYPE[tone][fieldSize],
            TRAIL_PAD[fieldSize],
            TEXT,
            empty && 'text-ink-muted',
            inputClassName,
          )}
          {...props}
        />
        <span
          className={cn(
            'ss-date-icon pointer-events-none absolute top-1/2 -translate-y-1/2 text-control-icon',
            TRAIL_POS[fieldSize],
          )}
        >
          {type === 'time' ? <ClockGlyph /> : <CalendarGlyph />}
        </span>
      </div>
    );
  },
);
DateField.displayName = 'DateField';

/* ── Checkbox ──────────────────────────────────────────────────────────── */

const CHECK: Record<'sm' | 'md', { box: string; tick: [number, number] }> = {
  // The design's 23px at r6, and a dense-row step at the same proportions.
  md: { box: 'h-[23px] w-[23px] rounded-[6px]', tick: [11, 9] },
  sm: { box: 'h-[18px] w-[18px] rounded-[5px]', tick: [9, 7] },
};

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  checkSize?: 'sm' | 'md';
}

/**
 * Automation's tick box — ink when on, a 1.3px hairline when off — over a real
 * checkbox, so `checked`, `onChange`, `disabled`, `aria-*` and the wrapping
 * `<label>` behave exactly as a native one does.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ checkSize = 'md', className, ...props }, ref) => {
    const spec = CHECK[checkSize];
    return (
      <span className={cn('relative inline-flex shrink-0', spec.box, className)}>
        <input
          ref={ref}
          type="checkbox"
          className="ss-check-input absolute inset-0 z-[1] m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          {...props}
        />
        <span aria-hidden className={cn('ss-check-box flex items-center justify-center transition-colors', spec.box)}>
          <svg
            width={spec.tick[0]}
            height={spec.tick[1]}
            viewBox="0 0 11 9"
            fill="none"
            className="text-primary-foreground opacity-0 transition-opacity"
          >
            <path d="m1 4.5 3 3L10 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </span>
    );
  },
);
Checkbox.displayName = 'Checkbox';

/* ── Switch ────────────────────────────────────────────────────────────── */

export type SwitchProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size' | 'role'>;

/**
 * The settings switch — `PrefRow`'s and Brand Kits' "Activate Watermark":
 * 45×24.3, `#3EC332` on, `rgba(131,131,131,0.2)` off, a 19.5px white knob.
 * A checkbox underneath with `role="switch"`, so an existing `checked` /
 * `onChange` pair moves over unchanged and assistive tech announces on/off.
 */
export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(({ className, ...props }, ref) => (
  <span className={cn('relative inline-flex h-[24.324px] w-[45px] shrink-0', className)}>
    <input
      ref={ref}
      type="checkbox"
      role="switch"
      className="ss-switch-input absolute inset-0 z-[1] m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      {...props}
    />
    <span aria-hidden className="ss-switch-track absolute inset-0 rounded-full transition-colors duration-200" />
    <span
      aria-hidden
      className="ss-switch-knob absolute top-[2.435px] h-[19.459px] w-[19.459px] rounded-full bg-white transition-[left] duration-200"
    />
  </span>
));
Switch.displayName = 'Switch';

/* ── Choice chip ───────────────────────────────────────────────────────── */

export interface ToggleChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  pressed: boolean;
  /**
   * Whether `pressed` is announced as `aria-pressed`. On by default; off for a
   * call site that predates this component and never announced its state, so
   * adopting the look does not change what assistive tech hears.
   */
  announce?: boolean;
}

/**
 * A multi-select option drawn as a pill of the control box: white on the
 * hairline when off, an ink ring when on (`.ss-chip` in tokens.css). 38 tall
 * — Calendar's "Outputs" chips, the one multi-select toggle the designs
 * measure — so a row of them sits under a `sm` field without shouting over it.
 */
export const ToggleChip = React.forwardRef<HTMLButtonElement, ToggleChipProps>(
  ({ pressed, announce = true, className, type = 'button', ...props }, ref) => {
    const tone = useControlTone();
    return (
      <button
        ref={ref}
        type={type}
        aria-pressed={announce ? pressed : undefined}
        data-pressed={pressed ? 'true' : undefined}
        className={cn(
          'ss-control ss-chip inline-flex h-[38px] items-center justify-center gap-1.5 whitespace-nowrap px-4 font-medium text-ink-muted transition-[box-shadow,color]',
          TYPE[tone].sm,
          'hover:text-ink disabled:cursor-not-allowed disabled:opacity-50',
          'focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-ring',
          className,
        )}
        {...props}
      />
    );
  },
);
ToggleChip.displayName = 'ToggleChip';
