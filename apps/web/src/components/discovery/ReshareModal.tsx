'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModalShell } from '@/components/common/ModalShell';
import { invoke } from '@/lib/tools';
import { compactVolume, saturationWord, sourceLabel, type RankedTrendItem } from './TrendCard';

/**
 * Re-share — the composer the supplied design draws, and a different thing from
 * the one that was here.
 *
 * ── What changed, and why ─────────────────────────────────────────────────
 *
 * The previous version was built around `trend.reshare`, which takes a
 * **contentItemId** and reframes one of your existing posts around a trend. It
 * was a reasonable reading of the name with no design to check it against — the
 * prototype's handler is `this.toast("Re-share composer — mock")`.
 *
 * The design that arrived is a campaign composer: a goal, a CTA URL, a caption
 * steer, a set of accounts, then Publish — and a confirmation panel headed
 * "Campaign Published … here's what I'll do". So Re-share means *run this trend
 * as a campaign*, and that maps onto `campaign.create`, which already takes
 * every field on the form: `objective`, `primaryCta`, `platforms`, `windowDays`.
 *
 * `trend.reshare` is not called from this screen any more. It is still
 * registered and still correct; it answers a question this composer does not
 * ask.
 *
 * ── The two fields with no home ───────────────────────────────────────────
 *
 * **Ai Generated Caption** is not a campaign field. It is carried into the
 * first draft's `intent`, which is the field that steers what SPARK writes —
 * so typing here changes the post, and leaving it blank means SPARK writes it,
 * exactly as the placeholder says.
 *
 * **Activate Brand Kit** has nothing to store it. The kit is applied by the
 * composer at render time from the brand's own settings
 * (`BeatComposition`'s `brandKit`), and there is no per-campaign override
 * anywhere in the schema. The switch is drawn because the design has it, and it
 * says what it is rather than pretending to a setting that would be silently
 * dropped.
 */

interface PlatformRow {
  platform: string;
  connected: boolean;
  accountLabel?: string;
}

/** The six the tool takes, in the owner's words rather than the enum's. */
const GOALS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'leads', label: 'Get more leads' },
  { value: 'bookings', label: 'Get more bookings' },
  { value: 'trials', label: 'Start more trials' },
  { value: 'sales', label: 'Sell more' },
  { value: 'audience', label: 'Send audience to my website' },
  { value: 'hiring', label: 'Hire people' },
];

/** The design says "Duration - 14 Days" and offers no control for it. */
const WINDOW_DAYS = 14;

const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  x: 'X',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  threads: 'Threads',
  pinterest: 'Pinterest',
};

function label(p: PlatformRow): string {
  return p.accountLabel ?? PLATFORM_LABEL[p.platform] ?? p.platform;
}

