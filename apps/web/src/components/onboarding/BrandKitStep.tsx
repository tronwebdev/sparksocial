'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BrandFontPicker } from '@/components/settings/BrandFontPicker';
import { invoke } from '@/lib/tools';
import { cn } from '@/lib/utils';

/**
 * `F6`'s third group and `M8` — the brand kit, asked during onboarding.
 *
 * The fields have existed and been wired to rendering since the governance work;
 * onboarding simply never asked, so a new brand's first posts rendered on
 * defaults and the kit was discovered weeks later on a settings screen. The
 * 22 August decision — the brand kit is a *record* — is what makes this step and
 * that panel two views of one row rather than two sources of truth. Both write
 * `brand.governance.set`; neither owns the data.
 *
 * ── What is here and what is not ──────────────────────────────────────────
 *
 * The prototype's screen carries colour theme, typography, brand voice, country
 * and timezone, strict compliance, restricted topics and claims to avoid. All of
 * those are real fields, so all of them are here.
 *
 * Its "Use This Brand Preset" toggle over a kit "generated from your URL" is not,
 * and the reason is that nothing generates one: the crawl fills identity, voice
 * and offer, and no step of it proposes a palette. A toggle over a preset that
 * does not exist would be a control with nothing behind it. The colours are
 * seeded from whatever the crawl *did* leave on the brand row, and the field says
 * where they came from.
 *
 * ── Voice as presets, not four sliders ────────────────────────────────────
 *
 * `toneVector` is four numeric axes and the copy writers read the numbers, so the
 * axes stay the truth. What onboarding offers is the prototype's named choices
 * (L4) mapped onto them — "Formal", "Casual", "Story driven" — because nobody
 * setting up a business for the first time has an opinion about a 0–1 technical
 * axis, and the Brand Kit panel still exposes the sliders for anyone who does.
 */

/** L4's named voices, as points in the four-axis space the writers actually read. */
const VOICE_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  note: string;
  tone: { formal: number; playful: number; technical: number; bold: number };
}> = [
  {
    id: 'formal',
    label: 'Formal',
    note: 'Measured and precise. Suits professional services.',
    tone: { formal: 0.85, playful: 0.2, technical: 0.6, bold: 0.35 },
  },
  {
    id: 'casual',
    label: 'Casual',
    note: 'How you would say it to a regular.',
    tone: { formal: 0.2, playful: 0.7, technical: 0.25, bold: 0.5 },
  },
  {
    id: 'story',
    label: 'Story driven',
    note: 'Leads with the person, not the product.',
    tone: { formal: 0.35, playful: 0.55, technical: 0.2, bold: 0.65 },
  },
  {
    id: 'direct',
    label: 'Direct',
    note: 'Short sentences, no warm-up. Says the offer first.',
    tone: { formal: 0.45, playful: 0.3, technical: 0.35, bold: 0.9 },
  },
];

/** The same short list the Brand Kit panel offers, for the same reason: 600 zones is not a select. */
const ZONES = [
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
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
  'UTC',
];

const COLOR_ROLE = ['Background', 'Text', 'Accent'];
const NEW_COLOR = '#0C0C0C';

interface Governance {
  brandColors: string[];
  brandFonts?: { display?: string; body?: string };
  toneVector?: { formal: number; playful: number; technical: number; bold: number };
  timezone: string;
  strictMode: boolean;
  restrictedTopics: string[];
  claimsToAvoid: string[];
}

