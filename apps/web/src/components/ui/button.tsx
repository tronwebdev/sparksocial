import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Measurements are the prototype's, not shadcn's defaults: the primary CTA is
 * 69px tall with a 20px radius (`ui build/SparkSocial Auth.dc.html`), which is
 * considerably larger than shadcn's h-10. `active:scale-[0.99]` is in the source
 * too — it reads as a deliberate press affordance, so it survives the port.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all ' +
    'disabled:pointer-events-none disabled:opacity-50 active:scale-[0.99] ' +
    'focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-[--ss-primary-hover]',
        secondary: 'bg-surface text-ink shadow-[inset_0_0_0_1px_var(--ss-border-strong)] hover:bg-surface-muted',
        ghost: 'bg-transparent text-ink-muted hover:bg-surface-muted hover:text-ink',
        outline: 'bg-transparent text-ink border border-border hover:bg-surface-muted',
        danger: 'bg-destructive text-destructive-foreground hover:opacity-90',
      },
      size: {
        // `cta` is the auth-screen button: 69px tall, 22px label.
        cta: 'h-[69px] rounded-xl px-6 text-[22px]',
        default: 'h-11 rounded px-4 text-base',
        sm: 'h-9 rounded px-3 text-sm',
        icon: 'h-10 w-10 rounded',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
