'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/tools';
import type { EngagementItem } from './EngagementFeed';

/**
 * The "approve & send" loop PRD §8.8 describes, attached to one feed card:
 * draft → edit → send. `EngagementFeed` stays the read side (`engage.list`);
 * this owns the two write calls (`engage.reply.draft`/`.send`) for exactly
 * one message, so a busy/error/sent state on one card never touches its
 * siblings.
 *
 * `engage.reply.send` is gated by `policy.ts` rule 6 (eligibility +
 * workspace autonomy configuration) — a `gated` result is expected, common,
 * and shown with its own reason rather than folded into the generic error
 * path a `failed` result gets. Same "handle gated explicitly" rule
 * `AgentControlBar`/`DraftPanel` already follow for their own write calls.
 */

type Phase = 'idle' | 'loading' | 'editing' | 'sending' | 'sent';

export function ReplyAction({
  item,
  genomeId,
  onReplied,
}: {
  item: EngagementItem;
  genomeId: string;
  onReplied: (messageId: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [text, setText] = useState('');
  const [source, setSource] = useState<'suggested' | 'generated' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gated, setGated] = useState<string | null>(null);

  async function draft(regenerate: boolean) {
    setPhase('loading');
    setError(null);
    setGated(null);
    const res = await invoke<{ text: string; source: 'suggested' | 'generated' }>('engage.reply.draft', {
      genomeId,
      messageId: item.id,
      regenerate,
    });
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'Drafting was held: check the review queue.');
      setPhase('idle');
      return;
    }
    setText(res.output.text);
    setSource(res.output.source);
    setPhase('editing');
  }

  async function send() {
    if (!text.trim()) return;
    setPhase('sending');
    setError(null);
    setGated(null);
    const res = await invoke<{ status: string }>(
      'engage.reply.send',
      { genomeId, messageId: item.id, text: text.trim() },
      `engage.reply.send:${item.id}`,
    );
    if (res.status === 'succeeded') {
      setPhase('sent');
      onReplied(item.id);
      return;
    }
    setPhase('editing');
    if (res.status === 'gated') {
      setGated(res.decision.reason ?? `Held: ${res.decision.kind}.`);
    } else {
      setError(res.error.message);
    }
  }

  if (item.status === 'replied' || phase === 'sent') {
    return <Badge variant="success">Replied</Badge>;
  }

  if (phase === 'idle' || phase === 'loading') {
    return (
      <div className="mt-3">
        <Button size="sm" variant="outline" disabled={phase === 'loading'} onClick={() => void draft(false)}>
          {phase === 'loading' ? 'Drafting…' : 'Draft reply'}
        </Button>
        {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded border border-border bg-surface-muted p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">
          {source === 'suggested' ? 'Suggested reply' : 'Drafted reply'} — edit before sending
        </p>
        <button
          type="button"
          className="shrink-0 text-[12px] font-medium text-ink-muted hover:text-ink disabled:opacity-50"
          disabled={phase === 'sending'}
          onClick={() => void draft(true)}
        >
          Regenerate
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={phase === 'sending'}
        rows={3}
        className={
          'mt-2 w-full resize-y rounded border border-border bg-surface p-2 text-[14px] text-ink ' +
          'focus:outline-none focus:ring-[1.5px] focus:ring-ring disabled:opacity-50'
        }
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={phase === 'sending' || !text.trim()} onClick={() => void send()}>
          {phase === 'sending' ? 'Sending…' : 'Send'}
        </Button>
        <button
          type="button"
          className="text-[13px] text-ink-muted hover:text-ink"
          disabled={phase === 'sending'}
          onClick={() => {
            setPhase('idle');
            setText('');
            setSource(null);
            setError(null);
            setGated(null);
          }}
        >
          Cancel
        </button>
      </div>

      {gated ? <p className="mt-2 text-[13px] text-warn">Held: {gated}</p> : null}
      {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
    </div>
  );
}
