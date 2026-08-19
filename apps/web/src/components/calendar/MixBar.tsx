'use client';

import { pillarStyle } from './pillars';
import { cn } from '@/lib/utils';

/**
 * THE MIX BAR — engine spec §6.8 Step 4.
 *
 *   *"Review the CALENDAR at mix level, not the posts. … If the user has to open
 *   all 24 posts, the product failed."*
 *
 * This is the primary review surface, which is why it sits above the month grid
 * rather than beside it. A single proportional bar answers the only question
 * Step 4 asks — "is the balance right?" — in one glance, and the counts under it
 * answer the follow-up without a click.
 */

export interface MixSlice {
  pillar: string;
  count: number;
}

export function MixBar({
  mix,
  onAdjust,
  busy,
}: {
  mix: MixSlice[];
  /** Called with the pillar to favour, or to pull back. */
  onAdjust?: (pillar: string, direction: 'more' | 'less') => void;
  busy?: boolean;
}) {
  const total = mix.reduce((s, m) => s + m.count, 0);
  if (total === 0) {
    return <p className="text-[14px] text-ink-muted">Nothing scheduled yet.</p>;
  }

  const present = mix.filter((m) => m.count > 0);

  return (
    <div>
      <div
        className="flex h-3 w-full overflow-hidden rounded"
        role="img"
        aria-label={present.map((m) => `${pillarStyle(m.pillar).label} ${m.count}`).join(', ')}
      >
        {present.map((m) => (
          <div
            key={m.pillar}
            className={cn('h-full', pillarStyle(m.pillar).bar)}
            style={{ width: `${(m.count / total) * 100}%` }}
          />
        ))}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {present.map((m) => {
          const style = pillarStyle(m.pillar);
          const share = Math.round((m.count / total) * 100);
          return (
            <li key={m.pillar} className="flex items-center gap-2">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', style.dot)} />
              <span className="text-[13px] text-ink">
                {style.label} <span className="text-ink-muted">{m.count} · {share}%</span>
              </span>
              {onAdjust ? (
                // §6.8's own example interaction: "less offer, more craft".
                // Two buttons per pillar beats a slider — the user is expressing
                // a direction, not choosing a number.
                <span className="flex items-center gap-1">
                  <AdjustButton
                    label={`Less ${style.label}`}
                    onClick={() => onAdjust(m.pillar, 'less')}
                    disabled={busy}
                  >
                    −
                  </AdjustButton>
                  <AdjustButton
                    label={`More ${style.label}`}
                    onClick={() => onAdjust(m.pillar, 'more')}
                    disabled={busy}
                  >
                    +
                  </AdjustButton>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AdjustButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-5 w-5 items-center justify-center rounded border border-border text-[13px] leading-none',
        'text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink',
        'disabled:pointer-events-none disabled:opacity-40',
      )}
    >
      {children}
    </button>
  );
}