export function BrandKitStep() {
  const [loaded, setLoaded] = useState(false);
  const [colors, setColors] = useState<string[]>([]);
  const [fonts, setFonts] = useState<{ display?: string; body?: string }>({});
  const [voice, setVoice] = useState<string>('');
  const [timezone, setTimezone] = useState('');
  const [strictMode, setStrictMode] = useState(false);
  const [topics, setTopics] = useState('');
  const [claims, setClaims] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await invoke<Governance>('brand.governance.get', {});
      setLoaded(true);
      if (res.status !== 'succeeded') return;
      const g = res.output;
      setColors(g.brandColors);
      setFonts(g.brandFonts ?? {});
      setStrictMode(g.strictMode);
      setTopics(g.restrictedTopics.join(', '));
      setClaims(g.claimsToAvoid.join(', '));
      /**
       * The timezone is `notNull` with a `UTC` default, so `UTC` cannot be
       * distinguished from unanswered. Rather than pre-select it and let somebody
       * click past the one field PRD §8.2 makes required, the browser's own guess
       * goes in — which is right far more often than UTC is.
       */
      setTimezone(
        g.timezone && g.timezone !== 'UTC'
          ? g.timezone
          : (Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'),
      );
      // Which preset the stored vector is nearest, so returning to this step shows
      // the choice rather than resetting it.
      if (g.toneVector) setVoice(nearestPreset(g.toneVector));
    })();
  }, []);

  async function save() {
    setBusy(true);
    setMessage(null);

    const preset = VOICE_PRESETS.find((p) => p.id === voice);
    const res = await invoke('brand.governance.set', {
      brandColors: colors.length ? colors : null,
      brandFonts: fonts.display ?? fonts.body ? fonts : null,
      ...(preset ? { toneVector: preset.tone } : {}),
      ...(timezone ? { timezone } : {}),
      strictMode,
      restrictedTopics: splitList(topics).length ? splitList(topics) : null,
      claimsToAvoid: splitList(claims).length ? splitList(claims) : null,
    });

    setBusy(false);
    setMessage(
      res.status === 'succeeded'
        ? { kind: 'ok', text: 'Saved.' }
        : { kind: 'err', text: res.status === 'failed' ? res.error.message : 'That needs approval first.' },
    );
    return res.status === 'succeeded';
  }

  if (!loaded) return <p className="text-[14px] text-ink-muted">Reading what SPARK already has…</p>;

  return (
    <div className="grid grid-cols-1 gap-7">
      {/* ── Colour ─────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-[14px] font-medium text-ink">Colours</h2>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          In order: the background, the text on it, then an accent. Posts use the defaults until you set
          them.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {colors.map((c, i) => (
            <div key={`${c}-${i}`} className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1">
              <input
                type="color"
                value={normaliseHex(c)}
                onChange={(e) => setColors(colors.map((x, j) => (j === i ? e.target.value : x)))}
                className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0"
                aria-label={`${COLOR_ROLE[i] ?? 'Extra'} colour`}
              />
              <span className="text-[11.5px] text-ink-muted">{COLOR_ROLE[i] ?? 'extra'}</span>
              <button
                type="button"
                onClick={() => setColors(colors.filter((_, j) => j !== i))}
                className="text-[13px] text-ink-muted hover:text-ink"
                aria-label={`Remove ${c}`}
              >
                ×
              </button>
            </div>
          ))}
          {colors.length < 3 ? (
            <Button variant="outline" size="sm" onClick={() => setColors([...colors, NEW_COLOR])}>
              Add {COLOR_ROLE[colors.length]?.toLowerCase() ?? 'colour'}
            </Button>
          ) : null}
        </div>
      </section>

      {/* ── Type ───────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-[14px] font-medium text-ink">Type</h2>
        <div className="mt-2">
          <BrandFontPicker
            value={fonts}
            onChange={setFonts}
            {...(colors[0] ? { ground: colors[0] } : {})}
            {...(colors[1] ? { type: colors[1] } : {})}
          />
        </div>
      </section>

      {/* ── Voice ──────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-[14px] font-medium text-ink">Voice</h2>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          How captions read. Adjustable axis by axis later, in Settings.
        </p>
        <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {VOICE_PRESETS.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={voice === p.id}
                onClick={() => setVoice(p.id)}
                className={cn(
                  'h-full w-full rounded-lg border p-3 text-left transition-colors',
                  voice === p.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-muted',
                )}
              >
                <span className="block text-[14px] font-medium text-ink">{p.label}</span>
                <span className="mt-0.5 block text-[12px] text-ink-muted">{p.note}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* ── When it posts ──────────────────────────────────────────────── */}
      <section>
        <h2 className="text-[14px] font-medium text-ink">Timezone</h2>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Every posting time is worked out in this zone. Required, because the alternative is posting on
          UTC hours.
        </p>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="mt-2 w-full rounded-lg border border-border bg-field px-3 py-2 text-[14px] text-ink sm:max-w-[320px]"
          aria-label="Timezone"
        >
          {/* The detected or stored zone first, in case it is outside the list. */}
          {timezone && !ZONES.includes(timezone) ? <option value={timezone}>{timezone}</option> : null}
          {ZONES.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </section>

      {/* ── Guardrails ─────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-[14px] font-medium text-ink">Guardrails</h2>
        <label className="mt-2 flex items-start gap-3 rounded-lg border border-border p-3">
          <input
            type="checkbox"
            checked={strictMode}
            onChange={(e) => setStrictMode(e.target.checked)}
            className="mt-1 size-4 accent-[--ss-primary]"
          />
          <span>
            <span className="text-[14px] font-medium text-ink">Strict compliance</span>
            <span className="mt-0.5 block text-[13px] text-ink-muted">
              A restricted topic <b>blocks</b> a post rather than flagging it for you. On for anything
              regulated.
            </span>
          </span>
        </label>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[13px] text-ink-muted" htmlFor="onb-topics">
              Topics to stay off
            </label>
            <Input
              id="onb-topics"
              value={topics}
              onChange={(e) => setTopics(e.target.value)}
              placeholder="politics, competitors"
              className="mt-1.5"
            />
            <p className="mt-1 text-[12px] text-ink-muted">Comma separated.</p>
          </div>
          <div>
            <label className="text-[13px] text-ink-muted" htmlFor="onb-claims">
              Claims to avoid
            </label>
            <Input
              id="onb-claims"
              value={claims}
              onChange={(e) => setClaims(e.target.value)}
              placeholder="guaranteed results, cheapest in town"
              className="mt-1.5"
            />
            <p className="mt-1 text-[12px] text-ink-muted">Things you cannot stand behind.</p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save the kit'}
        </Button>
        {message ? (
          <span className={message.kind === 'ok' ? 'text-[13px] text-ink-muted' : 'text-[13px] text-warn'}>
            {message.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const splitList = (text: string): string[] =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Falls back to the swatch a colour input can show, rather than claiming the brand's colour is grey. */
function normaliseHex(value: string): string {
  const v = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(v) ? v : '#000000';
}

/**
 * Which preset a stored tone vector is nearest, by squared distance.
 *
 * Needed because the vector is the truth and the presets are a view of it: a
 * brand whose axes were set on the settings screen has no preset id stored, and
 * returning to this step must show the nearest one rather than nothing.
 */
function nearestPreset(tone: { formal: number; playful: number; technical: number; bold: number }): string {
  let best = VOICE_PRESETS[0]!;
  let bestDistance = Infinity;
  for (const preset of VOICE_PRESETS) {
    const d =
      (preset.tone.formal - tone.formal) ** 2 +
      (preset.tone.playful - tone.playful) ** 2 +
      (preset.tone.technical - tone.technical) ** 2 +
      (preset.tone.bold - tone.bold) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = preset;
    }
  }
  /**
   * An all-0.5 vector is the schema default, not a choice, and it is nearly
   * equidistant from all four. Showing a preset for it would claim somebody
   * picked one.
   */
  const isDefault =
    tone.formal === 0.5 && tone.playful === 0.5 && tone.technical === 0.5 && tone.bold === 0.5;
  return isDefault ? '' : best.id;
}
