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
/**
 * `fieldSize` exists because the Figma auth captures measure a **56px** field
 * with 16px text, while the 69px above is the prototype's number and still what
 * 29 other files render. Overriding the height from a caller's `className` would
 * not reach the inner `<input>`'s font-size, and changing the default would
 * silently restyle every screen that has no Figma reference yet — so this is an
 * additive prop with the existing behaviour as the default.
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  leadingIcon?: React.ReactNode;
  trailingSlot?: React.ReactNode;
  invalid?: boolean;
  fieldSize?: 'default' | 'auth';
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, leadingIcon, trailingSlot, invalid, fieldSize = 'default', ...props }, ref) => (
    <div
      data-invalid={invalid ? 'true' : undefined}
      className={cn(
        // `ss-field` carries the focus/invalid ring — see the rule in tokens.css
        // for why it is plain CSS rather than composed Tailwind variants.
        'ss-field flex w-full items-center rounded-lg bg-input transition-[outline-color]',
        fieldSize === 'auth' ? 'h-auth-control gap-3 px-4' : 'h-[69px] gap-[15px] px-5',
        className,
      )}
    >
      {leadingIcon ? <span className="shrink-0 text-ink-muted">{leadingIcon}</span> : null}
      <input
        type={type}
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          // 18px / #838383 for field text at every size — the project spec puts
          // labels and input text on the same step, so `fieldSize` governs the
          // box (height, padding, icon gap) and never the type.
          'h-full w-full min-w-0 border-0 bg-transparent p-0 text-18 text-ink-muted',
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
