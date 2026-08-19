'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';

/**
 * `learning.freeze`/`.reset` — real since 17 Aug 2026, reached from no
 * screen until now. `learning.confidence` (also real, already used nowhere
 * in `apps/web`) backs the informational read here — there is no tool that
 * reports whether a genome is currently *frozen*, so that half of this
 * panel is set-only, the same "set-only, not a viewer" gap
 * `AvatarConfigPanel.tsx`'s own doc comment already states for
 * `genome.avatar_override.set`.
 */

interface Confidence {
  confidence: number;
  active: boolean;
  arms: { pillar: string; observations: number }[];
}

export function LearningPanel() {
  const { genome } = useSelectedGenome();
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [freezeBusy, setFreezeBusy] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!genome) return;
    void (async () => {
      const res = await invoke<Confidence>('learning.confidence', { genomeId: genome.genomeId });
      if (res.status === 'succeeded') setConfidence(res.output);
    })();
  }, [genome]);

  async function setFreeze(enabled: boolean) {
    if (!genome) return;
    setFreezeBusy(true);
    setMessage(null);
    const res = await invoke<{ frozen: boolean }>('learning.freeze', { genomeId: genome.genomeId, enabled });
    setFreezeBusy(false);
    if (res.status === 'succeeded') {
      setMessage({ kind: 'ok', text: res.output.frozen ? 'Mix locked — learning.reweight is now a no-op until unfrozen.' : 'Unfrozen — the mix can learn again.' });
    } else {
      setMessage({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That request was gated.' });
    }
  }

  async function reset() {
    if (!genome) return;
    setResetBusy(true);
    setMessage(null);
    const res = await invoke<{ genomeId: string }>('learning.reset', { genomeId: genome.genomeId }, crypto.randomUUID());
    setResetBusy(false);
    setResetArmed(false);
    if (res.status === 'succeeded') {
      setMessage({ kind: 'ok', text: 'Reset to cold start — every arm and recorded outcome cleared.' });
      const conf = await invoke<Confidence>('learning.confidence', { genomeId: genome.genomeId });
      if (conf.status === 'succeeded') setConfidence(conf.output);
    } else {
      setMessage({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That request was gated.' });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">Learning</h2>
      <p className="mt-1 text-[13px] text-ink-muted">
        The mix engine learns which content pillars actually perform for this brand and reweights toward them once
        confident. Freeze to lock it where it is; reset to wipe it back to cold start.
      </p>

      {confidence ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Badge variant={confidence.active ? 'success' : 'neutral'}>
            {confidence.active ? 'Using learned mix' : 'Cold start'}
          </Badge>
          <span className="text-[13px] text-ink-muted">
            confidence {Math.round(confidence.confidence * 100)}% · {confidence.arms.length} pillar
            {confidence.arms.length === 1 ? '' : 's'} tracked
          </span>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" disabled={freezeBusy || !genome} onClick={() => void setFreeze(true)}>
          {freezeBusy ? 'Working…' : 'Freeze'}
        </Button>
        <Button size="sm" variant="outline" disabled={freezeBusy || !genome} onClick={() => void setFreeze(false)}>
          {freezeBusy ? 'Working…' : 'Unfreeze'}
        </Button>
      </div>

      <div className="mt-4 border-t border-border pt-4">
        {resetArmed ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[13px] text-destructive">Not reversible — every arm and outcome is wiped. Sure?</p>
            <Button size="sm" variant="danger" disabled={resetBusy} onClick={() => void reset()}>
              {resetBusy ? 'Resetting…' : 'Yes, reset'}
            </Button>
            <Button size="sm" variant="ghost" disabled={resetBusy} onClick={() => setResetArmed(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" disabled={!genome} onClick={() => setResetArmed(true)}>
            Reset to cold start
          </Button>
        )}
      </div>

      {message ? (
        <p className={`mt-3 text-[13px] ${message.kind === 'ok' ? 'text-success' : 'text-destructive'}`}>{message.text}</p>
      ) : null}
    </section>
  );
}
