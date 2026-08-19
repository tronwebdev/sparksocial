'use client';

import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';

/**
 * CC-01's approval-mode control — PRD §7.1/§9's approval ladder, made
 * settable rather than only enforced. `agent.approval_mode.get/.set` have
 * existed since P1 (`policy.ts` implements all three rungs); nothing in
 * `apps/web` called them until now, so a brand could be put into
 * `review_everything` by an operator and have no way to see or change it.
 *
 * The recommendation is surfaced, not just the current value —
 * `agent.approval_mode.get`'s own header comment is the product argument:
 * *"nobody switches [autopublish] on cold... review first week is the
 * setting that gets people to autopublish at all."* Hiding that behind an
 * unlabelled radio group would lose the one piece of guidance that gets
 * anyone off `review_everything`.
 */

const MODES = [
  { value: 'review_everything', label: 'Review everything', hint: 'Every post waits for you.' },
  { value: 'review_first_week', label: 'Review the first week', hint: 'Then autopublish, once you trust it.' },
  { value: 'autopublish', label: 'Autopublish', hint: 'SPARK posts without asking.' },
] as const;

interface ApprovalModeView {
  approvalMode: (typeof MODES)[number]['value'];
  graduatesInDays: number | null;
  recommended: (typeof MODES)[number]['value'];
}

export function ApprovalModeControl() {
  const [view, setView] = useState<ApprovalModeView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await invoke<ApprovalModeView>('agent.approval_mode.get', {});
      if (res.status === 'succeeded') setView(res.output);
    })();
  }, []);

  async function setMode(mode: ApprovalModeView['approvalMode']) {
    if (busy || mode === view?.approvalMode) return;
    setBusy(true);
    setError(null);
    const res = await invoke<ApprovalModeView>('agent.approval_mode.set', { mode });
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That change was gated.');
      return;
    }
    setView(res.output);
  }

  if (!view) return <Skeleton className="h-16 w-full rounded" />;

  return (
    <section className="rounded border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-ink-muted">Before publishing</p>
        {view.approvalMode === 'review_first_week' && view.graduatesInDays !== null ? (
          <span className="text-[12px] text-ink-muted">
            Graduates to autopublish in {view.graduatesInDays} day{view.graduatesInDays === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            disabled={busy}
            onClick={() => void setMode(m.value)}
            title={m.hint}
            className={`rounded-full border px-3 py-1.5 text-[13px] disabled:opacity-50 ${
              view.approvalMode === m.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-ink hover:bg-surface-muted'
            }`}
          >
            {m.label}
            {m.value === view.recommended && m.value !== view.approvalMode ? ' (recommended)' : ''}
          </button>
        ))}
      </div>

      {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
    </section>
  );
}
