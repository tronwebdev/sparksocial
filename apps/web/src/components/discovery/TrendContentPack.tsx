'use client';

import { useEffect, useMemo, useState } from 'react';
import { Busy } from '@/components/brand/SparkLoader';
import { invoke } from '@/lib/tools';
import { notifyResult } from '@/lib/notify';
import { cn } from '@/lib/utils';

/**
 * `DISC-02`'s right column below the samples: PRD §8.9's
 *
 *   - "generate content pack panel (brief title, goal, CTA, post types,
 *     brand kit toggle, A/B toggle optional)"
 *   - "recommendations row (time shift, format, hook) with apply buttons"
 *
 * Neither existed. The recommendations row had become three navigation
 * buttons (Re-purpose / Re-share / Watch it first), while the prototype —
 * `SparkSocial Discovery.dc.html`'s `recos` — draws exactly the PRD's three:
 * Time Shift, Format and Hook, each with Generate Draft.
 *
 * ── What each part is made of ─────────────────────────────────────────────
 *
 *   Time Shift   The brand's own posting windows and timezone
 *                (`brand.governance.get`), the next one from now, and what the
 *                trend's saturation says about waiting for it.
 *   Format       `trend.repurpose`'s playbook — the best fit this brand can run.
 *   Hook         `trend.hooks` — opening lines, written on request because it
 *                bills; any one of them becomes the draft's opening.
 *   Content pack A brief (title, goal, CTA) that becomes the draft's intent, one
 *                draft per post type ticked (`playbook.resolve`'s ready
 *                playbooks), and an optional A/B take (`draft.variants`).
 *
 * The PRD's "brand kit toggle" is the one item left out: every draft is built
 * from the brand kit and nothing in `content.draft` can build one without it,
 * so a switch here would change nothing.
 *
 * No "Expected +59% ER": nothing predicts engagement for an unwritten post.
 */

interface Suggestion {
  playbookId: string;
  playbookName: string;
  pillar: string;
  intent: string;
  unlockable: boolean;
  missingRoles: string[];
}

interface Ranked {
  playbook_id: string;
  name: string;
  content_pillar: string;
  missing_roles: string[];
  missing_genome_paths: string[];
}

const GOALS = ['Awareness', 'Engagement', 'Leads', 'Sales'] as const;

const CARD = 'rounded-[20px] bg-white';
const RING = { boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' };
const FIELD = 'h-[48px] w-full rounded-[10px] bg-[#F2F3F5] px-[14px] text-16 text-ink outline-none';

/** The next posting window from now, in the brand's timezone. */
export function nextWindow(windows: number[], timezone: string, now = new Date()): { label: string; inHours: number } | null {
  const hours = [...new Set(windows.filter((h) => Number.isInteger(h) && h >= 0 && h < 24))].sort((a, b) => a - b);
  if (hours.length === 0) return null;
  let tz = timezone;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
  } catch {
    tz = 'UTC';
  }
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const nowH = h + m / 60;
  const today = hours.find((x) => x > nowH);
  const at = today ?? hours[0]!;
  const inHours = today !== undefined ? at - nowH : 24 - nowH + at;
  const when = new Date(now.getTime() + inHours * 3_600_000);
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(when);
  return { label: `${today !== undefined ? 'Today' : day} at ${String(at).padStart(2, '0')}:00`, inHours };
}

