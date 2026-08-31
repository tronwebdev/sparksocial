'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { startAgentRun } from '@/lib/agent';

/**
 * `M9` — conversational editing inside the Draft Panel.
 *
 * ── Why this goes through the agent runtime and not a new tool ─────────────
 *
 * "Make the hook punchier" is not a capability; it is an instruction that has to
 * be turned into one. The tools that could satisfy it already exist —
 * `content.beat.update`, `content.scene.retime`, the five `content.generate_*`
 * calls — and choosing between them from a sentence is exactly what SPARK's
 * runtime is for. A `content.edit_by_instruction` tool would either be a thin
 * wrapper that re-implements that routing, or a second agent loop living inside
 * the registry, which `apps/api/src/app.ts` deliberately keeps the runtime out of
 * (an agent callable as a tool can invoke itself through its own registry).
 *
 * So this posts to `/api/agent/runs` — the second, intentionally non-tool proxy
 * CLAUDE.md's frontend rules describe — with the draft's id in the goal.
 *
 * ── What it does not pretend to be ────────────────────────────────────────
 *
 * Not a persisted conversation. `agent_runs` is keyed by brand rather than by
 * person and there is no conversation entity, so history here lives in component
 * state and is gone when the panel closes. That is a real limitation, stated in
 * the UI rather than papered over with a transcript that silently evaporates:
 * `5.3` is where a conversation becomes a thing that exists.
 *
 * Each turn is also independent. There is no thread carried between them, so a
 * follow-up like "no, shorter" has only what this turn's goal text carries. The
 * prompt includes the previous instruction for exactly that reason, which is a
 * workaround and reads like one.
 */

interface Turn {
  role: 'you' | 'spark';
  text: string;
}

export function DraftChat({
  contentItemId,
  genomeId,
  disabled,
  onChanged,
}: {
  contentItemId: string;
  genomeId: string;
  /** True while a beat-level action is mid-flight — two writers on one draft is how an edit gets lost. */
  disabled: boolean;
  onChanged: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    const instruction = text.trim();
    if (!instruction || busy || disabled) return;

    const previous = turns.filter((t) => t.role === 'you').at(-1)?.text;
    setTurns((t) => [...t, { role: 'you', text: instruction }]);
    setText('');
    setBusy(true);

    /**
     * The ids are in the goal because that is the only channel there is — the
     * run takes a sentence, not a subject. Naming the draft explicitly is what
     * lets SPARK act on *this* post rather than resolving "the draft" to
     * whichever one it finds.
     */
    const goal = [
      `Edit content item ${contentItemId} in genome ${genomeId}.`,
      previous ? `My previous instruction was: "${previous}".` : '',
      `Now: ${instruction}`,
      'Use the content.* tools. Change only what I asked for, and say what you changed.',
    ]
      .filter(Boolean)
      .join(' ');

    const res = await startAgentRun(goal, 'director');
    setBusy(false);

    if (res.status !== 'succeeded') {
      setTurns((t) => [...t, { role: 'spark', text: res.error.message }]);
      return;
    }
    setTurns((t) => [...t, { role: 'spark', text: res.run.text || 'Done.' }]);
    // Always reload: the run may have written beats, and the panel's copy of the
    // draft is now stale whether or not the reply says so.
    onChanged();
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-[13px] font-medium text-ink">Ask for a change</p>
      <p className="mt-1 text-[12px] text-ink-muted">
        Plain instructions &mdash; &ldquo;make the hook punchier&rdquo;, &ldquo;cut the third scene to two
        seconds&rdquo;. SPARK edits this post with the same tools the buttons above use.
      </p>

      {turns.length > 0 ? (
        <ul className="mt-3 grid grid-cols-1 gap-2">
          {turns.map((t, i) => (
            <li
              key={`${t.role}-${i}`}
              className={`rounded-lg px-3 py-2 text-[13px] ${
                t.role === 'you' ? 'bg-surface-muted text-ink' : 'border border-border text-ink-muted'
              }`}
            >
              <span className="mr-2 text-[11px] uppercase tracking-wide text-ink-muted">
                {t.role === 'you' ? 'You' : 'SPARK'}
              </span>
              {t.text}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          disabled={busy || disabled}
          placeholder="Make the CTA less pushy"
          className="min-w-[16rem] flex-1 resize-none rounded-lg border border-border bg-input px-3 py-2 text-[14px] text-ink placeholder:text-ink-placeholder focus:outline-none focus:ring-[1.5px] focus:ring-ring disabled:opacity-50"
        />
        <Button disabled={busy || disabled || !text.trim()} onClick={() => void send()}>
          {busy ? 'Working…' : 'Send'}
        </Button>
      </div>

      {turns.length > 0 ? (
        <p className="mt-2 text-[11px] text-ink-muted">
          This conversation is not saved &mdash; it goes when the panel closes. Every change it made to the
          post is saved.
        </p>
      ) : null}
    </div>
  );
}
