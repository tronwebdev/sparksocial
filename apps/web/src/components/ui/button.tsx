import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Measurements are the design's, not shadcn's defaults. `active:scale-[0.99]`
 * comes from the prototype — it reads as a deliberate press affordance, so it
 * survives the port.
 *
 * `cta` was 69px tall with a 20px radius, taken from
 * `ui build/SparkSocial Auth.dc.html`. The Figma capture measures **56px with a
 * 15px radius** (`ui_screenshot/login.png`, button spans y 566.5→622.5 at the
 * card's full 376px content width). Changing it in place rather than adding a
 * variant is safe *because* `size="cta"` appears only on the four auth screens
 * and `OrgGuard` — verified, not assumed. Any wider use would have made this a
 * new variant instead.
 */
/*
 * The prototype's button vocabulary, not a component library's.
 *
 * The screens drawn in `ui build/*.dc.html` use three buttons: a solid ink one,
 * a white one inside a soft `rgba(131,131,131,0.4)` inset hairline at a 10px
 * radius (hovering to `#F4F5F7`), and a quiet text one. These variants were a
 * library's — a hard 1px `border-border` outline on a small radius — so every
 * screen built without a prototype (Brand Kit panels, the organisation pages,
 * the engagement actions) read as a different product from the ones built to
 * one. The variant names are unchanged, so no call site moves.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-all ' +
    'disabled:pointer-events-none disabled:opacity-50 active:scale-[0.99] ' +
    'focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-[--ss-primary-hover]',
        secondary: 'bg-white text-ink shadow-[inset_0_0_0_1px_rgba(131,131,131,0.4)] hover:bg-[#F4F5F7]',
        ghost: 'bg-transparent text-ink-muted hover:bg-[rgba(131,131,131,0.08)] hover:text-ink',
        outline: 'bg-white text-ink shadow-[inset_0_0_0_1px_rgba(131,131,131,0.4)] hover:bg-[#F4F5F7]',
        danger: 'bg-destructive text-destructive-foreground hover:opacity-90',
      },
      size: {
        // `cta` is the auth-screen button: 56px tall, 15px radius, 17px label.
        /* `height: 69; border-radius: 20; font: 500 22px` on the prototype. */
        cta: 'h-auth-control rounded-xl px-6 text-22 font-medium',
        default: 'h-11 rounded-[10px] px-[18px] text-15',
        sm: 'h-9 rounded-[9px] px-[14px] text-14',
        icon: 'h-10 w-10 rounded-[10px]',
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
