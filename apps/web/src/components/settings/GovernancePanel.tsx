'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { invoke } from '@/lib/tools';
import { cn } from '@/lib/utils';

/**
 * `brand.governance.get`/`.set` — PRD §8.2 (`ONB-03`) and §8.12 (`SET-WS-01`).
 *
 * The screen for the half of brand configuration that did not exist in any
 * layer: restricted topics, claims to avoid, strict compliance mode, the voice
 * sliders, banned phrases, the timezone, and the posting windows.
 *
 * ── Why this sits beside `PolicyPanel` rather than inside it ───────────────
 *
 * `PolicyPanel` is the approval *ladder* — who signs work off, which platforms
 * force review, when publishing is frozen. That is an operator's screen. This is
 * the brand's own statement about itself, captured in onboarding and revised
 * rarely. Two panels because they are edited by different people at different
 * times, and because a partial save from either must not clear the other's
 * fields (`setGovernance` and `setPolicy` are separate patches for the same
 * reason).
 *
 * ── Comma-separated text, not a tag editor ─────────────────────────────────
 *
 * Restricted topics and claims are entered as free text and split on commas.
 * A tag input would be nicer and is not what is missing here: the gap was that
 * §9's enforcement had *no input at all*, and a textarea reaches every one of
 * those fields today. `PolicyPanel` makes the same call for content types.
 */

const TONE_AXES = [
  { key: 'formal', label: 'Formal', low: 'Casual', high: 'Formal' },
  { key: 'playful', label: 'Playful', low: 'Serious', high: 'Playful' },
  { key: 'technical', label: 'Technical', low: 'Plain', high: 'Technical' },
  { key: 'bold', label: 'Bold', low: 'Measured', high: 'Bold' },
] as const;

/**
 * A short list of zones, plus whatever the brand already has.
 *
 * Not the full IANA set — that is ~600 entries and a `<select>` of 600 is worse
 * than a text field. The tool validates against the runtime's real zone
 * database, so a brand outside this list is set once via the API and then round
 * -trips correctly here (the current value is always an option, below).
 */
