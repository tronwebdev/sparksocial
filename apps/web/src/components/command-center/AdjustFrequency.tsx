'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { toast } from 'sonner';
import { invoke } from '@/lib/tools';
import { userMessage } from '@/lib/errorCopy';
import type { AgentStatusView } from './AgentControlBar';

/** `agent.frequency.set`'s own bounds — `packages/campaign/src/agentControl.ts`. */
const MIN = 1;
const MAX = 14;

/**
 * "Adjust Frequency" — the button and the small dial it opens.
 *
 * Two screens draw this button and neither had a working one. The Command
 * Center's linked to `#agent-frequency`, an anchor on `AgentControlBar`, which
 * moved to Settings → Brand Kit and took the id with it — so the link went
 * nowhere. The dashboard banner had a dial, but it opened on 5 whatever the
 * agent was set to, and allowed 21 against a tool that refuses anything over 14.
 *
 * One component for both: it reads the current value from `agent.status` when
 * it opens, holds the input to the tool's bounds, and says what happened in a
 * toast, which is how the prototype answers this button.
 */
export function AdjustFrequency({
  className,
  style,
  children = 'Adjust Frequency',
  onChanged,
}: {
  className: string;
  style?: CSSProperties;
  children?: ReactNode;
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string>('');
  const [current, setCurrent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    void (async () => {
      const res = await invoke<AgentStatusView>('agent.status', {});
      if (cancelled || res.status !== 'succeeded') return;
      setCurrent(res.output.postsPerWeek);
      setValue(String(res.output.postsPerWeek));
    })();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  async function save() {
    const postsPerWeek = Number(value);
    if (!Number.isInteger(postsPerWeek) || postsPerWeek < MIN || postsPerWeek > MAX) {
      setError(`Pick a whole number from ${MIN} to ${MAX}.`);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await invoke<AgentStatusView>('agent.frequency.set', { postsPerWeek });
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? userMessage(res.error) : 'That change is waiting for approval.');
      return;
    }
    setOpen(false);
    toast(`Your agent will post ${postsPerWeek} time${postsPerWeek === 1 ? '' : 's'} a week`);
    onChanged?.();
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={className}
        style={style}
      >
        {children}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Posting frequency"
          className="absolute left-0 top-[44px] z-30 w-[236px] animate-menu-in rounded-md bg-white p-3 text-left shadow-overlay motion-reduce:animate-none"
        >
          <label className="block text-14 text-ink-muted" htmlFor="ss-freq">
            Posts per week
          </label>
          <input
            id="ss-freq"
            type="number"
            min={MIN}
            max={MAX}
            value={value}
            placeholder="…"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
            className="mt-1.5 h-10 w-full rounded border border-border px-3 text-16 text-ink outline-none"
          />
          {error ? <p className="mt-1.5 text-13 text-destructive">{error}</p> : null}
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || value === '' || Number(value) === current}
            className="mt-2 h-9 w-full rounded bg-ink text-14 font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Set frequency'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
