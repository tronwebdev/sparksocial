'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { pillarStyle } from '@/components/calendar/pillars';
import { invoke } from '@/lib/tools';

/**
 * The prototype's "Current Focus" hero card (`SparkSocial Command
 * Center.dc.html:92-130`) — real campaign data instead of a fixed "Lead
 * magnet campaign" mock. "Edit Campaign" and "Adjust Frequency" become one
 * real link to `/calendar` (`CAL-01`→`CAL-06` is where mix adjustment
 * actually lives) plus the frequency control this page already has in
 * `AgentControlBar` — repurposing decorative buttons into real ones is what
 * `CalendarBoard`/`RunTimeline` already did rather than building screens the
 * mockup implies but nothing here can do yet.
 *
 * `campaign.pause`/`.resume`/`.duplicate` — real since 17 Aug 2026, reached
 * from no screen until now. This is the only campaign view that exists
 * (there is no list/detail screen — one active campaign per genome, chosen
 * as `campaigns[0]` from `campaign.list` in `CommandCenterOverview.tsx`),
 * so its action buttons are the natural home rather than inventing one.
 * Duplicate uses `campaign.duplicate`'s own sensible defaults (name
 * "(copy)", startAt now) rather than a name/date form — nothing here can
 * rename a campaign after creation either way, so a form would only add a
 * step without adding a capability.
 */

export interface CampaignSummary {
  campaignId: string;
  name: string;
  objective: string;
  windowDays: number;
  startAt: string;
  status: string;
}

interface Slot {
  id: string;
  scheduledAt: string | null;
  pillar: string | null;
  playbookId: string | null;
  playbookName: string | null;
  mode: string | null;
  status: string;
}

export interface CalendarView {
  campaignId: string;
  name: string;
  objective: string;
  status: string;
  mixActual: Array<{ pillar: string; count: number }>;
  slots: Slot[];
}

export function CampaignFocusCard({
  campaign,
  calendarView,
  genomeName,
  genomeId,
  onRefresh,
}: {
  campaign: CampaignSummary | null | undefined;
  calendarView: CalendarView | null;
  genomeName?: string;
  /** `campaign.list`'s output doesn't carry a genomeId per row (it's implicit in the request that scoped the list) — `campaign.duplicate` needs one explicitly, so it comes down as its own prop. */
  genomeId?: string;
  /** Re-fetches `campaign.list`/`calendar.get` in the parent after pause/resume/duplicate changes campaign state. */
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  if (campaign === undefined) return <Skeleton className="h-40 w-full rounded-xl" />;

  if (campaign === null) {
    return (
      <section className="rounded-xl border border-border bg-surface p-6 text-center">
        <p className="text-[16px] font-medium text-ink">No campaign running yet</p>
        <p className="mx-auto mt-1 max-w-md text-[14px] text-ink-muted">
          {genomeName ?? 'This brand'} doesn&rsquo;t have an active campaign — plan one from the calendar to give
          the agent something to work toward.
        </p>
        <Link
          href="/calendar"
          className="mt-4 inline-flex h-11 items-center rounded bg-primary px-4 text-[14px] font-medium text-primary-foreground"
        >
          Plan a campaign
        </Link>
      </section>
    );
  }

  async function pause() {
    setBusy(true);
    setMessage(null);
    const res = await invoke<{ status: string }>('campaign.pause', { campaignId: campaign!.campaignId });
    setBusy(false);
    if (res.status === 'succeeded') onRefresh();
    else setMessage({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That request was gated.' });
  }

  async function resume() {
    setBusy(true);
    setMessage(null);
    const res = await invoke<{ status: string }>('campaign.resume', { campaignId: campaign!.campaignId });
    setBusy(false);
    if (res.status === 'succeeded') onRefresh();
    else setMessage({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That request was gated.' });
  }

  async function duplicate() {
    if (!genomeId) return;
    setBusy(true);
    setMessage(null);
    // idempotent: false — creates a genuinely new campaign each call.
    const res = await invoke<{ campaignId: string; name: string }>(
      'campaign.duplicate',
      { genomeId, campaignId: campaign!.campaignId },
      crypto.randomUUID(),
    );
    setBusy(false);
    if (res.status === 'succeeded') {
      setMessage({ kind: 'ok', text: `Duplicated as "${res.output.name}" — its calendar starts empty. Find it from the calendar.` });
    } else {
      setMessage({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That request was gated.' });
    }
  }

  const remainingDays = Math.max(
    0,
    campaign.windowDays - Math.floor((Date.now() - new Date(campaign.startAt).getTime()) / 86_400_000),
  );

  const upcoming = (calendarView?.slots ?? [])
    .filter((s) => s.status !== 'published' && s.scheduledAt && new Date(s.scheduledAt).getTime() >= Date.now())
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())
    .slice(0, 4);

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Badge className="bg-brand-cyan/20 text-ink">Current Focus</Badge>
          <h2 className="mt-3 text-[24px] font-semibold text-ink">{campaign.name}</h2>
          <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[14px] text-ink-muted">
            <span>
              Objective — <b className="font-medium text-ink">{campaign.objective}</b>
            </span>
            <span>
              Window — <b className="font-medium text-ink">{campaign.windowDays} days</b>
            </span>
            <span>
              Remaining — <b className="font-medium text-ink">{remainingDays} days</b>
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/calendar" className="text-[14px] font-medium text-brand-purple underline underline-offset-2">
            View calendar
          </Link>
          {campaign.status === 'paused' ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void resume()}>
              Resume
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void pause()}>
              Pause
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy || !genomeId} onClick={() => void duplicate()}>
            Duplicate
          </Button>
        </div>
      </div>

      {message ? (
        <p className={`mt-3 text-[13px] ${message.kind === 'ok' ? 'text-success' : 'text-destructive'}`}>{message.text}</p>
      ) : null}

      {calendarView?.mixActual.length ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {calendarView.mixActual.map((m) => {
            const style = pillarStyle(m.pillar);
            return (
              <span
                key={m.pillar}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium ${style.chip}`}
              >
                {style.label} · {m.count}
              </span>
            );
          })}
        </div>
      ) : null}

      {upcoming.length > 0 ? (
        <div className="mt-5 border-t border-border pt-4">
          <p className="mb-3 text-[13px] font-medium text-ink-muted">What the agent is doing next</p>
          <ul className="grid grid-cols-1 gap-2">
            {upcoming.map((slot) => {
              const style = pillarStyle(slot.pillar);
              return (
                <li key={slot.id} className="flex items-center gap-3 text-[14px]">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
                  <span className="text-ink-muted">
                    {new Date(slot.scheduledAt!).toLocaleDateString('en', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                  <span className="truncate font-medium text-ink">{slot.playbookName ?? slot.playbookId}</span>
                  {slot.mode === 'direct_finish' ? <span className="text-[12px] text-warn">needs filming</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