const COMMON_ZONES = [
  'UTC',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Lisbon',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

interface Governance {
  brandId: string;
  restrictedTopics: string[];
  claimsToAvoid: string[];
  strictMode: boolean;
  toneVector?: { formal: number; playful: number; technical: number; bold: number };
  bannedPhrases: string[];
  logoUrl?: string;
  brandColors: string[];
  timezone: string;
  postingWindows: number[];
  usingDefaultWindows: boolean;
}

const splitList = (text: string): string[] =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function GovernancePanel() {
  const [loading, setLoading] = useState(true);
  const [topicsText, setTopicsText] = useState('');
  const [claimsText, setClaimsText] = useState('');
  const [phrasesText, setPhrasesText] = useState('');
  const [strictMode, setStrictMode] = useState(false);
  const [tone, setTone] = useState({ formal: 0.5, playful: 0.5, technical: 0.5, bold: 0.5 });
  const [timezone, setTimezone] = useState('UTC');
  const [windows, setWindows] = useState<number[]>([]);
  const [usingDefaultWindows, setUsingDefaultWindows] = useState(true);
  const [logoUrl, setLogoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await invoke<Governance>('brand.governance.get', {});
      setLoading(false);
      if (res.status !== 'succeeded') return;
      const g = res.output;
      setTopicsText(g.restrictedTopics.join(', '));
      setClaimsText(g.claimsToAvoid.join(', '));
      setPhrasesText(g.bannedPhrases.join(', '));
      setStrictMode(g.strictMode);
      if (g.toneVector) setTone(g.toneVector);
      setTimezone(g.timezone);
      setWindows(g.postingWindows);
      setUsingDefaultWindows(g.usingDefaultWindows);
      setLogoUrl(g.logoUrl ?? '');
    })();
  }, []);

  async function save() {
    setBusy(true);
    setMessage(null);

    const topics = splitList(topicsText);
    const claims = splitList(claimsText);
    const phrases = splitList(phrasesText);

    const res = await invoke<Governance>('brand.governance.set', {
      // `null` clears; an empty list would be stored as an empty list, which
      // reads the same on this screen and differently to the guardrail layer.
      restrictedTopics: topics.length ? topics : null,
      claimsToAvoid: claims.length ? claims : null,
      bannedPhrases: phrases.length ? phrases : null,
      strictMode,
      toneVector: tone,
      timezone,
      // Only send windows the brand has actually chosen. Sending the resolved
      // default back would silently convert "no preference" into a choice, and
      // the default could then never move.
      postingWindows: usingDefaultWindows ? null : windows,
      logoUrl: logoUrl.trim() ? logoUrl.trim() : null,
    });

    setBusy(false);
    if (res.status === 'succeeded') {
      setUsingDefaultWindows(res.output.usingDefaultWindows);
      setWindows(res.output.postingWindows);
      setMessage({ kind: 'ok', text: 'Saved.' });
      return;
    }
    setMessage({
      kind: 'err',
      text: res.status === 'failed' ? res.error.message : 'That change needs approval.',
    });
  }

  function toggleHour(hour: number) {
    setUsingDefaultWindows(false);
    setWindows((prev) => {
      const next = prev.includes(hour) ? prev.filter((h) => h !== hour) : [...prev, hour];
      return next.sort((a, b) => a - b);
    });
  }

  const zoneOptions = COMMON_ZONES.includes(timezone) ? COMMON_ZONES : [timezone, ...COMMON_ZONES];

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">Brand rules</h2>
      <p className="mt-1 text-[13px] text-ink-muted">
        What SPARK may say on your behalf, and when it says it. These are checked on every post before it
        goes out.
      </p>

      {loading ? (
        <p className="mt-4 text-[14px] text-ink-muted">Loading…</p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-6">
          {/* ── What SPARK may not say ─────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="text-[12px] font-medium text-ink-muted" htmlFor="gov-topics">
                Restricted topics
              </label>
              <p className="mt-0.5 text-[12px] text-ink-muted">
                Subjects to stay off entirely. Comma separated.
              </p>
              <Input
                id="gov-topics"
                value={topicsText}
                onChange={(e) => setTopicsText(e.target.value)}
                placeholder="politics, competitor names, staff turnover"
                className="mt-1.5"
              />
            </div>

            <div>
              <label className="text-[12px] font-medium text-ink-muted" htmlFor="gov-claims">
                Claims to avoid
              </label>
              <p className="mt-0.5 text-[12px] text-ink-muted">
                Promises this brand does not make, even about things it will happily discuss.
              </p>
              <Input
                id="gov-claims"
                value={claimsText}
                onChange={(e) => setClaimsText(e.target.value)}
                placeholder="guaranteed, cheapest, clinically proven"
                className="mt-1.5"
              />
            </div>

            <div>
              <label className="text-[12px] font-medium text-ink-muted" htmlFor="gov-phrases">
                Never use these words
              </label>
              <Input
                id="gov-phrases"
                value={phrasesText}
                onChange={(e) => setPhrasesText(e.target.value)}
                placeholder="synergy, game-changer, revolutionary"
                className="mt-1.5"
              />
            </div>

            <label className="flex items-start gap-3 rounded-lg border border-border p-3">
              <input
                type="checkbox"
                checked={strictMode}
                onChange={(e) => setStrictMode(e.target.checked)}
                className="mt-1 size-4 accent-[--ss-primary]"
              />
              <span>
                <span className="text-[14px] font-medium text-ink">Strict mode</span>
                <span className="mt-0.5 block text-[13px] text-ink-muted">
                  {strictMode
                    ? 'A post naming a restricted topic or claim is blocked outright.'
                    : 'A post naming a restricted topic or claim is held for your review.'}
                </span>
              </span>
            </label>
          </div>

          {/* ── Voice ──────────────────────────────────────────────────── */}
          <div>
            <h3 className="text-[14px] font-medium text-ink">Voice</h3>
            <p className="mt-0.5 text-[12px] text-ink-muted">
              Overrides whatever SPARK inferred from your website.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {TONE_AXES.map((axis) => (
                <div key={axis.key}>
                  <div className="flex items-baseline justify-between">
                    <label className="text-[13px] text-ink" htmlFor={`tone-${axis.key}`}>
                      {axis.label}
                    </label>
                    <span className="text-[12px] tabular-nums text-ink-muted">
                      {Math.round(tone[axis.key] * 100)}%
                    </span>
                  </div>
                  <input
                    id={`tone-${axis.key}`}
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(tone[axis.key] * 100)}
                    onChange={(e) => setTone((t) => ({ ...t, [axis.key]: Number(e.target.value) / 100 }))}
                    className="mt-1 w-full accent-[--ss-primary]"
                  />
                  <div className="flex justify-between text-[11px] text-ink-muted">
                    <span>{axis.low}</span>
                    <span>{axis.high}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── When it posts ──────────────────────────────────────────── */}
          <div>
            <h3 className="text-[14px] font-medium text-ink">When it posts</h3>
            <p className="mt-0.5 text-[12px] text-ink-muted">
              Your timezone decides what &ldquo;Tuesday&rdquo; means, and the hours below are the times of day
              posts land in.
            </p>

            <div className="mt-3 max-w-xs">
              <label className="text-[12px] font-medium text-ink-muted" htmlFor="gov-tz">
                Timezone
              </label>
              <select
                id="gov-tz"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-border bg-field px-3 py-2 text-[14px] text-ink"
              >
                {zoneOptions.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[12px] font-medium text-ink-muted">Posting hours</p>
                {usingDefaultWindows ? (
                  <p className="text-[12px] text-ink-muted">
                    Using the default spread — pick any hour to set your own.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setUsingDefaultWindows(true);
                      setWindows([9, 13, 18]);
                    }}
                    className="text-[12px] font-medium text-primary underline decoration-dotted underline-offset-2 hover:no-underline"
                  >
                    Back to the default
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Array.from({ length: 24 }, (_, hour) => {
                  const on = windows.includes(hour);
                  return (
                    <button
                      key={hour}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleHour(hour)}
                      className={cn(
                        'w-11 rounded border px-1 py-1 text-[12px] tabular-nums transition-colors',
                        on
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-ink-muted hover:bg-surface-muted',
                        usingDefaultWindows && on && 'opacity-60',
                      )}
                    >
                      {String(hour).padStart(2, '0')}:00
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Brand kit ──────────────────────────────────────────────── */}
          <div className="max-w-xl">
            <label className="text-[12px] font-medium text-ink-muted" htmlFor="gov-logo">
              Logo URL
            </label>
            <Input
              id="gov-logo"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://…"
              className="mt-1.5"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save brand rules'}
            </Button>
            {message ? (
              <p className={cn('text-[13px]', message.kind === 'ok' ? 'text-success' : 'text-ink-muted')}>
                {message.text}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
