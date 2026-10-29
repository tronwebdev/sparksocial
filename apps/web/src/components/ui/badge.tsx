import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1.5 font-semibold', {
  variants: {
    variant: {
      // The prototype's "1,200 credits" chip on the plan card.
      credits: 'rounded-[5px] bg-[#DCF2F6] px-2 py-1 text-14 text-ink-muted',
      /*
       * The prototype's status chips (the Command Center queue's "Approved",
       * "Waiting for approval"): a tint, a ring in the same hue, an 8px radius.
       * These were rounded-full pastel pills, a library's badge rather than the
       * design's.
       */
      neutral:
        'rounded-[8px] bg-[rgba(131,131,131,0.08)] px-[10px] py-[3px] text-13 text-ink-muted shadow-[inset_0_0_0_1px_rgba(131,131,131,0.3)]',
      success: 'rounded-[8px] bg-[#E9F9E7] px-[10px] py-[3px] text-13 text-[#13A711] shadow-[inset_0_0_0_1px_#13D711]',
      warn: 'rounded-[8px] bg-[#FFF6E9] px-[10px] py-[3px] text-13 text-[#E48915] shadow-[inset_0_0_0_1px_#FFB453]',
      // Added for PRD §10's connection health: an expired token is a failure,
      // not a caution, and rendering it amber alongside "expiring" would make
      // the two states look like degrees of the same thing rather than
      // "act soon" versus "already broken".
      destructive:
        'rounded-[8px] bg-[#FFF1EC] px-[10px] py-[3px] text-13 text-[#E14A1A] shadow-[inset_0_0_0_1px_rgba(243,85,37,0.6)]',
    },
  },
  defaultVariants: { variant: 'neutral' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
