'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { invoke } from '@/lib/tools';

/**
 * ASKING FOR THE MISSING FACT, AT THE MOMENT IT IS STILL CHEAP.
 *
 * ── What went wrong without this ──────────────────────────────────────────
 *
 * Fourteen playbooks read their closing beat straight from
 * `genome:offer.primary_cta`. Nothing checked that it was set, so a brand with an
 * empty CTA got a campaign that looked complete: a plan, a mix, nine posts on a
 * calendar. The refusal arrived a week later, on opening one of them —
 * *"The genome has no value at offer.primary_cta"* — in a dialog whose only
 * available action was Close.
 *
 * The resolver now catches it (`unlockedBy: 'answer'`), which makes the count
 * honest. This is the other half: the count being honest is no use if the only
 * way to act on it is to leave the wizard, find the right settings screen, and
 * start again.
 *
 * ── Why it is asked here and not made a hard gate ─────────────────────────
 *
 * A campaign with no CTA is not impossible — a couple of formats have no CTA
 * beat and would build fine. Refusing to continue would therefore be refusing
 * something that works. But sailing past it silently is what produced the
 * screenshot, so the step stops and asks, and the way past it says out loud what
 * it costs: the campaign still runs, at the smaller number, and the formats
 * waiting on the answer stay unbuildable.
 */

export interface MissingFact {
  path: string;
  label: string;
  hint: string;
  fixWith: string;
}

/**
 * The tool that sets each path.
 *
 * A map rather than one generic "patch the genome at this path" tool, on purpose.
 * A tool that took an arbitrary dotted path and a string would let a component
 * write anywhere in the genome, which is the sort of surface that turns one XSS
 * into a compliance-profile change. Each path is claimed explicitly by the tool
 * that owns that part of the genome.
 */
const SETTER: Record<string, (genomeId: string, value: string) => { tool: string; input: unknown }> = {
  'offer.primary_cta': (genomeId, value) => ({
    tool: 'genome.offer.set',
    input: { genomeId, offer: { primary_cta: value } },
  }),
};

export function MissingFactsRequest({
  genomeId,
  facts,
  unlocksPosts,
  blockedPlaybooks,
  onFilled,
  onSkip,
}: {
  genomeId: string;
  facts: MissingFact[];
  unlocksPosts: number;
  blockedPlaybooks: number;
  /** Called after a successful write, so the caller can re-propose the plan. */
  onFilled: () => Promise<void>;
  onSkip: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only the ones this component knows how to write. A fact with no setter is
  // still worth naming — it tells somebody which screen to go to — but it must
  // not render a field that silently does nothing when saved.
  const writable = facts.filter((f) => SETTER[f.path]);
  const readOnly = facts.filter((f) => !SETTER[f.path]);
  const filledAll = writable.every((f) => (values[f.path] ?? '').trim().length > 0);

  const save = async () => {
    setBusy(true);
    setError(null);
    for (const fact of writable) {
      const value = (values[fact.path] ?? '').trim();
      if (!value) continue;
      const { tool, input } = SETTER[fact.path]!(genomeId, value);
      const res = await invoke<unknown>(tool, input, crypto.randomUUID());
      if (res.status !== 'succeeded') {
        setBusy(false);
        setError(
          res.status === 'failed' ? res.error.message : 'You do not have permission to change brand settings.',
        );
        return;
      }
    }
    setBusy(false);
    await onFilled();
  };

  return (
    <div className="rounded-lg border border-warn/40 bg-warn/5 p-4">
      <h3 className="text-[14px] font-medium text-ink">
        {blockedPlaybooks} of these formats need something from you first
      </h3>
      <p className="mt-1 max-w-[62ch] text-[13px] text-ink-muted">
        {/* The number is what makes this worth stopping for. "Please fill in a
            field" is bureaucracy; "this adds N posts" is a reason. */}
        {unlocksPosts > 0
          ? `Answering this adds ${unlocksPosts} more ${unlocksPosts === 1 ? 'post' : 'posts'} to the campaign. `
          : ''}
        SPARK uses these word for word — it will not invent them, and a post that needs one cannot be built
        until it is set.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3">
        {writable.map((fact) => (
          <label key={fact.path} className="grid gap-1">
            <span className="text-[13px] font-medium text-ink capitalize">{fact.label}</span>
            <span className="text-[12px] text-ink-muted">{fact.hint}</span>
            <Input
              value={values[fact.path] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [fact.path]: e.target.value }))}
              placeholder="Book now"
              className="mt-1"
              aria-label={fact.label}
            />
          </label>
        ))}

        {readOnly.map((fact) => (
          <p key={fact.path} className="text-[13px] text-ink">
            <span className="font-medium capitalize">{fact.label}</span> — {fact.hint} Set it in{' '}
            {fact.fixWith}.
          </p>
        ))}
      </div>

      {error && <p className="mt-3 text-[12px] text-destructive">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void save()} disabled={busy || !filledAll}>
          {busy ? 'Saving…' : 'Save and replan'}
        </Button>
        {/* The way past, labelled with what it costs rather than as "Skip". */}
        <Button size="sm" variant="ghost" onClick={onSkip}>
          Continue without it
        </Button>
      </div>
    </div>
  );
}