export function TrendContentPack({
  genomeId,
  trendId,
  topic,
  saturation,
  velocity,
  onOpenDraft,
  onReshare,
}: {
  genomeId: string;
  trendId: string;
  topic: string;
  saturation: number;
  velocity: number;
  onOpenDraft: (contentItemId: string) => void;
  onReshare: () => void;
}) {
  const [suggestion, setSuggestion] = useState<Suggestion | null | undefined>(undefined);
  const [suggestWhy, setSuggestWhy] = useState<string | null>(null);
  const [ready, setReady] = useState<Ranked[]>([]);
  const [slot, setSlot] = useState<{ label: string; inHours: number } | null | undefined>(undefined);
  const [hooks, setHooks] = useState<string[] | null>(null);

  const [title, setTitle] = useState(topic);
  const [goal, setGoal] = useState<(typeof GOALS)[number]>('Engagement');
  const [cta, setCta] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [ab, setAb] = useState(false);

  /*
    A failed action is announced through `notify`, not printed under a card.
    The two cards are a screen apart, so an error under the content pack was
    invisible to someone who had just pressed "Write hooks" — the button reset
    and nothing else happened.
  */
  const [busy, setBusy] = useState<string | null>(null);
  const [made, setMade] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [rep, res, gov, gen] = await Promise.all([
        invoke<{ suggestion: Suggestion | null; why: { summary: string } }>('trend.repurpose', { genomeId, trendId }),
        invoke<{ ranked: Ranked[] }>('playbook.resolve', { genomeId }),
        invoke<{ timezone: string; postingWindows: number[] }>('brand.governance.get', {}),
        invoke<{ genome: { offer?: { primary_cta?: string } } }>('genome.get', { genomeId }),
      ]);
      if (cancelled) return;
      if (rep.status === 'succeeded') {
        setSuggestion(rep.output.suggestion);
        if (!rep.output.suggestion) setSuggestWhy(rep.output.why.summary);
      } else setSuggestion(null);
      const runnable =
        res.status === 'succeeded'
          ? res.output.ranked.filter((r) => r.missing_roles.length === 0 && r.missing_genome_paths.length === 0).slice(0, 6)
          : [];
      setReady(runnable);
      const first = rep.status === 'succeeded' && rep.output.suggestion ? rep.output.suggestion.playbookId : runnable[0]?.playbook_id;
      if (first) setTypes([first]);
      setSlot(gov.status === 'succeeded' ? nextWindow(gov.output.postingWindows, gov.output.timezone) : null);
      const primary = gen.status === 'succeeded' ? gen.output.genome?.offer?.primary_cta : undefined;
      if (primary) setCta(primary);
    })();
    return () => {
      cancelled = true;
    };
  }, [genomeId, trendId]);

  /* The suggestion may not be in the top six; keep it choosable. */
  const choices = useMemo(() => {
    const list = ready.map((r) => ({ id: r.playbook_id, name: r.name }));
    if (suggestion && !list.some((c) => c.id === suggestion.playbookId)) {
      list.unshift({ id: suggestion.playbookId, name: suggestion.playbookName });
    }
    return list;
  }, [ready, suggestion]);

  const intent = (opening?: string) =>
    [
      opening ? `Open with: "${opening}"` : '',
      title.trim() && title.trim() !== topic ? title.trim() : '',
      `Joining the trend "${topic}".`,
      `Goal: ${goal.toLowerCase()}.`,
      cta.trim() ? `Call to action: ${cta.trim()}` : '',
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, 500);

  async function draft(playbookId: string, opening?: string): Promise<string | undefined> {
    const res = await invoke<{ contentItemId: string }>(
      'content.draft',
      { genomeId, playbookId, intent: intent(opening), fromTrendId: trendId },
      crypto.randomUUID(),
    );
    if (!notifyResult(res, undefined, 'Couldn’t write the draft')) return undefined;
    return res.output.contentItemId;
  }

  async function generatePack() {
    if (busy || types.length === 0) return;
    setBusy('pack');
    const out: Array<{ id: string; name: string }> = [];
    for (const id of types) {
      const contentItemId = await draft(id);
      if (!contentItemId) break;
      out.push({ id: contentItemId, name: choices.find((c) => c.id === id)?.name ?? 'Draft' });
      if (ab) {
        const v = await invoke('draft.variants', { genomeId, contentItemId, count: 2 });
        notifyResult(v, undefined, 'Couldn’t write the A/B take');
      }
    }
    setMade(out);
    setBusy(null);
  }

  async function oneDraft(kind: string, playbookId: string | undefined, opening?: string) {
    if (busy || !playbookId) return;
    setBusy(kind);
    const id = await draft(playbookId, opening);
    setBusy(null);
    if (id) onOpenDraft(id);
  }

  async function writeHooks() {
    if (busy) return;
    setBusy('hooks');
    const res = await invoke<{ hooks: string[] }>('trend.hooks', { genomeId, trendId, count: 3 }, crypto.randomUUID());
    setBusy(null);
    if (!notifyResult(res, undefined, 'Couldn’t write hooks')) return;
    setHooks(res.output.hooks);
  }

  const fresh = saturation < 0.4 && velocity >= 0.5;
  const late = saturation >= 0.7;
  const timeAdvice = late
    ? 'It is already saturated — post today if at all; waiting a day means joining at the tail.'
    : fresh
      ? 'It is early and climbing — your next window is soon enough.'
      : 'Mid-cycle — your next window is the right moment.';
  const bestFormat = suggestion ?? (ready[0] ? { playbookId: ready[0].playbook_id, playbookName: ready[0].name, pillar: ready[0].content_pillar } : null);

  const Button = ({ onClick, disabled, children, dark = true }: { onClick: () => void; disabled?: boolean; children: React.ReactNode; dark?: boolean }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-[44px] shrink-0 items-center rounded-xl px-[18px] text-15 font-semibold transition-colors disabled:opacity-50',
        dark ? 'bg-ink text-white hover:bg-[#242424]' : 'bg-white text-ink hover:bg-[#F4F5F7]',
      )}
      style={dark ? undefined : { boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)' }}
    >
      {children}
    </button>
  );

  return (
    <>
      {/* ── Content pack ─────────────────────────────────────────────── */}
      <div className={cn(CARD, 'mt-[36px] w-full px-[24px] py-[24px]')} style={RING}>
        <p className="text-18 font-bold text-ink">Generate a content pack</p>
        <p className="mt-[6px] text-14 text-ink-muted">One draft per post type, written from this trend and your brief.</p>

        <div className="mt-[18px] grid gap-[14px] sm:grid-cols-2">
          <label className="grid gap-[6px] text-14 font-medium text-ink sm:col-span-2">
            Brief title
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={FIELD} />
          </label>
          <label className="grid gap-[6px] text-14 font-medium text-ink">
            Goal
            <select value={goal} onChange={(e) => setGoal(e.target.value as (typeof GOALS)[number])} className={cn(FIELD, 'cursor-pointer')}>
              {GOALS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-[6px] text-14 font-medium text-ink">
            Call to action
            <input value={cta} onChange={(e) => setCta(e.target.value)} maxLength={160} placeholder="e.g. Book a table" className={FIELD} />
          </label>
        </div>

        <p className="mt-[18px] text-14 font-medium text-ink">Post types</p>
        {choices.length === 0 ? (
          <p className="mt-[8px] text-14 text-ink-muted">
            {suggestion === undefined ? <Busy size={16}>Finding the formats you can run…</Busy> : 'No format is ready for this brand yet — the Re-purpose route says what is missing.'}
          </p>
        ) : (
          <div className="mt-[8px] flex flex-wrap gap-[8px]">
            {choices.map((c) => {
              const on = types.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTypes((t) => (on ? t.filter((x) => x !== c.id) : [...t, c.id]))}
                  className="flex h-[38px] items-center rounded-[9px] px-[12px] text-14 font-semibold transition-colors"
                  style={on ? { background: '#0C0C0C', color: '#FFFFFF' } : { background: '#FFFFFF', color: '#3B3B3B', boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)' }}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        )}

        <label className="mt-[16px] flex items-center gap-[10px] text-14 font-medium text-ink">
          <input type="checkbox" checked={ab} onChange={(e) => setAb(e.target.checked)} />
          Also write an A/B take of each (costs a little more)
        </label>

        <div className="mt-[18px] flex flex-wrap items-center gap-[12px]">
          <Button onClick={() => void generatePack()} disabled={busy !== null || types.length === 0}>
            {busy === 'pack' ? <Busy>Writing drafts…</Busy> : `Generate ${types.length || ''} ${types.length === 1 ? 'draft' : 'drafts'}`.replace('  ', ' ')}
          </Button>
          {made.map((m) => (
            <Button key={m.id} dark={false} onClick={() => onOpenDraft(m.id)}>
              Open {m.name}
            </Button>
          ))}
        </div>
      </div>

      {/* ── Recommendations: Time Shift · Format · Hook ──────────────── */}
      <div className={cn(CARD, 'relative mt-[36px] w-full')} style={RING}>
        <p className="px-[24px] pt-[24px] text-18 font-bold text-ink">Recommendations</p>
        <div className="flex flex-col gap-[18px] px-[24px] py-[22px]">
          {[
            {
              kind: 'Time Shift',
              bg: '#FBE6FA',
              ring: 'rgba(245,107,255,0.35)',
              desc:
                slot === undefined
                  ? <Busy size={16}>Reading your posting windows…</Busy>
                  : slot
                    ? `Post next: ${slot.label}. ${timeAdvice}`
                    : `No posting windows are set — choose them in Brand Kits. ${timeAdvice}`,
              cta: busy === 'time' ? <Busy>Drafting…</Busy> : 'Generate Draft',
              action: bestFormat ? () => void oneDraft('time', bestFormat.playbookId) : undefined,
            },
            {
              kind: 'Format',
              bg: '#FCEBD4',
              ring: 'rgba(228,137,21,0.3)',
              desc: bestFormat
                ? `${bestFormat.playbookName} — the best fit this brand can run now (${bestFormat.pillar}).`
                : (suggestWhy ?? <Busy size={16}>Working out which format fits…</Busy>),
              cta: busy === 'format' ? <Busy>Drafting…</Busy> : 'Generate Draft',
              action: bestFormat ? () => void oneDraft('format', bestFormat.playbookId) : undefined,
            },
          ].map((r) => (
            <div
              key={r.kind}
              className="flex min-h-[104px] flex-wrap items-center gap-x-[18px] gap-y-3 rounded-[14px] px-[22px] py-[18px]"
              style={{ background: r.bg, boxShadow: `inset 0 0 0 1px ${r.ring}` }}
            >
              <div className="min-w-[220px] flex-1">
                <p className="text-19 font-bold text-ink">{r.kind}</p>
                <p className="mt-[8px] text-16 font-medium" style={{ color: '#5B5B5B' }}>
                  {r.desc}
                </p>
              </div>
              {r.action ? (
                <Button onClick={r.action} disabled={busy !== null}>
                  {r.cta}
                </Button>
              ) : null}
            </div>
          ))}

          {/* Hook — written on request, since it bills. */}
          <div
            className="rounded-[14px] px-[22px] py-[18px]"
            style={{ background: '#DDEBFB', boxShadow: 'inset 0 0 0 1px rgba(36,116,237,0.3)' }}
          >
            <div className="flex flex-wrap items-center gap-x-[18px] gap-y-3">
              <div className="min-w-[220px] flex-1">
                <p className="text-19 font-bold text-ink">Hook</p>
                <p className="mt-[8px] text-16 font-medium" style={{ color: '#5B5B5B' }}>
                  {hooks ? 'Pick an opening line — the draft starts with it.' : 'Three opening lines for joining this trend, in your voice.'}
                </p>
              </div>
              <Button onClick={() => void writeHooks()} disabled={busy !== null} dark={Boolean(!hooks)}>
                {busy === 'hooks' ? <Busy>Writing…</Busy> : hooks ? 'Write others' : 'Write hooks'}
              </Button>
            </div>
            {hooks ? (
              <ul className="mt-[14px] flex flex-col gap-[10px]">
                {hooks.map((h) => (
                  <li key={h} className="flex flex-wrap items-center gap-[12px] rounded-[10px] bg-white px-[14px] py-[10px]">
                    <span className="min-w-0 flex-1 text-15 font-medium text-ink">{h}</span>
                    <Button onClick={() => void oneDraft('hook', bestFormat?.playbookId, h)} disabled={busy !== null || !bestFormat}>
                      {busy === 'hook' ? <Busy>Drafting…</Busy> : 'Generate Draft'}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>


          <p className="text-14 text-ink-muted">
            Want this trend to drive a goal, with your CTA link on every post?{' '}
            <button type="button" onClick={onReshare} className="font-semibold text-ink underline underline-offset-2">
              Re-share it as a campaign
            </button>
          </p>
        </div>
      </div>
    </>
  );
}
