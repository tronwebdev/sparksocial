import { Input, type InputProps } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Label + field + inline error, at the prototype's 6px label gap.
 *
 * `error` renders under the field and flips the ring red. Clerk returns errors
 * keyed by `meta.paramName`, so the screens map them onto the matching field
 * rather than dumping a raw message at the top of the form.
 */
export interface AuthFieldProps extends InputProps {
  label: string;
  hint?: React.ReactNode;
  error?: string | undefined;
}

export function AuthField({ label, hint, error, id, ...inputProps }: AuthFieldProps) {
  const fieldId = id ?? `f_${label.toLowerCase().replace(/\s+/g, '_')}`;
  return (
    <div className="flex flex-col gap-1.5">
      {/* The captures set field labels at 13px in full-strength ink, not the
          18px muted default the prototype used. */}
      <div className="flex items-baseline justify-between">
        <Label htmlFor={fieldId} className="text-[13px] text-ink">
          {label}
        </Label>
        {hint ? <span className="text-[13px] text-ink-muted">{hint}</span> : null}
      </div>
      <Input id={fieldId} invalid={Boolean(error)} {...inputProps} />
      {error ? (
        <p role="alert" className="text-[14px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The eye-with-slash on every password field in the captures. A real button so
 * it is reachable by keyboard, but out of the tab order for screen readers'
 * benefit it keeps an explicit label rather than relying on the icon.
 */
export function RevealToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? 'Hide password' : 'Show password'}
      className="flex h-6 w-6 items-center justify-center rounded text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring"
    >
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path
          d="M1.7 10S4.9 4.6 10 4.6 18.3 10 18.3 10 15.1 15.4 10 15.4 1.7 10 1.7 10Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="10" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.4" />
        {!shown ? <path d="M3.5 16.5 16.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /> : null}
      </svg>
    </button>
  );
}

export const PersonIcon = () => (
  <svg width="16" height="20" viewBox="0 0 16 20" fill="none" aria-hidden>
    <circle cx="8" cy="4.6" r="3.8" stroke="rgba(12,12,12,0.4)" strokeWidth="1.5" />
    <path d="M1 19c.5-4.4 3.4-7.4 7-7.4s6.5 3 7 7.4" stroke="rgba(12,12,12,0.4)" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const MailIcon = () => (
  <svg width="20" height="16" viewBox="0 0 20 16" fill="none" aria-hidden>
    <rect x="0.8" y="0.8" width="18.4" height="14.4" rx="3" stroke="rgba(12,12,12,0.4)" strokeWidth="1.5" />
    <path
      d="m2.5 3.5 7.5 5.5 7.5-5.5"
      stroke="rgba(12,12,12,0.4)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const LockIcon = () => (
  <svg width="18" height="20" viewBox="0 0 18 20" fill="none" aria-hidden>
    <rect x="1" y="8" width="16" height="11" rx="3" stroke="rgba(12,12,12,0.4)" strokeWidth="1.5" />
    <path d="M5 8V5.5a4 4 0 0 1 8 0V8" stroke="rgba(12,12,12,0.4)" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
