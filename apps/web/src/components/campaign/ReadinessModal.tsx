'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import type { ToolOutput } from '@/lib/toolTypes.generated';

/**
 * WHAT WOULD STOP THIS CAMPAIGN WORKING — shown before it is created.
 *
 * The same facts `EmptyCalendarReason` reports, moved in front of the decision
 * instead of after it. A brand used to create a campaign, watch
 * `calendar.generate` place zero slots and *succeed*, and find out from an empty
 * month that it needed a logo. The information existed the whole time; nothing
 * asked for it at the moment it could still change what somebody did.
 *
 * ── Two lists, not one ────────────────────────────────────────────────────
 *
 * Blockers mean the campaign produces nothing. Warnings mean it produces less.
 * A single undifferentiated checklist teaches people to click past it, because
 * most of the time most of it is optional — and the one time it is not looks
 * identical.
 *
 * ── It does not block ─────────────────────────────────────────────────────
 *
 * The primary action stays available throughout. A brand may want the campaign
 * now and the files on Friday, and that is a legitimate choice this screen has
 * no standing to overrule. What it owes them is the consequence stated plainly
 * first — which is why the button says "Create anyway" when something would
 * stop it, and "Create campaign" when nothing would.
 */

type Readiness = ToolOutput<'campaign.readiness'>;

export interface ReadinessModalProps {
  genomeId: string;
  objective: string;
  windowDays: number;
  onProceed: () => void;
  onClose: () => void;
}

export function ReadinessModal({ genomeId, objective, windowDays, onProceed, onClose }: ReadinessModalProps) {
  const [data, setData] = useState<Readiness | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await invoke<Readiness>('campaign.readiness', { genomeId, objective, windowDays });
      if (cancelled) return;
      if (res.status !== 'succeeded') {
        /*
         * A readiness check that cannot run must not become a gate. Failing open
         * here keeps this advisory — the campaign was creatable before this
         * screen existed, and a broken advisory is not a reason to stop.
         */
        setError(res.status === 'failed' ? res.error.message : 'That check needs an approval this screen cannot give.');
        return;
      }
      setData(res.output);
    })();
    return () => {
      cancelled = true;
    };
  }, [genomeId, objective, windowDays]);

  const blockers = (data?.items ?? []).filter((i) => i.severity === 'blocker');
  const warnings = (data?.items ?? []).filter((i) => i.severity === 'warning');
  const total = data ? Math.max(data.potentialTotal, 1) : 1;
  const pct = data ? Math.round((data.buildableNow / total) * 100) : 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Campaign readiness"
      onClick={onClose}
    >
      <div
        className="max-h-[86vh] w-full max-w-[560px] overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {error ? (
          <>
            <h2 className="text-[18px] font-semibold text-ink">Could not check readiness</h2>
            <p className="mt-1 text-[13px] text-ink-muted">{error}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={onClose}>
                Back
              </Button>
              <Button size="sm" onClick={onProceed}>
                Create campaign
              </Button>
            </div>
          </>
        ) : !data ? (
          <>
            <h2 className="text-[18px] font-semibold text-ink">Checking what this campaign needs…</h2>
            <Skeleton className="mt-4 h-24 w-full rounded-lg" />
          </>
        ) : (
          <>
            <h2 className="text-[18px] font-semibold text-ink">
              {data.ready ? 'Ready to go' : blockers.length > 0 ? 'This campaign would produce nothing yet' : 'This campaign will be thin'}
            </h2>
            <p className="mt-1 text-[13px] text-ink-muted">{data.why.summary}</p>

            {/* The gap the calendar could never explain: what is buildable today
                against what this window could hold once everything is closed. */}
            <div className="mt-4">
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="font-medium text-ink">
                  {data.buildableNow} of {data.potentialTotal} formats buildable today
                </span>
                <span className="text-ink-muted">{pct}%</span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{
                    width: `${pct}%`,
                    background: blockers.length > 0 ? 'var(--ss-set-offline, #d9534f)' : 'var(--ss-set-online, #3faf6b)',
                  }}
                />
              </div>
            </div>

            {blockers.length > 0 ? (
              <Section title="Stops it working" tone="blocker" items={blockers} />
            ) : null}
            {warnings.length > 0 ? (
              <Section title="Would add more posts" tone="warning" items={warnings} />
            ) : null}

            {data.items.length === 0 ? (
              <p className="mt-4 rounded-lg bg-success/10 p-3 text-[13px] text-ink">
                Nothing is missing. Every format this window can hold resolves against what the brand already has.
              </p>
            ) : null}

            <div className="mt-6 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={onClose}>
                Back
              </Button>
              <Button size="sm" variant={blockers.length > 0 ? 'outline' : 'primary'} onClick={onProceed}>
                {blockers.length > 0 ? 'Create anyway' : 'Create campaign'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  tone,
  items,
}: {
  title: string;
  tone: 'blocker' | 'warning';
  items: Readiness['items'];
}) {
  return (
    <div className="mt-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{title}</p>
      <ul className="mt-2 space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-lg border p-3"
            style={{
              borderColor: tone === 'blocker' ? 'var(--ss-set-offline, #d9534f)' : 'var(--ss-warn, #d9a441)',
              background: tone === 'blocker' ? 'rgba(217,83,79,0.06)' : 'rgba(217,164,65,0.08)',
            }}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[14px] font-medium text-ink">{item.label}</span>
              {/* Zero means it is not a post count — a missing connection blocks
                  publishing, not planning — so the badge is omitted rather than
                  claiming it unlocks nothing. */}
              {item.unlocksPosts > 0 ? (
                <span className="shrink-0 text-[12px] text-ink-muted">+{item.unlocksPosts} posts</span>
              ) : null}
            </div>
            <p className="mt-0.5 text-[12px] text-ink-muted">{item.hint}</p>
            <p className="mt-1 text-[12px] font-medium text-accent">{item.fixWith}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
