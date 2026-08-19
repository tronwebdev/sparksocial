import { cn } from '@/lib/utils';
import { SparkMark } from './SparkMark';

/**
 * Logo lockup. Prototype geometry (`Dashboard.dc.html:31-45`): 53.57px mark, then
 * the wordmark in CS Mollwish at 27.49px / line-height 1.13, its left edge at
 * 61.7px — i.e. an 8.13px gap from the mark's trailing edge.
 *
 * "Sparksocial" is one word with a lowercase 's' in the source. It is a wordmark,
 * not a sentence — do not re-case it.
 */
export interface WordmarkProps {
  markSize?: number;
  fontSize?: number;
  className?: string;
  showMark?: boolean;
}

export function Wordmark({ markSize = 53.57, fontSize = 27.49, className, showMark = true }: WordmarkProps) {
  return (
    <div className={cn('flex items-center', className)} style={{ gap: `${8.13 * (markSize / 53.57)}px` }}>
      {showMark ? <SparkMark size={markSize} /> : null}
      <span
        className="font-display text-ink"
        style={{ fontSize: `${fontSize}px`, lineHeight: 1.13, whiteSpace: 'nowrap' }}
      >
        Sparksocial
      </span>
    </div>
  );
}
