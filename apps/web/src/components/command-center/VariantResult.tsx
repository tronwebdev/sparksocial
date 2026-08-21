'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { cn } from '@/lib/utils';
import { WhyPopover, type Explanation } from '@/components/explain/WhyPopover';

/**
 * `DISC-02`'s A/B verdict, on the post it belongs to.
 *
 * ── Why this renders "no answer" states as prominently as the answer ──────
 *
 * `content.variant.result` has three named ways to have no winner — waiting for
 * the arms to publish, waiting for enough reach, and genuinely too close — and
 * they call for completely different actions: wait, wait longer, or stop
 * refreshing because the copy did not matter. A single "inconclusive" would tell
 * somebody to keep checking a test that has finished saying nothing, so each
 * gets its own sentence.
 *
 * ── The honesty is the feature ────────────────────────────────────────────
 *
 * Two posts is not a sample, and a dashboard that announces "variant B wins" off
 * 40 impressions against 44 is lying in the most comfortable possible way —
 * the number really is bigger. The tool's `why` says so and this component shows
 * it rather than tucking it behind a popover, because the caveat is the part a
 * person acting on the result most needs to read.
 *
 * Recording the outcome is a separate, explicit button. `content.variant.result`
 * writes nothing (it is `effect: 'read'`), and `learning.record_outcome` is what
 * owns the reward — computed from this brand's own baseline, never asserted by
 * the A/B verdict.
 */

interface Arm {
  contentItemId: string;
  label: string;
  status: string;
  impressions: number;
  engagements: number;
  engagementRate: number | null;
}

interface Result {
  variantGroupId: string;
  arms: Arm[];
  winner: string | null;
  undecidedBecause: 'awaiting_publish' | 'awaiting_metrics' | 'too_close' | null;
  winnerContentItemId: string | null;
  why: Explanation;
}

const HEADLINE: Record<NonNullable<Result['undecidedBecause']>, string> = {
  awaiting_publish: 'Waiting for both arms to go out',
  awaiting_metrics: 'Not enough reach to compare yet',
  too_close: 'Too close to call',
};

const rate = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`);

export function VariantResult({
  genomeId,
  variantGroupId,
}: {
  genomeId: string | undefined;
  variantGroupId: string;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState<string | null>(null);

  useEffect(() => {
    if (!genomeId) return;
    let cancelled = false;

    void (async () => {
      setResult(null);
      setError(null);
      const res = await invoke<Result>('content.variant.result', { genomeId, variantGroupId });
      if (cancelled) return;
      if (res.status !== 'succeeded') {
        setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
        return;
      }
      setResult(res.output);
    })();

    return () => {
      cancelled = true;
    };
  }, [genomeId, variantGroupId]);

  async function record() {
    if (!genomeId || !result?.winnerContentItemId) return;
    setRecording(true);
    const res = await invoke<{ recorded: boolean; pillar: string; reward: number }>('learning.record_outcome', {
      genomeId,
      contentItemId: result.winnerContentItemId,
    });
    setRecording(false);
    setRecorded(
      res.status === 'succeeded'
        ? `Recorded against ${res.output.pillar} — scored ${res.output.reward.toFixed(2)} against this brand's own recent average.`
        : res.status === 'failed'
          ? res.error.message
          : 'Recording needs approval first.',
    );
  }

  if (!genomeId) return null;
  if (error) return <p className="text-[12px] text-destructive">{error}</p>;
  if (!result) return <Skeleton className="h-24 w-full rounded-lg" />;

  const winnerArm = result.arms.find((a) => a.label === result.winner);

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] font-medium text-ink">
          {result.winner
            ? `Arm ${result.winner.toUpperCase()} did better`
            : HEADLINE[result.undecidedBecause ?? 'too_close']}
        </p>
        <Badge variant={result.winner ? 'success' : 'neutral'}>A/B test</Badge>
      </div>

      <table className="mt-2 w-full border-collapse text-[12px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
            <th className="pb-1 pr-3 font-medium">Arm</th>
            <th className="pb-1 pr-3 font-medium">Status</th>
            <th className="pb-1 pr-3 text-right font-medium">Seen</th>
            <th className="pb-1 pr-3 text-right font-medium">Interactions</th>
            <th className="pb-1 text-right font-medium">Rate</th>
          </tr>
        </thead>
        <tbody>
          {result.arms.map((a) => (
            <tr key={a.contentItemId} className={cn('border-t border-rule-soft', a.label === result.winner && 'font-medium')}>
              <td className="py-1 pr-3 uppercase text-ink">{a.label}</td>
              <td className="py-1 pr-3 text-ink-muted">{a.status.replace(/_/g, ' ')}</td>
              <td className="py-1 pr-3 text-right tabular-nums text-ink-muted">{a.impressions.toLocaleString()}</td>
              <td className="py-1 pr-3 text-right tabular-nums text-ink-muted">{a.engagements.toLocaleString()}</td>
              <td className="py-1 text-right tabular-nums text-ink">{rate(a.engagementRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Inline, not behind the popover: the caveat is the part somebody acting
          on this most needs to read. */}
      <p className="mt-2 text-[12px] text-ink-muted">{result.why.summary}</p>
      <WhyPopover why={result.why} label="How this was decided" />

      {result.winnerContentItemId && !recorded ? (
        <Button size="sm" variant="outline" className="mt-2" disabled={recording} onClick={() => void record()}>
          {recording ? 'Recording…' : `Teach SPARK from arm ${result.winner?.toUpperCase()}`}
        </Button>
      ) : null}
      {recorded ? <p className="mt-2 text-[12px] text-ink-muted">{recorded}</p> : null}

      {winnerArm && result.winner && !winnerArm.engagementRate ? (
        <p className="mt-2 text-[12px] text-warn">
          The winning arm has no measured engagement rate — check the post actually reached anybody before acting
          on this.
        </p>
      ) : null}
    </div>
  );
}
