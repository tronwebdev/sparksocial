'use client';

import type { Question } from './questions';

/**
 * One of the five questions (`ONB-03`).
 *
 * Cards rather than a `<select>`: each choice carries a hint, and the hints are
 * the part that makes the answer accurate. "Nothing — I would rather not film"
 * is only a safe thing to admit when it visibly says *SPARK works from what you
 * already have* underneath it, and a dropdown has nowhere to put that.
 */
export function QuestionStep({
  question,
  selected,
  onChange,
}: {
  question: Question;
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  function toggle(value: string) {
    if (!question.multiple) return onChange([value]);
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">{question.prompt}</legend>

      {question.choices.map((choice) => {
        const isSelected = selected.includes(choice.value);

        return (
          <label
            key={choice.value}
            className={`flex cursor-pointer items-start gap-4 rounded-[15px] border px-5 py-4 transition-colors ${
              isSelected
                ? 'border-[var(--ss-accent-purple)] bg-[var(--ss-accent-purple)]/8'
                : 'border-border bg-[var(--ss-field)] hover:border-[var(--ss-border-strong)]'
            }`}
          >
            <input
              type={question.multiple ? 'checkbox' : 'radio'}
              name={question.id}
              checked={isSelected}
              onChange={() => toggle(choice.value)}
              // Visually replaced by the card, but kept real: it is what makes
              // the group keyboard-navigable and screen-reader-legible, and a
              // div with an onClick is neither.
              className="mt-1 h-[18px] w-[18px] shrink-0 accent-[var(--ss-accent-purple)]"
            />

            <span className="flex flex-col gap-0.5">
              <span className="text-[16px] font-medium text-ink">{choice.label}</span>
              {choice.hint ? <span className="text-[14px] text-ink-muted">{choice.hint}</span> : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
