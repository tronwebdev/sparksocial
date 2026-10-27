'use client';

import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { pillarStyle } from '@/components/calendar/pillars';

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
  /** Optional because the column is: campaigns predating the wizard's step 2 have none. */
  campaignType?: 'promotion' | 'lead_magnet' | 'authority' | 'launch';
}

/** The four kinds, in the words the wizard shows when it asks. */
const TYPE_LABEL: Record<NonNullable<CampaignSummary['campaignType']>, string> = {
  promotion: 'Promotion / Offers',
  lead_magnet: 'Lead Magnet',
  authority: 'Authority / Education',
  launch: 'Launch / Announcement',
};

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
  primaryCta,
}: {
  campaign: CampaignSummary | null | undefined;
  calendarView: CalendarView | null;
  genomeName?: string;
  /** `offer.primary_cta` from the brand's genome. Absent until it is set. */
  primaryCta?: string;
}) {

  if (campaign === undefined) return <Skeleton className="h-40 w-full rounded-xl" />;

  if (campaign === null) {
    return (
      <section className="rounded-xl border border-border bg-surface p-6 text-center">
        <p className="text-16 font-medium text-ink">No campaign running yet</p>
        <p className="mx-auto mt-1 max-w-md text-14 text-ink-muted">
          {genomeName ?? 'This brand'} doesn&rsquo;t have an active campaign — plan one from the calendar to give
          the agent something to work toward.
        </p>
        <Link
          href="/calendar"
          className="mt-4 inline-flex h-11 items-center rounded bg-primary px-4 text-14 font-medium text-primary-foreground"
        >
          Plan a campaign
        </Link>
      </section>
    );
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
    <>
    <section
      // 297 is the design's, at a width where everything fits on its lines.
      // As a floor it holds that; as a height it cut the wrapped rows off the
      // bottom on a phone — "Remaining", the pillars and the CTA all clipped.
      // A size container: the media strip below needs the card, not the
      // window, to be wide — see the note on it.
      className="relative overflow-hidden rounded-xl px-[26px] py-[18px] [container-type:inline-size] max-sm:px-4"
      style={{
        minHeight: 297,
        background:
          'linear-gradient(34.352deg, #FEDEB5 -13.04%, rgba(255,255,255,0.53) 16.32%), linear-gradient(90deg, #FFFFFF 0%, #C2F4FD 100%)',
        boxShadow: 'inset 0 0 0 2px #FFFFFF',
      }}
    >
      <div className="flex flex-wrap items-start gap-x-[11px] gap-y-3">
        <span
          className="flex h-[37px] w-[124px] items-center justify-center rounded-lg text-14 font-medium text-ink"
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

      <h2 className="mt-[20px] text-34 font-semibold leading-[1.27] text-ink">{campaign.name}</h2>

      <div className="mt-[16px] flex flex-wrap items-baseline gap-x-[26px] gap-y-2 text-16 leading-[1.3]">
        <span className="text-ink-muted">
          Goal - <b className="font-semibold text-ink">{campaign.objective}</b>
        </span>
        {/*
          `windowDays` was here under a "Type" label, which made this row print
          the same number twice in the same unit — "Type - 30 days" beside
          "Remaining - 29 Days" — and never showed the type at all.

          The type was always being collected and stored; `campaign.list` just
          did not return it. An em dash where a campaign predates step 2 of the
          wizard, rather than defaulting to a kind nobody chose.
        */}
        <span className="text-ink-muted">
          Type -{' '}
          <b className="font-semibold text-ink">
            {campaign.campaignType ? TYPE_LABEL[campaign.campaignType] : '—'}
          </b>
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
      <div className="mt-[15px] flex flex-wrap items-center gap-x-6 gap-y-3">
        {pillars.length > 0 ? (
          /*
            The design overlaps its three photographs by 12px, which works
            because a face is still recognisable with a third of it hidden. A
            word is not: at -12 the next circle ate the end of the one behind
            it, and the labels were truncated to two characters to survive it —
            which rendered Teach and Team identically. Readable labels and an
            overlap cannot both be had, so the overlap goes and the labels stay.
          */
          <div className="flex items-center gap-[4px]">
            {pillars.map((pillar) => {
              const style = pillarStyle(pillar);
              return (
                <span
                  key={pillar}
                  title={style.label}
                  className={`relative flex h-[52px] w-[52px] items-center justify-center rounded-full text-12 font-semibold ${style.chip}`}
                  style={{ boxShadow: '0 0 0 2px #FFFFFF' }}
                >
                  {style.short}
                </span>
              );
            })}
          </div>
        ) : null}

        {/*
          The design's "Primary CTA - Visit Opt-in page".

          This read "there is no CTA field, so there is nothing to show" and
          rendered an em dash under a tooltip saying so. The field was there the
          whole time, one level up: a campaign has no CTA, but the *brand* does
          — `offer.primary_cta`, written by `genome.offer.set` and read verbatim
          by fourteen playbook `cta` beats. `genome.get` simply did not return
          the column, so nothing on this screen could see it.

          Still an em dash when it is unset, because that is honest and the
          wizard's step 3 asks for it. The tooltip now says where it comes from
          rather than that it does not exist.
        */}
        <span
          className="text-16 text-ink-muted"
          title={
            primaryCta
              ? 'The brand’s primary call-to-action. Every playbook that closes with one uses these words.'
              : 'Not set on this brand yet. The campaign wizard asks for it, or set it in brand settings.'
          }
        >
          Primary CTA -{' '}
          <b className={`text-14 font-semibold ${primaryCta ? 'text-link-blue' : 'text-ink-muted'}`}>
            {primaryCta || '—'}
          </b>
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
        <>
        {/* 21.2px circles at 611 and 1109 — decorative in the design (its own
            markup gives them a cursor and no handler), so they are `aria-hidden`
            rather than dead buttons. */}
        <span
          aria-hidden
          className="absolute right-[527.5px] top-[138px] hidden h-[21.2px] w-[21.2px] items-center justify-center rounded-full [@container(min-width:1050px)]:flex"
          style={{ boxShadow: 'inset 0 0 0 0.5px #838383', background: 'rgba(255,255,255,0.6)' }}
        >
          <svg width="5" height="8" viewBox="0 0 5 8" fill="none" className="-scale-x-100">
            <path d="m1 1 3 3-3 3" stroke="#838383" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span
          aria-hidden
          className="absolute right-[29px] top-[138px] hidden h-[21.2px] w-[21.2px] items-center justify-center rounded-full [@container(min-width:1050px)]:flex"
          style={{ boxShadow: 'inset 0 0 0 0.5px #838383', background: 'rgba(255,255,255,0.6)' }}
        >
          <svg width="5" height="8" viewBox="0 0 5 8" fill="none">
            <path d="m1 1 3 3-3 3" stroke="#838383" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        {/* Shown when the *card* can hold it beside the text (~1050 of the
            design's 1160). It was `xl:` — the window — and at 1366 the card
            is ~730, so the three posters sat on the title, "Remaining" and
            Adjust Frequency. */}
        <div className="absolute right-[66.2px] top-[31px] hidden items-start gap-[20.5px] [@container(min-width:1050px)]:flex">
          {upcoming.slice(0, 3).map((slot) => (
            <div
              key={slot.id}
              className="flex h-[233.8px] w-[131.5px] flex-col justify-end rounded-xl p-3"
              style={{ background: 'rgba(255,255,255,0.55)', boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.06)' }}
            >
              <span className="text-12 font-semibold text-ink">
                {slot.playbookName ?? slot.playbookId}
              </span>
              <span className="mt-1 text-12 text-ink-muted">
                {slot.scheduledAt
                  ? new Date(slot.scheduledAt).toLocaleDateString('en', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })
                  : 'unscheduled'}
              </span>
              {slot.mode === 'direct_finish' ? (
                <span className="mt-1 text-11 text-warn">needs filming</span>
              ) : null}
            </div>
          ))}
        </div>
        </>
      ) : null}

      {/*
        The three campaign-type chips, 150x38.5 at radius 11.42.

        These were under the hero, as a sibling. Rendering the prototype showed
        them inside it: the chips sit at y=478.3 and the card runs 241..538, so
        they are the hero's own bottom row, starting at the same x=26 as the
        title on a 158.5px pitch. Reading the coordinates should have told me
        that and did not — 478 is only obviously "inside 241..538" once you have
        seen the picture.

        ── Why there is one chip here and the design draws three ──────────

        The design's three are a filter — "Lead magnets", "Authority Builder",
        "Social Campaign", the first one ticked. Ours were those three literal
        strings, always with the first ticked, and `disabled` with a tooltip
        explaining that `content.list` has no playbook-family filter to drive
        them. Three problems in one control: the labels are not the four kinds a
        campaign can actually be (`promotion`, `lead_magnet`, `authority`,
        `launch` — "Social Campaign" is not one of them), the tick never moved
        off the first chip whatever the campaign was, and nothing happened when
        you pressed any of them.

        A filter is also the wrong idea *here* regardless of the backend. This
        row is inside the hero, which describes one campaign; every post in that
        campaign has that campaign's type, so filtering its own queue by
        campaign type selects either everything or nothing.

        So it states the fact it was pretending to filter on: the campaign's
        kind, in the words the wizard used when it asked, in the design's own
        active-chip style. A real filter over playbook families is a different
        control with a different backend behind it, and worth having — it is
        just not these three words with a tick glued to the first.
      */}
      <div className="mt-[15px] flex flex-wrap gap-[8.5px]">
        {campaign.campaignType ? (
          <span
            className="flex h-[38.5px] min-w-[150px] items-center justify-center gap-[7px] rounded-[11.42px] px-[14px] text-13 font-semibold"
            style={{ background: '#FFFFFF', boxShadow: 'inset 0 0 0 0.94px #838383', color: '#0C0C0C' }}
          >
            {TYPE_LABEL[campaign.campaignType]}
            <span className="inline-flex h-[13px] w-[13px] items-center justify-center rounded-full bg-ink">
              <svg width="7" height="6" viewBox="0 0 8 7" fill="none" aria-hidden>
                <path d="m1 3.4 2 2.1L7 1" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </span>
        ) : null}
      </div>

    </section>

      {/*
        ── Pause, resume and duplicate are not on this screen ─────────────

        They were, as text actions under the card, because the design's hero has
        no such control and they had to go somewhere. Two things were wrong with
        that. `order-last` put them after *every* sibling in this container
        rather than after the hero, so they rendered beneath the queue — under
        the heading "What is your Agent doing next?", which is not what they do.
        And the design does not draw them here at all; a label-diff against
        `SparkSocial Command Center.dc.html` found "Pause campaign" and
        "Duplicate" among exactly four strings on this screen that the prototype
        has no trace of.

        `campaign.pause`, `campaign.resume` and `campaign.duplicate` are all
        still registered and reachable. This removes a control the design never
        had, not a capability.
      */}

    </>
  );
}
