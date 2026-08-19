import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The prototype's field: 69px tall, 15px radius, `--ss-field` background, 20px
 * horizontal padding, 15px gap to a leading icon, and a 1.5px purple focus ring.
 *
 * `leadingIcon` is a first-class prop rather than something callers compose,
 * because every field in the prototype has one and the 15px gap is part of the
 * spec — leaving it to callers guarantees it drifts across screens.
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  leadingIcon?: React.ReactNode;
  trailingSlot?: React.ReactNode;
  invalid?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, leadingIcon, trailingSlot, invalid, ...props }, ref) => (
    <div
      data-invalid={invalid ? 'true' : undefined}
      className={cn(
        // `ss-field` carries the focus/invalid ring — see the rule in tokens.css
        // for why it is plain CSS rather than composed Tailwind variants.
        'ss-field flex h-[69px] w-full items-center gap-[15px] rounded-lg bg-input px-5',
        'transition-[outline-color]',
        className,
      )}
    >
      {leadingIcon ? <span className="shrink-0 text-ink-muted">{leadingIcon}</span> : null}
      <input
        type={type}
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-full w-full min-w-0 border-0 bg-transparent p-0 text-[18px] text-ink',
          'placeholder:text-ink-placeholder focus:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        {...props}
      />
      {trailingSlot ? <span className="shrink-0">{trailingSlot}</span> : null}
    </div>
  ),
);
Input.displayName = 'Input';

export { Input };
