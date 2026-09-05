'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';

/**
 * The "controls" PRD §CC-01 names: the kill switch (`agent.pause`/`agent.resume`)
 * and the cadence dial (`agent.frequency.set`). Pause is available to more
 * roles than resume and needs no confirmation dialog — `agentControl.ts`'s own
 * header explains why: stopping something that looks wrong should be the
 * least gated action in the product.
 */

export interface AgentStatusView {
  brandId: string;
  paused: boolean;
  pausedAt?: string;
  pausedBy?: string;
  reason?: string;
  effect: string;
  postsPerWeek: number;
}

/**
 * `status`/`onChange` are optional now, and that is what let this move.
 *
 * The Command Center's Overview owned the `agent.status` read and passed it
 * down. Settings → Brand Kit is this control's home now (see that page), and a
 * settings page has no reason to hold one panel's state for it — so with no
 * props it reads `agent.status` itself. Given props, it stays a controlled
 * component, which is what any caller that shows the same status elsewhere on
 * its screen needs.
 */
export function AgentControlBar({
  status: controlled,
  onChange,
}: {
  status?: AgentStatusView | null;
  onChange?: (next: AgentStatusView) => void;
} = {}) {
  const [own, setOwn] = useState<AgentStatusView | null>(null);
  const status = controlled !== undefined ? controlled : own;

  const load = useCallback(async () => {
    const res = await invoke<AgentStatusView>('agent.status', {});
    if (res.status === 'succeeded') setOwn(res.output);
  }, []);

  useEffect(() => {
    if (controlled === undefined) void load();
  }, [controlled, load]);

  const publish = (next: AgentStatusView) => {
    if (onChange) onChange(next);
    else setOwn(next);
  };

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freqDraft, setFreqDraft] = useState<string | null>(null);
  const [freqNote, setFreqNote] = useState<string | null>(null);

  async function toggle() {
    if (!status) return;
    setBusy(true);
    setError(null);
    const res = await invoke<AgentStatusView>(status.paused ? 'agent.resume' : 'agent.pause', {});
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    publish(res.output);
  }

  async function submitFrequency() {
    if (!status || freqDraft === null) return;
    const postsPerWeek = Number(freqDraft);
    if (!Number.isInteger(postsPerWeek) || postsPerWeek < 1 || postsPerWeek > 14) {
      setError('Pick a whole number between 1 and 14.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await invoke<AgentStatusView & { why: { summary: string } }>('agent.frequency.set', { postsPerWeek });
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    publish(res.output);
    setFreqNote(res.output.why.summary);
    setFreqDraft(null);
  }

  if (!status) return <Skeleton className="h-20 w-full rounded" />;

  return (
    <section className="rounded border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-4">
        <Badge variant={status.paused ? 'warn' : 'success'}>{status.paused ? 'Paused' : 'Running'}</Badge>
        <p className="min-w-0 flex-1 text-[13px] text-ink-muted">{status.effect}</p>
        <Button variant={status.paused ? 'primary' : 'outline'} disabled={busy} onClick={() => void toggle()}>
          {busy ? 'Working…' : status.paused ? 'Resume agent' : 'Pause agent'}
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <span className="text-[13px] text-ink-muted">Posting frequency</span>
        <Input
          type="number"
          min={1}
          max={14}
          value={freqDraft ?? String(status.postsPerWeek)}
          onChange={(e) => setFreqDraft(e.target.value)}
          className="h-9 w-20"
          aria-label="Posts per week"
        />
        <span className="text-[13px] text-ink-muted">posts / week</span>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || freqDraft === null || freqDraft === String(status.postsPerWeek)}
          onClick={() => void submitFrequency()}
        >
          Update
        </Button>
        {freqNote ? <span className="text-[12px] text-ink-muted">{freqNote}</span> : null}
      </div>

      {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
    </section>
  );
}
