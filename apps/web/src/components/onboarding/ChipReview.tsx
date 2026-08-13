'use client';

import { useState } from 'react';

/**
 * ONB-02 — chip playback of what the crawl inferred.
 *
 * `genome.bootstrap_from_url` returns inferences with calibrated confidence and
 * **sorts them lowest-confidence first**, because the ones most likely to be
 * wrong are the ones worth a person's attention. This renders them in that
 * order rather than re-sorting: the tool already made the decision, and a UI
 * that re-ranked would quietly undo it.
 *
 * Every chip is editable. That is the point of showing them — SPARK is saying
 * "here is what I read about you, correct me" — and it is also the cheapest
 * moment to fix a wrong genome, before it routes a month of content.
 *
 * `unresolved` dimensions are deliberately *not* shown here. They were not
 * guessed, so there is nothing to correct; they are asked directly in the next
 * step. Presenting an absent answer as an empty chip would invite someone to
 * fill it in with the same shrug the inference pass refused to make.
 */

export interface Chip {
  field: string;
  value: string;
  confidence: number;
  editable?: boolean;
}

/** Below this the inference pass treats its own answer as a question. */
const LOW_CONFIDENCE = 0.6;

export function ChipReview({
  chips,
  onChange,
}: {
  chips: Chip[];
  onChange: (chips: Chip[]) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  if (chips.length === 0) {
    return (
      <p className="text-[16px] text-ink-muted">
        Nothing could be read from that page with enough confidence to show you. The next questions
        cover what matters most.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {chips.map((chip) => {
        const low = chip.confidence < LOW_CONFIDENCE;

        return (
          <li
            key={chip.field}
            className="flex items-center gap-3 rounded-[15px] border border-border bg-[var(--ss-field)] px-4 py-3"
          >
            <span className="min-w-[160px] text-[14px] text-ink-muted">{label(chip.field)}</span>

            {editing === chip.field ? (
              <input
                autoFocus
                defaultValue={chip.value}
                onBlur={(e) => {
                  onChange(chips.map((c) => (c.field === chip.field ? { ...c, value: e.target.value } : c)));
                  setEditing(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                className="flex-1 rounded-[10px] bg-background px-3 py-1.5 text-[16px] text-ink outline-none ring-[1.5px] ring-ring"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditing(chip.field)}
                className="flex-1 rounded-[10px] px-3 py-1.5 text-left text-[16px] text-ink transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring"
              >
                {chip.value}
              </button>
            )}

            {/*
              Confidence as a word, not a percentage. "72%" invites arithmetic
              about a number that is a model's self-assessment; "worth checking"
              says the only thing the reader can act on.
            */}
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] ${
                low
                  ? 'bg-[var(--ss-warn)]/15 text-[var(--ss-warn)]'
                  : 'bg-[var(--ss-success)]/15 text-[var(--ss-success)]'
              }`}
            >
              {low ? 'worth checking' : 'confident'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * `identity.business_name` → `Business name`.
 *
 * Derived rather than mapped through a lookup table: the field set comes from
 * the model and grows, and a table would render an unmapped field as a blank
 * label — worse than a slightly awkward auto-generated one.
 */
function label(field: string): string {
  const last = field.split('.').pop() ?? field;
  const words = last.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