export function ReshareModal({
  trend,
  genomeId,
  onClose,
  onOpenDraft,
}: {
  trend: RankedTrendItem;
  genomeId: string;
  onClose: () => void;
  onOpenDraft: (contentItemId: string) => void;
}) {
  const [accounts, setAccounts] = useState<PlatformRow[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [goal, setGoal] = useState<string>('leads');
  const [cta, setCta] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<{ campaignId: string; contentItemId?: string } | null>(null);

  const load = useCallback(async () => {
    const res = await invoke<{ platforms: PlatformRow[] }>('integration.health', { genomeId });
    if (res.status !== 'succeeded') {
      setAccounts([]);
      return;
    }
    const connected = res.output.platforms.filter((p) => p.connected);
    setAccounts(connected);
    /* Every connected account pre-selected, which is what the design's chip row
       shows — and the honest default for "post this everywhere I post". */
    setChosen(connected.map((p) => p.platform));
  }, [genomeId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function publish() {
    if (busy) return;
    const url = cta.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      setError('The CTA needs to be a full URL, starting with http:// or https://');
      return;
    }
    setBusy(true);
    setError(null);

    const created = await invoke<{ campaignId: string }>(
      'campaign.create',
      {
        genomeId,
        name: trend.topic.slice(0, 120),
        objective: goal,
        windowDays: WINDOW_DAYS,
        platforms: chosen,
        ...(url ? { primaryCta: url } : {}),
      },
      /* Not idempotent — two presses are two campaigns — so a fresh key per
         press, the same rule `asset.folder.create` follows. */
      crypto.randomUUID(),
    );
    if (created.status !== 'succeeded') {
      setBusy(false);
      setError(created.status === 'failed' ? created.error.message : 'That request was gated.');
      return;
    }

    /* The first post of the campaign, from this trend. Its failure does not
       undo the campaign — the campaign is real either way, and saying "campaign
       created, first post did not" beats rolling back something the person
       just watched succeed. */
    const drafted = await invoke<{ contentItemId: string }>(
      'content.draft',
      {
        genomeId,
        fromTrendId: trend.trendId,
        intent:
          caption.trim() ||
          `Re-share of the "${trend.topic}" trend${url ? `, routing to ${url}` : ''}.`,
      },
      crypto.randomUUID(),
    );

    setBusy(false);
    setPublished({
      campaignId: created.output.campaignId,
      ...(drafted.status === 'succeeded' ? { contentItemId: drafted.output.contentItemId } : {}),
    });
  }

  if (published) {
    return (
      <PublishedPanel
        trend={trend}
        goal={GOALS.find((g) => g.value === goal)?.label ?? goal}
        cta={cta.trim()}
        accounts={(accounts ?? []).filter((a) => chosen.includes(a.platform)).map(label)}
        hasDraft={!!published.contentItemId}
        onView={() => (published.contentItemId ? onOpenDraft(published.contentItemId) : onClose())}
        onClose={onClose}
      />
    );
  }

  return (
    <ModalShell
      top={60}
      height={640}
      width={470}
      radius={20}
      label="Re-share this trend"
      gradientTo="#F4F7FD"
      onClose={onClose}
    >
      <div className="flex items-center gap-[11px] px-[22px] pt-[20px]">
        <span
          className="flex h-[36px] items-center gap-[8px] rounded-[10px] px-[13px] text-[15px] font-semibold text-ink"
          style={{ background: 'rgba(131,131,131,0.10)' }}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M4.5 2.5 2 5l2.5 2.5M2 5h9a3 3 0 0 1 3 3M11.5 13.5 14 11l-2.5-2.5M14 11H5a3 3 0 0 1-3-3" stroke="#0C0C0C" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Re-share
        </span>
        <span
          aria-hidden
          title="Runs this trend as a campaign: SPARK posts to the accounts you pick, for 14 days, pointing at your CTA."
          className="flex h-[17px] w-[17px] items-center justify-center rounded-full text-[11px] font-bold"
          style={{ color: '#9A9A9A', boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.5)' }}
        >
          i
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] pb-[6px]">
        {/* The trend, restated — you are about to spend two weeks of posting on it. */}
        <div className="mt-[18px] flex items-start gap-[14px]">
          <span className="relative block h-[62px] w-[96px] shrink-0 overflow-hidden rounded-[10px]" style={{ background: '#EFEFEF' }}>
            {trend.media ? (
              <img src={trend.media.url} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
            ) : null}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold text-ink" title={trend.topic}>
              {trend.topic}
            </p>
            <p className="mt-[4px] flex flex-wrap items-center gap-x-[10px] gap-y-[2px] text-[12.5px] font-medium">
              <span style={{ color: '#5B5B5B' }}>
                Vol: <span style={{ color: '#2F8291' }}>{compactVolume(trend.metrics.volume)}</span>
              </span>
              {trend.metrics.growth !== 0 ? (
                <span style={{ color: '#5B5B5B' }}>
                  7d <span style={{ color: '#1E8C42' }}>+{Math.round(trend.metrics.growth * 100)}%</span>
                </span>
              ) : null}
              <span style={{ color: '#5B5B5B' }}>
                Saturation: <span style={{ color: '#B4762A' }}>{saturationWord(trend.metrics.saturation)}</span>
              </span>
            </p>
            <p className="mt-[4px] text-[12px] font-semibold" style={{ color: '#838383' }}>
              {sourceLabel(trend.source)}
            </p>
          </div>
        </div>

        <Field label="Enter Goal">
          <select
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="h-[48px] w-full appearance-none rounded-[11px] bg-white px-[16px] text-[15px] font-medium text-ink outline-none"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
          >
            {GOALS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Add CTA URL">
          <input
            value={cta}
            onChange={(e) => setCta(e.target.value)}
            placeholder="Enter URL"
            inputMode="url"
            className="h-[48px] w-full rounded-[11px] bg-white px-[16px] text-[15px] font-medium text-ink outline-none placeholder:text-[#B0B0B0]"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
          />
        </Field>

        <Field label="Ai Generated Caption">
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={3}
            placeholder="Ai will write a caption that reroutes to your CTA"
            className="w-full resize-none rounded-[11px] bg-white px-[16px] py-[12px] text-[15px] font-medium text-ink outline-none placeholder:text-[#B0B0B0]"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
          />
        </Field>

        <div className="mt-[16px] flex flex-wrap gap-[14px]">
          <div className="min-w-[190px] flex-1">
            <p className="text-[14px] font-medium text-ink">Select Account</p>
            <select
              value=""
              onChange={(e) => {
                const p = e.target.value;
                if (p) setChosen((cur) => (cur.includes(p) ? cur : [...cur, p]));
              }}
              className="mt-[8px] h-[48px] w-full appearance-none rounded-[11px] bg-white px-[16px] text-[15px] font-medium text-ink outline-none"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
            >
              <option value="">
                {accounts === null
                  ? 'Loading…'
                  : accounts.length === 0
                    ? 'No connected accounts'
                    : 'Add an account'}
              </option>
              {(accounts ?? [])
                .filter((a) => !chosen.includes(a.platform))
                .map((a) => (
                  <option key={a.platform} value={a.platform}>
                    {label(a)}
                  </option>
                ))}
            </select>
          </div>

          <div className="min-w-[190px] flex-1">
            <p className="text-[14px] font-medium text-ink">Brand Kit</p>
            <div
              title="The brand kit is applied when a post is rendered, from Settings → Brand Kit. There is no per-campaign override to store, so this switch would not survive the Publish."
              className="mt-[8px] flex h-[48px] cursor-not-allowed items-center justify-between rounded-[11px] bg-white px-[16px] opacity-70"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
            >
              <span className="text-[14.5px] font-medium text-ink-muted">Always on</span>
              <span aria-hidden className="relative block h-[22px] w-[38px] rounded-full" style={{ background: 'var(--ss-lib-toggle)' }}>
                <span className="absolute right-[3px] top-[3px] block h-[16px] w-[16px] rounded-full bg-white" />
              </span>
            </div>
          </div>
        </div>

        <p className="mt-[16px] text-[12.5px]" style={{ color: '#9A9A9A' }}>
          Selected Accounts
        </p>
        <div className="mt-[8px] flex flex-wrap gap-[9px]">
          {chosen.length === 0 ? (
            <p className="text-[13px] text-ink-muted">
              None — SPARK will post wherever each format is meant for.
            </p>
          ) : (
            chosen.map((p) => {
              const row = (accounts ?? []).find((a) => a.platform === p);
              return (
                <span
                  key={p}
                  className="flex h-[34px] items-center gap-[8px] rounded-[9px] bg-white pl-[10px] pr-[8px] text-[13.5px] font-semibold text-ink"
                  style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
                >
                  {row ? label(row) : PLATFORM_LABEL[p] ?? p}
                  <button
                    type="button"
                    onClick={() => setChosen((cur) => cur.filter((x) => x !== p))}
                    aria-label={`Remove ${row ? label(row) : p}`}
                    className="flex h-[18px] w-[18px] items-center justify-center rounded-full transition-colors hover:bg-[rgba(243,85,37,0.1)]"
                  >
                    <svg width="8" height="8" viewBox="0 0 11 11" fill="none" aria-hidden>
                      <path d="m1 1 9 9m0-9-9 9" stroke="#F35525" strokeWidth="1.9" strokeLinecap="round" />
                    </svg>
                  </button>
                </span>
              );
            })
          )}
        </div>

        {error ? <p className="mt-[12px] text-[13.5px] text-destructive">{error}</p> : null}
      </div>

      <div className="flex items-center justify-center gap-[16px] px-[22px] py-[16px]">
        <button
          type="button"
          onClick={onClose}
          className="flex h-[44px] items-center gap-[9px] rounded-[10px] bg-white px-[18px] transition-colors hover:bg-[#F4F5F7]"
          style={{ boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.35)' }}
        >
          <svg width="12" height="12" viewBox="0 0 15 15" fill="none" aria-hidden>
            <path d="m1.5 1.5 12 12m0-12-12 12" stroke="#838383" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <span className="text-[15px] font-medium" style={{ color: '#838383' }}>
            Cancel
          </span>
        </button>

        <button
          type="button"
          onClick={() => void publish()}
          disabled={busy}
          className="flex h-[44px] items-center gap-[14px] rounded-[10px] bg-white px-[20px] text-[15.5px] font-semibold text-ink transition-transform hover:scale-[1.02] active:scale-[0.99] disabled:opacity-60"
          style={{ boxShadow: 'inset 0 0 0 1.4px rgba(12,12,12,0.55)' }}
        >
          {busy ? 'Publishing…' : 'Publish'}
          <svg width="8" height="14" viewBox="0 0 8 16" fill="none" aria-hidden>
            <path d="m1 1 6 7-6 7" stroke="#0C0C0C" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </ModalShell>
  );
}

function Field({ label: text, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-[16px]">
      <p className="text-[14px] font-medium text-ink">{text}</p>
      <div className="mt-[8px]">{children}</div>
    </div>
  );
}

/**
 * "Campaign Published" — the third screenshot, and the same panel
 * `SparkSocial Create Campaign.dc.html` draws at the end of the wizard: the
 * campaign's terms on the left of a black agent tile, then "Here's what i'll
 * do" over four rows under an Agent Status chip.
 *
 * The four rows are what a campaign *is* in this system — `campaign.create`
 * writes the campaign and the scheduler mixes its posts with the baseline — so
 * they are a description of behaviour that exists, not a promise bolted onto a
 * confirmation.
 */
function PublishedPanel({
  trend,
  goal,
  cta,
  accounts,
  hasDraft,
  onView,
  onClose,
}: {
  trend: RankedTrendItem;
  goal: string;
  cta: string;
  accounts: string[];
  hasDraft: boolean;
  onView: () => void;
  onClose: () => void;
}) {
  return (
    <ModalShell top={110} height={560} width={560} radius={20} label="Campaign published" gradientTo="#F4F7FD" onClose={onClose}>
      <div className="px-[26px] pt-[26px]">
        <p className="text-[24px] font-bold leading-[1.2] text-ink">Campaign Published</p>
        <p className="mt-[6px] text-[14.5px] text-ink-muted">
          Here&rsquo;s what <span style={{ color: '#A46CF0' }}>SPARK</span> will do with this focus
        </p>
      </div>

      <div className="mx-[26px] mt-[16px] rounded-[16px] bg-white p-[16px]" style={{ boxShadow: 'inset 0 0 0 1.2px rgba(164,108,240,0.35)' }}>
        <div className="flex items-start gap-[14px]">
          <span className="block h-[100px] w-[110px] shrink-0 overflow-hidden rounded-[12px]" style={{ background: '#EFEFEF' }}>
            {trend.media ? (
              <img src={trend.media.url} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
            ) : null}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-semibold text-ink">{trend.topic}</p>
            <dl className="mt-[8px] space-y-[5px] text-[13.5px]">
              <Line term="Goal" value={goal} />
              <Line term="Duration" value={`${WINDOW_DAYS} Days`} />
              <Line term="Primary CTA" value={cta || 'None set'} link={!!cta} />
              <Line term="Post Account" value={accounts.length ? accounts.join(', ') : 'Wherever each format fits'} />
            </dl>
          </div>
        </div>
      </div>

      <div className="mt-[18px] flex items-center justify-between px-[26px]">
        <p className="text-[16px] font-semibold text-ink">Here&rsquo;s what i&rsquo;ll do</p>
        <span className="flex items-center gap-[7px] rounded-[6px] px-[8px] py-[5px] text-[11.5px]" style={{ background: 'rgba(0,0,0,0.07)', color: 'rgba(0,0,0,0.6)' }}>
          Agent Status
          <span aria-hidden className="block h-[9px] w-[9px] rounded-full" style={{ background: '#13D711' }} />
          Active
        </span>
      </div>

      <div className="mt-[10px] flex flex-col gap-[8px] px-[26px]">
        {[
          'Create campaign-focused posts across selected channels',
          'Blend campaign content with baseline growth posts',
          'Optimize posting times based on performance',
          'Adjust CTA frequency to maximize leads',
        ].map((row) => (
          <div key={row} className="flex h-[40px] items-center gap-[10px] rounded-[10px] px-[12px]" style={{ boxShadow: 'inset 0 0 0 1.2px rgba(12,12,12,0.1)' }}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M12.5 7a5.5 5.5 0 1 1-1.6-3.9" stroke="#838383" strokeWidth="1.4" strokeLinecap="round" />
              <path d="M12.6 1.4v3.2H9.4" stroke="#838383" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="truncate text-[14.5px]" style={{ color: '#838383' }}>
              {row}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-[18px] flex justify-center pb-[8px]">
        <button
          type="button"
          onClick={onView}
          className="flex h-[46px] items-center gap-[16px] rounded-[11px] bg-ink px-[22px] text-[15.5px] font-semibold text-white transition-colors hover:bg-[#242424]"
        >
          {/* A campaign whose first draft failed has no post to open — saying so
              beats a button that lands on nothing. */}
          {hasDraft ? 'View Campaign Post' : 'Done'}
          <svg width="8" height="14" viewBox="0 0 8 16" fill="none" aria-hidden>
            <path d="m1 1 6 7-6 7" stroke="#FFFFFF" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </ModalShell>
  );
}

function Line({ term, value, link = false }: { term: string; value: string; link?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-[12px]">
      <dt style={{ color: '#838383' }}>{term} -</dt>
      <dd
        className="truncate text-right font-semibold"
        style={link ? { color: '#2474ED', textDecoration: 'underline' } : { color: '#0C0C0C' }}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
