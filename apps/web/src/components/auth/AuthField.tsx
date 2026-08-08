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
      <div className="flex items-baseline justify-between">
        <Label htmlFor={fieldId}>{label}</Label>
        {hint ? <span className="text-[14px] text-ink-muted">{hint}</span> : null}
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
