'use client';

import { useState } from 'react';
import Link from 'next/link';
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

  /*
    Where the design has three member photographs.

    I first wrote this as the campaign's platforms and `tsc` caught it: a slot
    has no `platform` field. It has `pillar`, which is the dimension the mix
    engine actually works in - so the stack is the content pillars this campaign
    spans, in `pillarStyle`'s own colours. Real data, same shape, and no
    invented faces.
  */
  const pillars = Array.from(
    new Set((calendarView?.slots ?? []).map((slot) => slot.pillar).filter((x): x is string => Boolean(x))),
  ).slice(0, 3);

  const upcoming = (calendarView?.slots ?? [])
    .filter((s) => s.status !== 'published' && s.scheduledAt && new Date(s.scheduledAt).getTime() >= Date.now())
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())
    .slice(0, 4);

  return (
    /*
      The design's hero: 1159x297 at radius 20, a warm `#FEDEB5` sweep over a
      white-to-`#C2F4FD` base, inside a 2px white ring. It was a bordered
      `surface` card - the same treatment as every other panel, which is exactly
      what a hero should not be.

        Current Focus chip   26,18   124x37 r8.79 on `#6CE8FF`, 14.01px/500
        Edit Campaign        161,18  150x36.6 r7.43, white 40% inside a 0.57px ink ring
        Adjust Frequency     322,18  the same box
        title                26,75   34px/600
        Goal / Type / Remaining  26,134  16px grey labels, 600 ink values, 26px apart
        avatar stack         26,170  three 52px circles on a 40px pitch, platform badged
        Primary CTA          181,186 grey label, 14px/600 `#2474ED` value
        media carousel       658/810/962 at top 31, 131.5x233.8 r12, arrows at 611 and 1109
    */
    <section
      className="relative overflow-hidden rounded-xl px-[26px] py-[18px]"
      style={{
        minHeight: 297,
        background:
          'linear-gradient(34.352deg, #FEDEB5 -13.04%, rgba(255,255,255,0.53) 16.32%), linear-gradient(90deg, #FFFFFF 0%, #C2F4FD 100%)',
        boxShadow: 'inset 0 0 0 2px #FFFFFF',
      }}
    >
      <div className="flex flex-wrap items-start gap-x-[11px] gap-y-3">
        <span
          className="flex h-[37px] w-[124px] items-center justify-center rounded-lg text-[14.01px] font-medium text-ink"
          style={{ background: '#6CE8FF' }}
        >
          Current Focus
        </span>

        {/*
          "Edit Campaign" is the calendar, which is where a campaign is actually
          edited. "Adjust Frequency" scrolls to `AgentControlBar` rather than
          opening its own dial - `agent.frequency.set` has one control on this
          page and two would be two ways to disagree about the same number.
        */}
        <Link
          href="/calendar"
          className="flex h-[36.6px] w-[150px] items-center justify-center gap-2 rounded-[7.43px] text-14 font-medium text-ink"
          style={{ background: 'rgba(255,255,255,0.4)', boxShadow: 'inset 0 0 0 0.57px #0C0C0C' }}
        >
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="m12.4 4.2 3.4 3.4M2.2 17.8l.7-3.3a2 2 0 0 1 .54-1L11.2 5.7a1.7 1.7 0 0 1 2.4 0l1.4 1.4a1.7 1.7 0 0 1 0 2.4l-7.8 7.8a2 2 0 0 1-1 .54l-3.3.7-.7-.74Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Edit Campaign
        </Link>

        <a
          href="#agent-frequency"
          className="flex h-[36.6px] w-[150px] items-center justify-center rounded-[7.43px] text-14 font-medium text-ink"
          style={{ background: 'rgba(255,255,255,0.4)', boxShadow: 'inset 0 0 0 0.57px #0C0C0C' }}
        >
          Adjust Frequency
        </a>
      </div>

      <h2 className="mt-[20px] text-[34px] font-semibold leading-[1.27] text-ink">{campaign.name}</h2>

      <div className="mt-[24px] flex flex-wrap items-baseline gap-x-[26px] gap-y-2 text-16">
        <span className="text-ink-muted">
          Goal - <b className="font-semibold text-ink">{campaign.objective}</b>
        </span>
        <span className="text-ink-muted">
          Type - <b className="font-semibold text-ink">{campaign.windowDays} days</b>
        </span>
        <span className="text-ink-muted">
          Remaining - <b className="font-semibold text-ink">{remainingDays} Days</b>
        </span>
      </div>

      {/*
        The design stacks three member photographs with a platform badge on
        each. There is no per-campaign member list on `campaign.list`, and the
        platforms come from the calendar's own slots - so the stack is the
        platforms this campaign actually posts to, badged the same way, and
        nothing pretends to be a face.
      */}
      <div className="mt-[26px] flex flex-wrap items-center gap-x-6 gap-y-3">
        {pillars.length > 0 ? (
          <div className="flex items-center">
            {pillars.map((pillar, i) => {
              const style = pillarStyle(pillar);
              return (
                <span
                  key={pillar}
                  title={style.label}
                  className={`relative flex h-[52px] w-[52px] items-center justify-center rounded-full text-[13px] font-semibold ${style.chip}`}
                  style={{ boxShadow: '0 0 0 2px #FFFFFF', marginLeft: i === 0 ? 0 : -12 }}
                >
                  {style.label.slice(0, 2)}
                </span>
              );
            })}
          </div>
        ) : null}

        {/*
          The design's "Primary CTA - Visit Opt-in page". There is no CTA field
          on a campaign - not unset, absent - so this says that rather than
          rendering "not set", which would imply a control somewhere that sets
          it. `campaign.create` would need the field first.
        */}
        <span
          className="text-16 text-ink-muted"
          title="A campaign has no primary-CTA field yet, so there is nothing to show here."
        >
          Primary CTA - <b className="text-14 font-semibold text-ink-muted">&mdash;</b>
        </span>
      </div>

      {/*
        The carousel. Three 131.5x233.8 stills at radius 12 in the design; ours
        are the campaign's own next slots, and `calendar.get` gives a slot no
        media URL - so each tile names its playbook and its day rather than
        showing a photograph that is not the post's. Hidden under `xl`, where
        the left column already fills the card.
      */}
      {upcoming.length > 0 ? (
        <div className="absolute right-[29px] top-[31px] hidden items-start gap-[20.5px] xl:flex">
          {upcoming.slice(0, 3).map((slot) => (
            <div
              key={slot.id}
              className="flex h-[233.8px] w-[131.5px] flex-col justify-end rounded-xl p-3"
              style={{ background: 'rgba(255,255,255,0.55)', boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.06)' }}
            >
              <span className="text-[12px] font-semibold text-ink">
                {slot.playbookName ?? slot.playbookId}
              </span>
              <span className="mt-1 text-[11.5px] text-ink-muted">
                {slot.scheduledAt
                  ? new Date(slot.scheduledAt).toLocaleDateString('en', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })
                  : 'unscheduled'}
              </span>
              {slot.mode === 'direct_finish' ? (
                <span className="mt-1 text-[11px] text-warn">needs filming</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/*
        The three campaign-type chips, 150x38.5 at radius 11.42.

        These were under the hero, as a sibling. Rendering the prototype showed
        them inside it: the chips sit at y=478.3 and the card runs 241..538, so
        they are the hero's own bottom row, starting at the same x=26 as the
        title on a 158.5px pitch. Reading the coordinates should have told me
        that and did not — 478 is only obviously "inside 241..538" once you have
        seen the picture.

        The design's are a filter over three fixtures. Ours are inert: `content
        .list` takes a status, not a playbook family, so there is nothing to
        filter by. Drawn because the design draws them, disabled and saying why.
      */}
      <div className="mt-[22px] flex flex-wrap gap-[8.5px]">
        {['Lead magnets', 'Authority Builder', 'Social Campaign'].map((label, i) => (
          <button
            key={label}
            type="button"
            disabled
            title="Filtering by campaign type needs a playbook-family filter on content.list."
            className="flex h-[38.5px] w-[150px] items-center justify-center gap-[7px] rounded-[11.42px] text-[13.13px] font-semibold"
            style={
              i === 0
                ? { background: '#FFFFFF', boxShadow: 'inset 0 0 0 0.94px #838383', color: '#0C0C0C' }
                : {
                    background: 'rgba(131,131,131,0.05)',
                    boxShadow: 'inset 0 0 0 0.73px rgba(12,12,12,0.1)',
                    color: '#838383',
                  }
            }
          >
            {label}
            {i === 0 ? (
              <span className="inline-flex h-[13px] w-[13px] items-center justify-center rounded-full bg-ink">
                <svg width="7" height="6" viewBox="0 0 8 7" fill="none" aria-hidden>
                  <path d="m1 3.4 2 2.1L7 1" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Pause, resume and duplicate have no place in the design's hero, and
          all three are real. They sit under the meta row as text actions rather
          than competing with the two framed buttons above. */}
      <div className="mt-[18px] flex flex-wrap items-center gap-4 text-14">
        {campaign.status === 'paused' ? (
          <button type="button" disabled={busy} onClick={() => void resume()} className="font-medium text-ink underline underline-offset-2 disabled:opacity-50">
            Resume campaign
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => void pause()} className="font-medium text-ink underline underline-offset-2 disabled:opacity-50">
            Pause campaign
          </button>
        )}
        <button type="button" disabled={busy || !genomeId} onClick={() => void duplicate()} className="font-medium text-ink-muted underline underline-offset-2 disabled:opacity-50">
          Duplicate
        </button>
      </div>

      {message ? (
        <p className={`mt-3 text-14 ${message.kind === 'ok' ? 'text-success' : 'text-destructive'}`}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
