'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { EiSectionChip } from './EiPrimitives';
import { HANDOFF_DESTINATIONS, QUALIFICATION_OPTIONS, TEMPERATURES } from './types';

/**
 * Step 5 — `Settings WS EI Sales`.
 *
 * Moved here verbatim from the single panel this flow replaces. The one change is
 * that the escalation keyword list is not here any more: it belongs with the
 * other boundary, in step 2, and having it in two places was how a screen ends up
 * with two inputs writing one field.
 */
export function SalesStep({
  qualification,
  onQualification,
  handoff,
  onHandoff,
  usingDefaultHandoff,
  onUsingDefaultHandoff,
  destination,
  onDestination,
}: {
  qualification: string[];
  onQualification: (next: string[]) => void;
  handoff: { hot: string; warm: string; cold: string };
  onHandoff: (next: { hot: string; warm: string; cold: string }) => void;
  usingDefaultHandoff: boolean;
  onUsingDefaultHandoff: (v: boolean) => void;
  destination: string;
  onDestination: (v: string) => void;
}) {
  return (
    <div>
      <p className="text-[13px] text-ink-muted">
        When someone sounds like a customer rather than a commenter, this decides what SPARK may do about
        it and where the lead goes.
      </p>

      <div className="mt-[4px]">
        <EiSectionChip>Lead Qualification Options</EiSectionChip>
      </div>
      <ul className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {QUALIFICATION_OPTIONS.map((o) => {
          const on = qualification.includes(o.value);
          return (
            <li key={o.value}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() =>
                  onQualification(
                    on ? qualification.filter((x) => x !== o.value) : [...qualification, o.value],
                  )
                }
                className={cn(
                  'w-full rounded-lg border p-3 text-left transition-colors',
                  on ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-muted',
                )}
              >
                <span className="block text-[13px] font-medium text-ink">{o.label}</span>
                <span className="mt-0.5 block text-[12px] text-ink-muted">{o.hint}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {qualification.length === 0 && (
        <p className="mt-2 text-[12px] text-ink-muted">
          Nothing selected: SPARK will flag the lead and let you take it from there.
        </p>
      )}

      <div className="mt-[26px]">
        <EiSectionChip>Handoff Rules</EiSectionChip>
      </div>
      <div className="mt-1.5 space-y-2">
        {TEMPERATURES.map((t) => (
          <div key={t.value} className="flex flex-wrap items-center gap-2">
            <span className="flex w-[132px] shrink-0 items-baseline gap-1.5">
              <span aria-hidden>{t.emoji}</span>
              <span className="text-[13px] font-medium text-ink">{t.label}</span>
              <span className="text-[11px] text-ink-muted">{t.hint}</span>
            </span>
            {/* The prototype's arrow, kept. It reads its rules as a sentence and
                the arrow is what makes the row scan as one rule rather than a
                label beside three unrelated chips. */}
            <span aria-hidden className="shrink-0 text-[13px] text-ink-muted">
              &rarr;
            </span>
            <div className="flex flex-wrap gap-1.5">
              {HANDOFF_DESTINATIONS.map((d) => {
                const on = handoff[t.value] === d.value;
                return (
                  <button
                    key={d.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      onHandoff({ ...handoff, [t.value]: d.value });
                      // Touching any row makes the whole map this brand's own
                      // choice. A partly-chosen map is a lead with no rule, so
                      // it is all three or the defaults.
                      onUsingDefaultHandoff(false);
                    }}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-[13px] transition-colors',
                      on
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-ink-muted hover:bg-surface-muted',
                      usingDefaultHandoff && on && 'opacity-60',
                    )}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {usingDefaultHandoff && (
        <p className="mt-2 text-[12px] text-ink-muted">
          These are the defaults. Change any row to make them yours.
        </p>
      )}

      <label className="mt-5 block text-[12px] font-medium text-ink-muted" htmlFor="ei-sales-destination">
        Send leads on to
      </label>
      <p className="mt-1 text-[12px] text-ink-muted">
        An email address or a CRM inbox. Only used for the rows set to &ldquo;send on&rdquo; &mdash; without
        it, those leads wait in Sales Opportunities instead.
      </p>
      <Input
        id="ei-sales-destination"
        value={destination}
        onChange={(e) => onDestination(e.target.value)}
        placeholder="sales@yourcompany.com"
        className="mt-1.5 max-w-md"
      />
    </div>
  );
}
