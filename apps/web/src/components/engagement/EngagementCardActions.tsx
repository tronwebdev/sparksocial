'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { invoke } from '@/lib/tools';
import type { EngagementItem } from './EngagementFeed';

/**
 * `engage.escalate` / `engage.takeover` — the two ways a card leaves the feed
 * without a reply ever going out. Sits alongside `ReplyAction` on every card
 * (not just Needs Review): a suggested reply can still be the wrong call, and
 * a sales opportunity can still turn hostile.
 *
 * Both calls are `autonomy: 'auto'`/no `policy.ts` rule 6 gating (neither is
 * a `publish`), so unlike `ReplyAction` there is no `gated` branch to render
 * here — a `succeeded`/`failed` split is the whole story.
 *
 * `window.prompt`/`window.confirm` rather than a custom dialog: both actions
 * are "simple buttons, confirm-and-call" per the engagement feed's existing
 * bar for interaction weight (no modal exists anywhere else in this feed).
 */

type Phase = 'idle' | 'escalating' | 'takingOver';
type Resolution = 'escalated' | 'taken_over';

export function EngagementCardActions({
  item,
  genomeId,
  onResolved,
}: {
  item: EngagementItem;
  genomeId: string;
  onResolved: (messageId: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function escalate() {
    const reason = window.prompt('Why does this need a human beyond the normal review queue?');
    if (!reason || !reason.trim()) return;
    setPhase('escalating');
    setError(null);
    const res = await invoke<{ status: string }>('engage.escalate', { genomeId, messageId: item.id, reason: reason.trim() });
    setPhase('idle');
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    setResolution('escalated');
    onResolved(item.id);
  }

  async function takeover() {
    if (!window.confirm('Take over this conversation? SPARK will stop drafting, auto-handling, or acting on it.')) return;
    setPhase('takingOver');
    setError(null);
    const res = await invoke<{ status: string }>('engage.takeover', { genomeId, messageId: item.id });
    setPhase('idle');
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    setResolution('taken_over');
    onResolved(item.id);
  }

  if (item.status === 'escalated' || resolution) {
    return <Badge variant="warn">{resolution === 'taken_over' ? 'Taken over' : 'Escalated'}</Badge>;
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="text-[13px] font-medium text-ink-muted hover:text-ink disabled:opacity-50"
        disabled={phase !== 'idle'}
        onClick={() => void escalate()}
      >
        {phase === 'escalating' ? 'Escalating…' : 'Escalate'}
      </button>
      <span className="text-[13px] text-ink-muted">·</span>
      <button
        type="button"
        className="text-[13px] font-medium text-ink-muted hover:text-ink disabled:opacity-50"
        disabled={phase !== 'idle'}
        onClick={() => void takeover()}
      >
        {phase === 'takingOver' ? 'Taking over…' : 'Take over'}
      </button>
      {error ? <p className="w-full text-[13px] text-destructive">{error}</p> : null}
    </div>
  );
}
