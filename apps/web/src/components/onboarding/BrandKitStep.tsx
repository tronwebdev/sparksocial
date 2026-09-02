'use client';

import { useEffect, useState } from 'react';
import { BrandFontPicker } from '@/components/settings/BrandFontPicker';
import { SectionLabel, Select, Switch, Chip, Suggestions, TextField, GUARDRAIL_SUGGESTIONS } from './kit';
import { invoke } from '@/lib/tools';

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

/** The seven swatches in `...193155`, sampled from the capture. The fourth is `--ss-cyan`. */
const PALETTE = ['#0097FD', '#1AFB06', '#6C71FF', '#6CE8FF', '#DAFF6C', '#FF6CBA', '#41FFDC'] as const;

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
  const [topicDraft, setTopicDraft] = useState('');
  const [claimDraft, setClaimDraft] = useState('');
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

    /*
      `voice` is a comma list now, because the capture's control is
      multi-select. `toneVector` is a single vector, so the first pick wins
      rather than averaging: averaging "formal" with "casual" returns
      neutral, which is not what selecting both means.
    */
    const preset = VOICE_PRESETS.find((p) => p.id === voice.split(',')[0]);
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

  if (!loaded) return <p className="text-14 text-ink-muted">Reading what SPARK already has…</p>;

  const selectedVoices = voice ? voice.split(',').filter(Boolean) : [];
  const toggleVoice = (id: string) =>
    setVoice(
      selectedVoices.includes(id)
        ? selectedVoices.filter((v) => v !== id).join(',')
        : [...selectedVoices, id].join(','),
    );

  const topicList = splitList(topics);
  const claimList = splitList(claims);
  const addTo = (current: string, value: string) =>
    splitList(current).includes(value) ? current : [...splitList(current), value].join(', ');
  const removeFrom = (current: string, value: string) =>
    splitList(current).filter((v) => v !== value).join(', ');

  const countries = [...new Set(ZONES.map((z) => z.split('/')[0]))];
  const region = timezone.includes('/') ? timezone.split('/')[0] : countries[0];

  /*
    `…193155`. The brand kit is NOT inside the assistant card: the bubble sits
    above it and the fields lay out in two columns on the background, each group a
    labelled box. Reading the widest white run in that capture as one 596px card
    was wrong - it was the bubble merged with a field box.

    Saving is on blur of the whole block, which is what the step did before.
  */
  return (
    <div className="flex flex-col gap-5" onBlur={() => void save()}>
      <div className="flex items-center justify-between gap-4">
        <span className="text-14 text-ink">This is your brand kit generated from your URL</span>
        {/*
          Drawn in the capture, inert here, deliberately. Nothing generates a
          palette: the crawl fills identity, voice and offer and proposes no
          colours, so a toggle over "this preset" has no preset to switch to.
          Kept visible because the capture shows it and dropping it would hide a
          real gap; disabled because a switch that flips and changes nothing is
          worse than one that admits it.
        */}
        <span className="flex items-center gap-2.5 rounded-[10px] border border-border bg-white px-3 py-2">
          <span className="text-14 text-ink">Use This Brand Preset</span>
          <Switch
            checked={false}
            disabled
            onChange={() => {}}
            label="Use this brand preset"
            title="No generated preset exists yet - nothing proposes a palette from a crawl."
          />
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-[18px] gap-y-5">
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Color Theme</SectionLabel>
          <div className="flex flex-col gap-3 rounded-[12px] border border-border bg-white p-3">
            <div className="flex items-center gap-2">
              <span className="text-14 text-ink">Selected Colors</span>
              <span className="flex flex-wrap items-center gap-1.5">
                {colors.map((c, i) => (
                  <span key={c + i} className="relative">
                    <span className="block h-6 w-6 rounded-[7px] border border-black/5" style={{ background: c }} />
                    <button
                      type="button"
                      aria-label={'Remove ' + c}
                      onClick={() => setColors(colors.filter((_, j) => j !== i))}
                      className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white text-[8px] text-ink shadow-hairline"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={'Add ' + c}
                  onClick={() => setColors(colors.includes(c) ? colors : [...colors, c])}
                  className="h-7 w-7 rounded-[8px] border border-black/5 transition-transform hover:scale-105"
                  style={{ background: c }}
                />
              ))}
              {/* The capture's eyedropper. `EyeDropper` is Chromium-only, so this
                  is a colour input everywhere rather than a button that throws. */}
              <label className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[8px] border border-border text-ink-muted">
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M9.5 1.5l3 3-1.5 1.5-3-3 1.5-1.5ZM8 4L3 9v2h2l5-5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                </svg>
                <input
                  type="color"
                  className="sr-only"
                  aria-label="Pick a custom colour"
                  onChange={(e) => setColors([...colors, e.target.value.toUpperCase()])}
                />
              </label>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <SectionLabel>Typography Style</SectionLabel>
          <div className="flex flex-col gap-2.5 rounded-[12px] border border-border bg-white p-3">
            <span className="text-14 text-ink">
              Font Styles:{' '}
              <strong className="font-semibold">
                {[fonts.display, fonts.body].filter(Boolean).join(' , ') || 'System default'}
              </strong>
            </span>
            <BrandFontPicker value={fonts} onChange={setFonts} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <SectionLabel>Select Brand Voice:</SectionLabel>
          {/*
            The capture shows a select AND three chips at once, so the control is
            multi-select. `brand.governance.set` takes a single `toneVector`, so
            `save()` sends the first pick's vector - see the note there.
          */}
          <Select ariaLabel="Brand voice" value="" onChange={(v) => v && toggleVoice(v)}>
            <option value="">{selectedVoices.length ? selectedVoices.length + ' selected' : 'Choose a voice'}</option>
            {VOICE_PRESETS.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.label}
              </option>
            ))}
          </Select>
          <div className="flex flex-wrap gap-2">
            {selectedVoices.map((id) => (
              <Chip key={id} onRemove={() => toggleVoice(id)}>
                {VOICE_PRESETS.find((pr) => pr.id === id)?.label ?? id}
              </Chip>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <SectionLabel>Pick a timezone</SectionLabel>
          <div className="grid grid-cols-2 gap-2.5 rounded-[12px] border border-border bg-white p-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-13 text-ink-muted">Country</span>
              <Select
                ariaLabel="Country"
                value={region ?? ''}
                onChange={(r) => setTimezone(ZONES.find((z) => z.startsWith(r + '/')) ?? timezone)}
              >
                {countries.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-13 text-ink-muted">Timezone</span>
              {/* Only `timezone` reaches the tool. Country filters this list and is
                  not stored: there is no field for it, and an IANA zone already
                  implies its region. */}
              <Select ariaLabel="Timezone" value={timezone} onChange={setTimezone}>
                <option value="">Select</option>
                {ZONES.filter((z) => z.startsWith(region + '/')).map((z) => (
                  <option key={z} value={z}>
                    {z.split('/').slice(1).join('/')}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-16 font-semibold text-ink">Enable Strict Compliance</span>
        <Switch checked={strictMode} onChange={setStrictMode} label="Enable strict compliance" />
      </div>

      <div className="grid grid-cols-2 gap-x-[18px] gap-y-3">
        <div className="flex flex-col gap-1.5">
          <SectionLabel info="Topics and phrases SPARK must never write about.">
            Restricted Topics and phrases
          </SectionLabel>
          <TextField
            value={topicDraft}
            onChange={setTopicDraft}
            onEnter={() => {
              if (topicDraft.trim()) {
                setTopics(addTo(topics, topicDraft.trim()));
                setTopicDraft('');
              }
            }}
            placeholder="Input your topics/phrases"
            ariaLabel="Restricted topics"
          />
          <Suggestions items={GUARDRAIL_SUGGESTIONS} onPick={(v) => setTopics(addTo(topics, v))} />
          <div className="flex flex-wrap gap-2">
            {topicList.map((t) => (
              <Chip key={t} onRemove={() => setTopics(removeFrom(topics, t))}>
                {t}
              </Chip>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <SectionLabel info="Claims SPARK must never make, even where they are true.">
            Claims to Avoid?
          </SectionLabel>
          <TextField
            value={claimDraft}
            onChange={setClaimDraft}
            onEnter={() => {
              if (claimDraft.trim()) {
                setClaims(addTo(claims, claimDraft.trim()));
                setClaimDraft('');
              }
            }}
            placeholder="Input your claims to be avoided"
            ariaLabel="Claims to avoid"
          />
          <Suggestions items={GUARDRAIL_SUGGESTIONS} onPick={(v) => setClaims(addTo(claims, v))} />
          <div className="flex flex-wrap gap-2">
            {claimList.map((c) => (
              <Chip key={c} onRemove={() => setClaims(removeFrom(claims, c))}>
                {c}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      {busy ? <p className="text-13 text-ink-muted">Saving…</p> : null}
      {message ? (
        <p
          role={message.kind === 'err' ? 'alert' : undefined}
          className={message.kind === 'err' ? 'text-13 text-destructive' : 'text-13 text-ink-muted'}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}


const splitList = (text: string): string[] =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Falls back to the swatch a colour input can show, rather than claiming the brand's colour is grey. */

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
