'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';

/**
 * WHY A CAMPAIGN HAS NO POSTS IN IT.
 *
 * ── The confusion this exists to end ──────────────────────────────────────
 *
 * "When you create a campaign, why is there no post draft/planned? Must I
 * explicitly create a new post?"
 *
 * No — the wizard already calls `calendar.generate` immediately after
 * `campaign.create`, exactly as §8.4 requires. What happened is that it returned
 * **zero slots and succeeded**. `calendar.generate` places posts from
 * `plan.readyPlaybookIds`, which is the set of playbooks whose *required assets
 * already exist*; a brand with an empty library has none, so there is nothing to
 * place. The call is not a failure, so the wizard reported nothing, and the
 * calendar said "Nothing scheduled yet."
 *
 * Worse, the mix bar above it read `Teach 0/3 · Offer 0/4 · Proof 0/4 · Team 0/2`
 * — thirteen planned, zero actual. That is not a display bug: the plan is sized
 * to `potentialWithCapture`, which counts formats that filming or an upload
 * *would* unlock, while the calendar can only contain what is buildable today.
 * The gap between those two numbers is the whole answer, and no screen was
 * saying it.
 *
 * ── Why the reason is fetched rather than passed in ───────────────────────
 *
 * `calendar.generate` returns `unfilledPillars` and a `why`, and both are
 * discarded by every caller. They would tell you which pillars went unfilled but
 * not what would fill them — and "which file do I need" is the actionable half.
 * `asset.gaps` answers that, grouped by missing role, with the same
 * "blocks N of M resolvable posts" arithmetic the Assets Library shows. So this
 * asks the tool that knows.
 *
 * It renders only when the calendar is genuinely empty. A campaign with posts in
 * it does not need to be told what it could also have — the Assets Library is
 * where that conversation belongs.
 */

interface Gap {
  missingRole: string;
  /** `'upload'` — a file the owner already has. `'capture'` — an afternoon filming. */
  unlockedBy: 'upload' | 'capture';
  playbooksBlocked: string[];
  impact: string;
}

interface GapsOutput {
  gaps: Gap[];
  producibleNow: number;
  producibleIfFilmed: number;
}

/** The role ids, in the words the Assets Library already uses for them. */
const ROLE_LABELS: Record<string, string> = {
  logo: 'Logo',
  brand_colors: 'Brand colours',
  knowledge: 'Knowledge',
  social_proof: 'Social proof',
  product_shot: 'Product shot',
  work_artifact: 'Work artifact',
  physical_capture: 'Physical capture',
  screen_capture: 'Screen capture',
  talent_likeness: 'Talent likeness',
};

const label = (role: string) => ROLE_LABELS[role] ?? role.replace(/_/g, ' ');

export function EmptyCalendarReason({
  genomeId,
  /** Slots the plan wanted, summed across pillars. Zero means the plan is empty too. */
  plannedCount,
  onRegenerate,
  busy,
}: {
  genomeId: string;
  plannedCount: number;
  onRegenerate?: () => void;
  busy?: boolean;
}) {
  const [data, setData] = useState<GapsOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    void (async () => {
      const res = await invoke<GapsOutput>('asset.gaps', { genomeId });
      if (cancelled) return;
      if (res.status === 'succeeded') setData(res.output);
      else setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
    })();
    return () => {
      cancelled = true;
    };
  }, [genomeId]);

  const uploads = data?.gaps.filter((g) => g.unlockedBy === 'upload') ?? [];
  const shoots = data?.gaps.filter((g) => g.unlockedBy === 'capture') ?? [];

  return (
    <div className="rounded-xl border border-warn/40 bg-warn/5 p-5">
      <h3 className="text-[15px] font-medium text-ink">
        {plannedCount > 0
          ? `${plannedCount} posts are planned, and none of them can be built yet`
          : 'Nothing can be built for this campaign yet'}
      </h3>

      {/*
        The sentence that was missing. "Nothing scheduled yet" is true and reads
        as a step the owner forgot; this says the step was taken and what stopped
        it — which is the difference between a screen that looks broken and one
        that is waiting on something nameable.
      */}
      <p className="mt-1.5 max-w-prose text-[13px] text-ink-muted">
        SPARK laid the calendar out when the campaign was created. Every format it could have used needs a
        file or a clip it does not have, so there was nothing to place. Add one of the things below and
        regenerate — nothing about the campaign needs redoing.
      </p>

      {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}
      {data === null && !error ? <Skeleton className="mt-4 h-14 w-full rounded-lg" /> : null}

      {data ? (
        <>
          {/*
            Uploads before shoots, always. A brand with nothing has both a
            "supply your logo" gap and a filming gap; ranked by how many posts
            they block the two can tie, and the honest recommendation is
            unambiguous only once the screen says which one is a drag-and-drop.
          */}
          {uploads.length > 0 ? (
            <div className="mt-4">
              <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">
                Files you probably already have
              </p>
              <ul className="mt-1.5 space-y-1">
                {uploads.map((g) => (
                  <li key={g.missingRole} className="text-[13px] text-ink">
                    <span className="font-medium">{label(g.missingRole)}</span>{' '}
                    <span className="text-ink-muted">&mdash; {g.impact}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {shoots.length > 0 ? (
            <div className="mt-4">
              <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">
                Needs filming
              </p>
              <ul className="mt-1.5 space-y-1">
                {shoots.map((g) => (
                  <li key={g.missingRole} className="text-[13px] text-ink">
                    <span className="font-medium">{label(g.missingRole)}</span>{' '}
                    <span className="text-ink-muted">&mdash; {g.impact}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/*
            No gaps and no posts is a different situation entirely, and saying
            "add an asset" would be wrong: the resolver rejected every playbook on
            the genome's own dimensions, not on a missing file. Naming that sends
            the owner to the right screen instead of to an upload button that
            will not help.
          */}
          {data.gaps.length === 0 ? (
            <p className="mt-4 text-[13px] text-ink-muted">
              No missing files were found either, which means the formats were ruled out by what SPARK
              knows about the brand rather than by what it has. Check the brand&rsquo;s answers in Settings
              &mdash; objective, proof and capture capability are what decide which formats apply.
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button asChild size="sm" variant="outline">
              <Link href="/assets">Add assets</Link>
            </Button>
            {onRegenerate ? (
              <Button size="sm" disabled={busy} onClick={onRegenerate}>
                {busy ? 'Regenerating…' : 'Regenerate the calendar'}
              </Button>
            ) : null}
            {data.producibleIfFilmed > data.producibleNow ? (
              <span className="text-[12px] text-ink-muted">
                {data.producibleNow} formats now, {data.producibleIfFilmed} once these are closed.
              </span>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
