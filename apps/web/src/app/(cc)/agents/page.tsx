'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CommandCenterShell, type CcTab } from '@/components/command-center/CommandCenterShell';
import { CommandCenterOverview } from '@/components/command-center/CommandCenterOverview';
import { SparkRailContainer } from '@/components/command-center/SparkRailContainer';
import { PerformancePanel } from '@/components/command-center/PerformancePanel';
import { RunTimeline } from '@/components/agents/RunTimeline';
import { AgentCalendarTab } from '@/components/command-center/AgentCalendarTab';
import { EngagementFeed } from '@/components/engagement/EngagementFeed';
import { EngagementGate } from '@/components/engagement/EngagementGate';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { useCcAgent } from '@/components/command-center/useCcAgent';

/**
 * The Agent Command Center — `SparkSocial Command Center.dc.html`.
 *
 * Four tabs on one screen: Overview, Agent Calendar, Performance & Learning,
 * Engagement Intelligence. The prototype switches them with local state, and so
 * does this: they share the Spark rail and the draft panel, and routing between
 * them would tear both down and rebuild them on every switch.
 *
 * The URL still carries the tab as `?tab=`, so a link to
 * `/agents?tab=engagement` works — `replace` rather than `push`, because four
 * tabs on one screen should not fill the back button with a tab history.
 *
 * ── The Calendar and Engagement tabs are the real screens ─────────────────
 *
 * Both also exist as sidebar destinations, which is the design's own IA — the
 * dashboard's nav lists Calendar and Engagement Intelligence, and the Command
 * Center lists them again as tabs. So these render `CalendarBoard` and
 * `EngagementFeed` directly rather than getting Command-Center-shaped
 * reimplementations: one component per screen, reached from two places. The
 * alternative is two calendars that drift.
 *
 * `?draft=` is read by `CommandCenterOverview`, which is why Ask Spark's draft
 * handoff points here; it forces the Overview tab, since that is where the
 * draft panel lives.
 */

const TABS: readonly CcTab[] = ['overview', 'calendar', 'performance', 'engagement'];

function isTab(v: string | null): v is CcTab {
  return v !== null && (TABS as readonly string[]).includes(v);
}

export default function CommandCenterPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { genome } = useSelectedGenome();
  /*
    The Agent Calendar tab inlines the identity the Spark rail carries
    everywhere else — it is the one tab with no rail. Same hook, so the two
    cannot disagree about the agent's name or whether it is paused.
  */
  const agent = useCcAgent(genome?.genomeId);

  const fromUrl = params.get('tab');
  const hasDraft = params.get('draft') !== null;
  const [tab, setTab] = useState<CcTab>(hasDraft ? 'overview' : isTab(fromUrl) ? fromUrl : 'overview');

  /* A link that changes `?tab=` while mounted should move the tab with it. */
  useEffect(() => {
    if (isTab(fromUrl) && fromUrl !== tab) setTab(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromUrl]);

  const onTab = useCallback(
    (next: CcTab) => {
      setTab(next);
      const q = new URLSearchParams(Array.from(params.entries()));
      q.set('tab', next);
      /*
        `draft` is an Overview-only parameter. Leaving it on the URL while the
        user moves to another tab means a later refresh silently yanks them back
        to Overview with a panel open.
      */
      if (next !== 'overview') q.delete('draft');
      router.replace(`/agents?${q.toString()}`, { scroll: false });
    },
    [params, router],
  );

  return (
    <CommandCenterShell tab={tab} onTab={onTab} rail={<SparkRailContainer />}>
      {tab === 'overview' ? (
        <div className="flex flex-col gap-10">
          <CommandCenterOverview />

          <section>
            <header className="mb-6">
              <h2 className="text-20 font-semibold text-ink">Activity</h2>
              <p className="mt-1 text-16 text-ink-muted">
                Every run SPARK has made for this brand, and every step inside it.
              </p>
            </header>
            <RunTimeline />
          </section>
        </div>
      ) : null}

      {tab === 'calendar' ? (
        <AgentCalendarTab
          genomeId={genome?.genomeId}
          paused={agent.paused}
          agentName={agent.name}
          voice={agent.voice}
          riskTolerance={agent.riskTolerance}
          reviewCount={agent.reviewCount}
          onTogglePause={() => void agent.togglePause()}
          onOpenDraft={(contentItemId) =>
            router.replace(`/agents?tab=overview&draft=${encodeURIComponent(contentItemId)}`)
          }
          busy={agent.busy}
        />
      ) : null}

      {tab === 'performance' ? <PerformancePanel genomeId={genome?.genomeId} /> : null}

      {tab === 'engagement' ? (
        <EngagementGate>
          <EngagementFeed />
        </EngagementGate>
      ) : null}
    </CommandCenterShell>
  );
}
