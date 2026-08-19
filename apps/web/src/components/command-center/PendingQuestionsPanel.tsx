'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';

/**
 * `human.ask`'s own doc comment calls this "the other half of the Command
 * Center" (plan §3.2) — a parked question "appears in an inbox." Until this
 * component, that inbox did not exist anywhere in `apps/web`: `human.ask` and
 * `human.pending` were real and tested, but an owner had no way to discover
 * "SPARK is waiting on you" inside the product itself.
 *
 * Brand-scoped like `AgentControlBar`/`agent.status` — no `genomeId` in the
 * input, `human.pending`/`human.answer` both resolve the brand from the
 * session context, same reasoning `agentStatus`'s own tool comment gives.
 *
 * An answer here is the in-app path CLAUDE.md's untrusted-input rule already
 * covers for the WhatsApp reply: it is stored and displayed as content, never
 * branched on to authorise anything — `human.answer`'s own `human_only`
 * autonomy is what keeps SPARK from being able to answer its own question,
 * not anything this component does.
 */

interface PendingQuestion {
  messageId: string;
  question: string;
  options?: string[];
  urgency: 'low' | 'normal' | 'high';
  askedAt: string;
  waitingHours: number;
  runId?: string;
}

// Badge only defines neutral/success/warn (no error tone) — warn is the
// closest to "this needs your attention," reserved for genuinely high urgency
// rather than every question, the same restraint `DraftList`'s own status
// tones use.
const URGENCY_TONE: Record<PendingQuestion['urgency'], 'neutral' | 'warn'> = {
  low: 'neutral',
  normal: 'neutral',
  high: 'warn',
};

function formatWait(hours: number): string {
  if (hours < 1) return 'just now';
  if (hours < 24) return `waiting ${hours}h`;
  return `waiting ${Math.round((hours / 24) * 10) / 10}d`;
}

export function PendingQuestionsPanel() {
  const [questions, setQuestions] = useState<PendingQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [answering, setAnswering] = useState<string | null>(null);
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});

  async function load() {
    const res = await invoke<{ questions: PendingQuestion[] }>('human.pending', { limit: 20 });
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      setQuestions([]);
      return;
    }
    setError(null);
    setQuestions(res.output.questions);
  }

  useEffect(() => {
    void load();
  }, []);

  async function submitAnswer(messageId: string) {
    const answer = (drafts[messageId] ?? '').trim();
    if (!answer || answering) return;
    setAnswering(messageId);
    setAnswerErrors((e) => ({ ...e, [messageId]: '' }));
    const res = await invoke('human.answer', { messageId, answer });
    setAnswering(null);
    if (res.status !== 'succeeded') {
      setAnswerErrors((e) => ({
        ...e,
        [messageId]: res.status === 'failed' ? res.error.message : 'That answer was gated.',
      }));
      return;
    }
    setDrafts((d) => ({ ...d, [messageId]: '' }));
    await load();
  }

  // Nothing waiting and nothing failed — the quiet, common case gets no
  // banner at all, same call `NeedsAttentionBanner` makes for an empty review
  // queue: a permanent empty-state card would train an owner to stop reading
  // this part of the screen entirely.
  if (questions !== null && questions.length === 0 && !error) return null;

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">SPARK is waiting on you</h2>

      {questions === null ? (
        <Skeleton className="mt-4 h-20 w-full rounded" />
      ) : error ? (
        <p className="mt-2 text-[14px] text-ink-muted">{error}</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-3">
          {questions.map((q) => (
            <li key={q.messageId} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-[14px] text-ink">{q.question}</p>
                <Badge variant={URGENCY_TONE[q.urgency]} className="shrink-0 capitalize">
                  {q.urgency}
                </Badge>
              </div>
              <p className="mt-1 text-[12px] text-ink-muted">
                {formatWait(q.waitingHours)} ·{' '}
                {new Date(q.askedAt).toLocaleString('en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </p>

              {q.options?.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {q.options.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setDrafts((d) => ({ ...d, [q.messageId]: opt }))}
                      className={`rounded-full border px-3 py-1.5 text-[13px] ${
                        drafts[q.messageId] === opt
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-ink hover:bg-surface-muted'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={drafts[q.messageId] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [q.messageId]: e.target.value }))}
                  disabled={answering === q.messageId}
                  placeholder="Type an answer, or pick an option above"
                  className="h-9 min-w-[220px] flex-1 rounded border border-border bg-input px-3 text-[13px] text-ink placeholder:text-ink-placeholder disabled:opacity-50"
                />
                <Button
                  size="sm"
                  disabled={answering === q.messageId || !(drafts[q.messageId] ?? '').trim()}
                  onClick={() => void submitAnswer(q.messageId)}
                >
                  {answering === q.messageId ? 'Sending…' : 'Answer'}
                </Button>
              </div>
              {answerErrors[q.messageId] ? (
                <p className="mt-1 text-[12px] text-destructive">{answerErrors[q.messageId]}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
