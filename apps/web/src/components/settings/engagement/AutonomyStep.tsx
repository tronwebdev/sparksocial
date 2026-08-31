'use client';

import { cn } from '@/lib/utils';
import { ENGAGEMENT_LEVELS, ENGAGEMENT_TYPES, type EngagementAutonomy } from './types';

/**
 * Step 1 — `Settings WS EI Autonomy`.
 *
 * The brand-level answer, and the one the other four steps are read against.
 * Step 3 can narrow it per platform; nothing can widen it.
 */
export function AutonomyStep({
  autonomy,
  onAutonomy,
  types,
  onTypes,
}: {
  autonomy: EngagementAutonomy;
  onAutonomy: (v: EngagementAutonomy) => void;
  types: string[];
  onTypes: (next: string[]) => void;
}) {
  return (
    <div>
      <p className="text-[13px] text-ink-muted">
        SPARK cannot reply at all until a campaign has been running two weeks with five posts out. This
        decides what happens after that.
      </p>

      <ul className="mt-4 grid grid-cols-1 gap-2">
        {ENGAGEMENT_LEVELS.map((l) => (
          <li key={l.value}>
            <button
              type="button"
              aria-pressed={autonomy === l.value}
              onClick={() => onAutonomy(l.value)}
              className={cn(
                'w-full rounded-lg border p-3 text-left transition-colors',
                autonomy === l.value ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-muted',
              )}
            >
              <span className="block text-[14px] font-medium text-ink">{l.label}</span>
              <span className="mt-0.5 block text-[12px] text-ink-muted">{l.hint}</span>
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-5 text-[12px] font-medium text-ink-muted">Where it may answer</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {ENGAGEMENT_TYPES.map((t) => {
          // Empty means all three, so nothing selected reads as "everywhere".
          const on = types.length === 0 || types.includes(t.value);
          return (
            <button
              key={t.value}
              type="button"
              aria-pressed={on}
              onClick={() => {
                const current = types.length ? types : ENGAGEMENT_TYPES.map((x) => x.value as string);
                const next = current.includes(t.value)
                  ? current.filter((x) => x !== t.value)
                  : [...current, t.value];
                // Back to "all" rather than storing a list that happens to
                // contain everything.
                onTypes(next.length === ENGAGEMENT_TYPES.length ? [] : next);
              }}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[13px] transition-colors',
                on
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-ink-muted hover:bg-surface-muted',
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {types.length === 0 && (
        <p className="mt-2 text-[12px] text-ink-muted">
          All three. Unchecking one stops the automation for it &mdash; SPARK still drafts, you still send.
        </p>
      )}
    </div>
  );
}
