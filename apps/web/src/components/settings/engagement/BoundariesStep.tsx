'use client';

import { Input } from '@/components/ui/input';
import { EiOptionRow, EiSectionChip } from './EiPrimitives';
import { ESCALATION_BEHAVIORS, HARD_RULES, splitList, type EscalationBehavior } from './types';

/**
 * Step 2 — `Settings WS EI Boundaries`.
 *
 * Three controls, three different mechanisms, and the screen says which is which.
 * The hard rules become prohibitions in the reply writer's prompt; the complaints
 * rule and the keyword list are enforced *before* any prompt runs, because a
 * prohibition a model is asked to honour is a weaker thing than a message that
 * never reaches a model.
 */
export function BoundariesStep({
  hardRules,
  onHardRules,
  escalation,
  onEscalation,
  keywords,
  onKeywords,
}: {
  hardRules: string[];
  onHardRules: (next: string[]) => void;
  escalation: EscalationBehavior;
  onEscalation: (v: EscalationBehavior) => void;
  keywords: string;
  onKeywords: (v: string) => void;
}) {
  const words = splitList(keywords);

  return (
    <div className="grid grid-cols-1 gap-7">
      <div>
        <EiSectionChip>Hard rules</EiSectionChip>

        <ul className="mt-[18px] grid grid-cols-1 gap-[14px]">
          {HARD_RULES.map((r) => {
            const on = hardRules.includes(r.value);
            return (
              <li key={r.value}>
                <EiOptionRow
                  kind="check"
                  on={on}
                  onToggle={() =>
                    onHardRules(on ? hardRules.filter((x) => x !== r.value) : [...hardRules, r.value])
                  }
                  title={r.label}
                  /*
                    Only one rule carries a note, and it is the one whose
                    mechanism differs: it stops the send rather than shaping the
                    words. Saying so is the difference between a rule the owner
                    trusts and a rule they assume is advisory.
                  */
                  detail={'note' in r && r.note ? r.note : undefined}
                />
              </li>
            );
          })}
        </ul>
        {hardRules.length === 0 && (
          <p className="mt-2 text-[12px] text-ink-muted">
            Nothing selected. Replies stay inside your guardrails and brand voice, which is where every
            brand starts.
          </p>
        )}
      </div>

      <div>
        <EiSectionChip>Escalation behavior</EiSectionChip>
        <p className="mt-[14px] max-w-[592px] text-16" style={{ color: 'rgb(131,131,131)' }}>
          What happens once SPARK has decided a person is needed.
        </p>
        <ul className="mt-[16px] grid grid-cols-1 gap-[14px]" role="radiogroup" aria-label="Escalation behavior">
          {ESCALATION_BEHAVIORS.map((b) => (
            <li key={b.value}>
              <EiOptionRow
                title={b.label}
                detail={b.hint}
                on={escalation === b.value}
                onToggle={() => onEscalation(b.value)}
              />
            </li>
          ))}
        </ul>
      </div>

      <div>
        <label className="block text-18 font-medium" style={{ color: 'rgb(131,131,131)' }} htmlFor="ei-escalation">
          Sensitive keywords
        </label>
        <p className="mt-0.5 text-[12px] text-ink-muted">
          A message containing any of these is always escalated, and SPARK will not offer a reply for it
          &mdash; no matter how routine it looked. Comma separated.
        </p>
        <Input
          id="ei-escalation"
          value={keywords}
          onChange={(e) => onKeywords(e.target.value)}
          placeholder="refund, chargeback, lawsuit, complaint, scam"
          className="mt-2 max-w-xl"
        />
        {words.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {words.map((word) => (
              <span
                key={word}
                className="rounded-full border border-warn/40 bg-warn/10 px-2.5 py-1 text-[12px] text-ink"
              >
                {word}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
