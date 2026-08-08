import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1.5 font-semibold', {
  variants: {
    variant: {
      // The prototype's "1,200 credits" chip on the plan card.
      credits: 'rounded-[5px] bg-[#DCF2F6] px-2 py-1 text-[14px] text-ink-muted',
      neutral: 'rounded-full bg-surface-muted px-3 py-1 text-[14px] text-ink-muted',
      success: 'rounded-full bg-success/15 px-3 py-1 text-[14px] text-success',
      warn: 'rounded-full bg-warn/15 px-3 py-1 text-[14px] text-warn',
    },
  },
  defaultVariants: { variant: 'neutral' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
