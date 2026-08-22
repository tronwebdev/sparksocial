'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * `WhyPopover` — CLAUDE.md invariant 4's rendering half, and PRD §7.3.
 *
 *   *"Every agent action must be explainable ('why' visible) for: trend
 *   selection, calendar recommendations, engagement classification, automation
 *   decisions."*
 *
 * ── Why this file did not exist ────────────────────────────────────────────
 *
 * It was named in five source files and in CLAUDE.md itself — *"`WhyPopover`
 * renders it"*, *"renders `why` from any tool output"* — and never written. The
 * schema half was done properly: `Explanation` carries a summary, weighted
 * factors, typed evidence and rejected alternatives; `invoke.ts` lifts it onto
 * every audit row; `agent.explain` reads it back out of Postgres.
 *
 * What reached a screen was one sentence. Six components printed
 * `Why: {summary}` as inline italic text, `factors` was rendered in exactly one
 * place (`TrendCard`, first two only), and `evidence` and `alternatives` were
 * rendered *nowhere* — computed on every decision, stored, and never shown. So
 * "explainable" meant a headline, and the asset ids, knowledge chunks and
 * metrics that actually justify a decision were unreachable without a database
 * client.
 *
 * ── Why a popover and not a panel ─────────────────────────────────────────
 *
 * The summary stays inline, because it is short and always relevant. Everything
 * beneath it is on demand: a calendar with 24 slots cannot show four factors and
 * three pieces of evidence per slot and still be reviewable at mix level, which
 * §6.8 Step 4 is explicit about (*"If the user has to open all 24 posts, the
 * product failed"*). One component, so the depth is available everywhere without
 * any screen paying for it by default.
 *
 * Deliberately not Radix: this needs no focus trap and no portal — it is
 * disclosure, not a dialog — and `<details>` gives correct keyboard and
 * screen-reader behaviour for free.
 */

/**
 * Mirrors `Explanation` in `@sparksocial/shared`, structurally.
 *
 * Not because the import is impossible — it works now, see `next.config.ts` —
 * but because what arrives here has been through JSON: dates are strings and
 * optional fields may be absent in ways the Zod type does not model. A local
 * interface describing the *wire* shape is honest about that; importing the
 * schema type would claim a guarantee the transport does not give.
 */
export interface Explanation {
  summary: string;
  factors?: Array<{ label: string; weight?: number; detail?: string }>;
  evidence?: Array<{ kind: string; id: string; note?: string }>;
  alternatives?: Array<{ option: string; rejectedBecause: string }>;
  confidence?: number;
}

/** Human labels for `evidence.kind`, which is the schema's vocabulary rather than a reader's. */
const EVIDENCE_LABEL: Record<string, string> = {
  asset: 'Asset',
  knowledge_chunk: 'Brand knowledge',
  past_post: 'Past post',
  metric: 'Metric',
  rule: 'Rule',
  trend: 'Trend',
};

export interface WhyPopoverProps {
  why: Explanation | undefined;
  /** Overrides the inline summary line — for a caller that renders its own. */
  label?: string;
  className?: string;
}

export function WhyPopover({ why, label, className }: WhyPopoverProps) {
  const [open, setOpen] = useState(false);
  if (!why?.summary) return null;

  const hasDetail =
    Boolean(why.factors?.length) || Boolean(why.evidence?.length) || Boolean(why.alternatives?.length);

  return (
    <div className={cn('mt-2', className)}>
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-[13px] italic text-ink-muted">{label ?? `Why: ${why.summary}`}</p>

        {typeof why.confidence === 'number' ? (
          <span className="text-[12px] tabular-nums text-ink-muted">
            {Math.round(why.confidence * 100)}% confident
          </span>
        ) : null}

        {/* No disclosure control when there is nothing behind it — a button that
            opens an empty box is worse than no button. */}
        {hasDetail ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="rounded text-[12px] font-medium text-primary underline decoration-dotted underline-offset-2 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--ss-ring]"
          >
            {open ? 'Hide reasoning' : 'Show reasoning'}
          </button>
        ) : null}
      </div>

      {open && hasDetail ? (
        <div className="mt-2 grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface-muted p-3">
          {why.factors?.length ? (
            <section>
              <h4 className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">What decided it</h4>
              <ul className="mt-1.5 grid grid-cols-1 gap-1.5">
                {why.factors.map((f, i) => (
                  <li key={`${f.label}-${i}`} className="flex items-baseline gap-2 text-[13px]">
                    <span className="font-medium text-ink">{f.label}</span>
                    {f.detail ? <span className="text-ink-muted">{f.detail}</span> : null}
                    {/* A weight is only meaningful next to other weights, so it
                        is rendered as a bar rather than a bare number. */}
                    {typeof f.weight === 'number' ? (
                      <span className="ml-auto flex shrink-0 items-center gap-1.5">
                        <span className="h-1 w-16 overflow-hidden rounded-full bg-border">
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{ width: `${Math.round(Math.min(1, Math.max(0, f.weight)) * 100)}%` }}
                          />
                        </span>
                        <span className="w-8 text-right text-[12px] tabular-nums text-ink-muted">
                          {Math.round(f.weight * 100)}%
                        </span>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {why.evidence?.length ? (
            <section>
              <h4 className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">What it looked at</h4>
              <ul className="mt-1.5 grid grid-cols-1 gap-1">
                {why.evidence.map((e, i) => (
                  <li key={`${e.id}-${i}`} className="text-[13px] text-ink-muted">
                    <span className="font-medium text-ink">{EVIDENCE_LABEL[e.kind] ?? e.kind}</span>{' '}
                    <span className="font-mono text-[12px]">{e.id}</span>
                    {e.note ? <span> — {e.note}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {why.alternatives?.length ? (
            <section>
              <h4 className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                What it ruled out
              </h4>
              <ul className="mt-1.5 grid grid-cols-1 gap-1">
                {why.alternatives.map((a, i) => (
                  <li key={`${a.option}-${i}`} className="text-[13px] text-ink-muted">
                    <span className="font-medium text-ink">{a.option}</span> — {a.rejectedBecause}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
