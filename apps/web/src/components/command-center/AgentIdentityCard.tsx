'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';

/**
 * THE AGENT, AS A THING WITH A NAME — the head of `F1`'s missing shell.
 *
 * The Command Center prototype opens with the agent introducing itself: a name,
 * a voice in three adjectives, a risk tolerance, what it is doing right now, and
 * a way through to its full identity. Eighteen of the twenty-one draft-panel
 * prototypes render this same card behind their drawer, which is how one missing
 * component looked like eighteen separate gaps.
 *
 * ── What is real here and what is derived ─────────────────────────────────
 *
 * The name is stored (`brands.agent_name`). The voice adjectives and the risk
 * tolerance are computed from `toneVector` and `approvalMode` — see
 * `packages/shared/src/agentIdentity.ts` for why storing them would let this
 * card drift from the settings it is describing, and this card is exactly where
 * that drift would be most believed.
 *
 * ── The status line is the honest part ────────────────────────────────────
 *
 * The prototype's line is "Running 2 Campaigns · Analyzing engagement signals",
 * which is a nice sentence and, if hardcoded, a lie the moment nothing is
 * running. So it is assembled from what is actually true: the campaign's real
 * status, and whether the agent is paused. When nothing is happening it says so
 * rather than inventing activity — an idle agent claiming to analyse signals is
 * the single most corrosive thing this card could do, because everything else on
 * the screen asks you to trust it.
 */

interface Governance {
  agentIdentity?: {
    name: string;
    named: boolean;
    voice: string[];
    riskTolerance: string;
    riskBecause: string;
  };
  agentPaused?: boolean;
}

export function AgentIdentityCard({
  genomeId,
  campaign,
  paused,
}: {
  genomeId: string | undefined;
  /**
   * The campaign the page already read — not fetched twice.
   *
   * Its `status` matters, not just its existence: `CampaignFocusCard` sits
   * beside this one and labels a `draft` campaign "Current Focus" with a day
   * countdown, which reads as running. Saying "no campaign is running" next to
   * that is true and looks like a contradiction, so this names the state
   * instead — a planned-but-not-activated campaign is a real and common thing
   * to be in, and it is the one the person can act on.
   */
  campaign: { name: string; status: string } | null;
  paused: boolean;
}) {
  const [gov, setGov] = useState<Governance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const res = await invoke<Governance>('brand.governance.get', {});
      setLoading(false);
      if (res.status === 'succeeded') setGov(res.output);
    })();
  }, [genomeId]);

  const id = gov?.agentIdentity;

  if (loading) {
    return (
      <section aria-busy className="rounded-xl border border-border bg-surface p-6">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-3 w-72" />
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Badge className="bg-brand-cyan/20 text-ink">Your agent</Badge>

          <h2 className="mt-3 text-[24px] font-semibold text-ink">
            {id?.named ? (
              id.name
            ) : (
              /* Not styled as a name, because it is not one. The prototype
                 assumes every agent has been named; a build has to render the
                 state before that happened. */
              <span className="text-ink-muted">Unnamed agent</span>
            )}
          </h2>

          {/* Stacked, not inline. In the two-column band the parenthetical is
              long enough that a flex row broke "Risk tolerance —" across three
              lines with the value stranded below it. */}
          <div className="mt-2 flex flex-col gap-1 text-[14px] text-ink-muted">
            <span>{id?.voice.length ? <span className="text-ink">{id.voice.join(', ')}</span> : 'No voice set'}</span>
            <span>
              Risk tolerance — <b className="font-medium text-ink">{id?.riskTolerance ?? 'Moderate'}</b>
              <span className="ml-1 text-[12.5px]">
                ({id?.riskBecause ?? 'reviewed for the first week'})
              </span>
            </span>
          </div>

          {/* Assembled from what is true. See the header. */}
          <p className="mt-3 text-[13px] text-ink-muted">
            {paused ? (
              <span className="text-warn">Paused — it will not act until you resume it.</span>
            ) : !campaign ? (
              'No campaign yet, so it is not planning anything.'
            ) : campaign.status === 'draft' ? (
              <>
                <b className="font-medium text-ink">{campaign.name}</b> is planned but not activated, so
                nothing is going out yet.
              </>
            ) : campaign.status === 'paused' ? (
              <>
                <b className="font-medium text-ink">{campaign.name}</b> is paused.
              </>
            ) : (
              <>
                Running <b className="font-medium text-ink">{campaign.name}</b>. It drafts each post the
                morning it goes out.
              </>
            )}
          </p>
        </div>

        <Link
          href="/settings/brand-kit"
          className="shrink-0 text-[14px] font-medium text-brand-purple underline underline-offset-2"
        >
          {id?.named ? 'View agent identity' : 'Give it a name'}
        </Link>
      </div>
    </section>
  );
}
