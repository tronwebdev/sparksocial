'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Busy } from '@/components/brand/SparkLoader';
import { notify, notifyResult } from '@/lib/notify';
import { invoke } from '@/lib/tools';
import type { EngagementItem } from './EngagementFeed';

/**
 * The "approve & send" loop PRD §8.8 describes, attached to one feed card:
 * draft → edit → send. `EngagementFeed` stays the read side (`engage.list`);
 * this owns the two write calls (`engage.reply.draft`/`.send`) for exactly
 * one message, so a busy/sent state on one card never touches its siblings.
 *
 * `engage.reply.send` is gated by `policy.ts` rule 6 (eligibility + the
 * campaign's engagement rung — autonomy became a property of the campaign on
 * 22 August, so this is no longer a brand-wide setting) — a `gated` result is
 * expected, common, and goes through `notifyResult` as "sent for approval"
 * with its own reason rather than as the error a `failed` result gets.
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

  async function draft(regenerate: boolean) {
    setPhase('loading');
    const res = await invoke<{ text: string; source: 'suggested' | 'generated' }>('engage.reply.draft', {
      genomeId,
      messageId: item.id,
      regenerate,
    });
    if (!notifyResult(res, undefined, 'Couldn’t draft a reply')) {
      /* Back to where it was: a regenerate keeps the text being edited. */
      setPhase(regenerate ? 'editing' : 'idle');
      return;
    }
    setText(res.output.text);
    setSource(res.output.source);
    setPhase('editing');
  }

  async function send() {
    if (!text.trim()) return;
    setPhase('sending');
    const res = await invoke<{ status: string }>(
      'engage.reply.send',
      { genomeId, messageId: item.id, text: text.trim() },
      `engage.reply.send:${item.id}`,
    );
    if (!notifyResult(res, undefined, 'Couldn’t send the reply')) {
      setPhase('editing');
      return;
    }
    setPhase('sent');
    notify.success('Reply sent');
    onReplied(item.id);
  }

  if (item.status === 'replied' || phase === 'sent') {
    return <Badge variant="success">Replied</Badge>;
  }

  if (phase === 'idle' || phase === 'loading') {
    return (
      <div className="mt-3">
        <Button size="sm" variant="outline" disabled={phase === 'loading'} onClick={() => void draft(false)}>
          {phase === 'loading' ? <Busy size={16}>Drafting…</Busy> : 'Draft reply'}
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-[10px] shadow-[inset_0_0_0_1px_rgba(131,131,131,0.22)] bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-12 font-medium uppercase tracking-wide text-ink-muted">
          {source === 'suggested' ? 'Suggested reply' : 'Drafted reply'} — edit before sending
        </p>
        <button
          type="button"
          className="shrink-0 text-12 font-medium text-ink-muted hover:text-ink disabled:opacity-50"
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
          'mt-2 w-full resize-y rounded-[10px] shadow-[inset_0_0_0_1px_rgba(131,131,131,0.22)] bg-white p-2 text-14 text-ink ' +
          'focus:outline-none focus:ring-[1.5px] focus:ring-ring disabled:opacity-50'
        }
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={phase === 'sending' || !text.trim()} onClick={() => void send()}>
          {phase === 'sending' ? <Busy size={16}>Sending…</Busy> : 'Send'}
        </Button>
        <button
          type="button"
          className="text-13 text-ink-muted hover:text-ink"
          disabled={phase === 'sending'}
          onClick={() => {
            setPhase('idle');
            setText('');
            setSource(null);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
