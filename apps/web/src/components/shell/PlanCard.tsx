import { Badge } from '@/components/ui/badge';

/**
 * Pinned plan card. Prototype: 282×77 at `left:21 top:1023` — i.e. bottom-anchored,
 * which is what it becomes here rather than an absolute top.
 *
 * Credits are a placeholder until the credit ledger exists (plan §9, P3). Wiring a
 * real number now would mean inventing a source for it.
 */
export function PlanCard() {
  return (
    <div className="mx-[21px] mb-6 rounded-md bg-surface-muted p-4 shadow-hairline max-xl:hidden">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[16px] font-semibold text-ink">Pro Plan</span>
        <Badge variant="credits">1,200 credits</Badge>
      </div>
      <p className="mt-1 text-[14px] text-ink-muted">Renews monthly</p>
    </div>
  );
}
