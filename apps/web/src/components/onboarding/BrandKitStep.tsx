'use client';

import { useEffect, useState } from 'react';
import { BRAND_FONTS } from '@sparksocial/shared';
import {
  SectionLabel, SelectField, SmallSelect, Toggle, TagChip, Suggestions, TextInput,
  Swatch, PaletteSwatch, GUARDRAIL_SUGGESTIONS, PALETTE,
} from './kit';
import { ProtoScale } from './Stage';
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
    `…193155` at the prototype's own numbers: two 432-wide columns 27px apart,
    a 57px select, a 123px timezone card holding two 190×49 selects at radius 15,
    a 45×24.3 toggle, 55px guardrail inputs and 44px chips.

    The brand kit is NOT inside the assistant card — the bubble sits above it and
    these lay out on the background. Saving is on blur of the whole block.
  */
  return (
    <ProtoScale native={891}>
      <div style={{ width: 891, display: 'flex', flexDirection: 'column', gap: 38 }} onBlur={() => void save()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
          <span style={{ fontSize: 18, color: '#0C0C0C' }}>This is your brand kit generated from your URL</span>
          {/*
            Drawn in both sources, inert in both senses: nothing generates a
            palette from a crawl, so there is no preset to switch to. Kept
            visible because hiding it would hide a real gap.
          */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 14, height: 57, padding: '0 20px', borderRadius: 10, background: '#FFFFFF' }}>
            <span style={{ fontSize: 18, fontWeight: 500, color: '#0C0C0C' }}>Use This Brand Preset</span>
            <Toggle
              checked={false}
              disabled
              onChange={() => {}}
              label="Use this brand preset"
              title="No generated preset exists — nothing proposes a palette from a crawl."
            />
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '432px 432px', columnGap: 27, rowGap: 38 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <SectionLabel>Color Theme</SectionLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, width: 432, height: 57, borderRadius: 10, background: '#FFFFFF', padding: '0 18px' }}>
              <span style={{ fontSize: 18.3, color: '#0C0C0C', whiteSpace: 'nowrap' }}>Selected Colors</span>
              <span style={{ display: 'flex', gap: 10 }}>
                {colors.map((c, idx) => (
                  <Swatch key={c + idx} hex={c} onRemove={() => setColors(colors.filter((_, j) => j !== idx))} />
                ))}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 432 }}>
              {PALETTE.map((c) => (
                <PaletteSwatch key={c} hex={c} onPick={() => setColors(colors.includes(c) ? colors : [...colors, c])} />
              ))}
              {/* The prototype's eyedropper tile. A colour input, because the
                  `EyeDropper` API is Chromium-only and a throwing button is worse. */}
              <label
                style={{
                  width: 42.7, height: 42.7, borderRadius: 11.85, background: '#FFFFFF',
                  boxShadow: 'inset 0 0 0 1.5px rgba(12,12,12,0.4)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden style={{ display: 'block' }}>
                  <path d="m11.8 4.2 4 4M3 17l.7-3.7a2 2 0 0 1 .55-1.05l8.4-8.4a2 2 0 0 1 2.83 0l1.67 1.67a2 2 0 0 1 0 2.83l-8.4 8.4a2 2 0 0 1-1.05.55L4 18l-1-1Z" stroke="#838383" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <input type="color" aria-label="Pick a custom colour" style={{ display: 'none' }} onChange={(e) => setColors([...colors, e.target.value.toUpperCase()])} />
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <SectionLabel>Typography Style</SectionLabel>
            <div style={{ width: 432, height: 132, borderRadius: 10, background: '#FFFFFF', boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)', padding: '12.5px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, height: 35, whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: 20, color: '#0C0C0C' }}>Font Styles:</span>
                <span style={{ fontSize: 27, fontWeight: 700, color: '#0C0C0C' }}>{fonts.display || 'System'}</span>
                <span style={{ fontSize: 24, fontWeight: 700, color: '#0C0C0C' }}>, {fonts.body || 'default'}</span>
              </div>
              {/*
                The prototype has a single 393x49 "Choose Fonts" select on
                `#F3F4F8`, not the settings picker. `BrandFontPicker` renders its
                own live preview card, which overflowed this 132px card and
                bled a dark bar across the column — visible in the browser, not
                in any diff. The font list is still `BRAND_FONTS`, so the same
                values reach `brandFonts`.
              */}
              <div style={{ marginTop: 19, position: 'relative', width: 393, height: 49 }}>
                <select
                  aria-label="Choose fonts"
                  value={fonts.display ?? ''}
                  onChange={(e) => setFonts({ display: e.target.value, body: e.target.value })}
                  style={{
                    width: 393, height: 49, borderRadius: 10, background: '#F3F4F8', border: 'none',
                    outline: 'none', appearance: 'none', padding: '0 42px 0 18px', fontSize: 18,
                    color: fonts.display ? '#0C0C0C' : '#838383', cursor: 'pointer',
                  }}
                >
                  <option value="">Choose Fonts</option>
                  {BRAND_FONTS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label ?? f.id}
                    </option>
                  ))}
                </select>
                <svg width="11" height="5" viewBox="0 0 11 5" fill="none" aria-hidden style={{ position: 'absolute', right: 21, top: 22, display: 'block', pointerEvents: 'none' }}>
                  <path d="m1 1 4.5 3L10 1" stroke="rgba(12,12,12,0.4)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <SectionLabel>Select Brand Voice:</SectionLabel>
            {/* Multi-select, as both sources draw it. `toneVector` takes one
                vector, so `save()` sends the first pick's — see the note there. */}
            <SelectField
              ariaLabel="Brand voice"
              placeholder={selectedVoices.length ? `${selectedVoices.length} selected` : 'Choose a voice'}
              value=""
              onChange={(v: string) => v && toggleVoice(v)}
              options={VOICE_PRESETS.map((pr) => ({ value: pr.id, label: pr.label }))}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, width: 432 }}>
              {selectedVoices.map((id) => (
                <TagChip key={id} onRemove={() => toggleVoice(id)}>
                  {VOICE_PRESETS.find((pr) => pr.id === id)?.label ?? id}
                </TagChip>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <SectionLabel weight={700}>Pick a timezone</SectionLabel>
            <div style={{ position: 'relative', width: 432, height: 123, borderRadius: 10, background: '#FFFFFF', boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)' }}>
              <span style={{ position: 'absolute', left: 23, top: 17, fontSize: 18, color: '#838383' }}>Country</span>
              <div style={{ position: 'absolute', left: 20, top: 55 }}>
                <SmallSelect
                  ariaLabel="Country"
                  value={region ?? ''}
                  onChange={(r: string) => setTimezone(ZONES.find((z) => z.startsWith(`${r}/`)) ?? timezone)}
                  options={countries.map((c) => ({ value: c as string, label: c as string }))}
                />
              </div>
              <span style={{ position: 'absolute', left: 226, top: 17, fontSize: 18, color: '#838383' }}>Timezone</span>
              <div style={{ position: 'absolute', left: 223, top: 55 }}>
                {/* Only `timezone` reaches the tool: Country filters this list and
                    is not stored, since an IANA zone already implies its region. */}
                <SmallSelect
                  ariaLabel="Timezone"
                  value={timezone}
                  placeholder="Select"
                  onChange={setTimezone}
                  options={ZONES.filter((z) => z.startsWith(`${region}/`)).map((z) => ({ value: z, label: z.split('/').slice(1).join('/') }))}
                />
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#0C0C0C' }}>Enable Strict Compliance</span>
          <Toggle checked={strictMode} onChange={setStrictMode} label="Enable strict compliance" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '433px 433px', columnGap: 27 }}>
          <div>
            <SectionLabel info="Spark will never post or reply about these topics.">Restricted Topics and phrases</SectionLabel>
            <div style={{ marginTop: 11 }}>
              <TextInput
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
            </div>
            <Suggestions items={GUARDRAIL_SUGGESTIONS} onPick={(v) => setTopics(addTo(topics, v))} />
            <div style={{ marginTop: 22, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {topicList.map((t) => (
                <TagChip key={t} onRemove={() => setTopics(removeFrom(topics, t))}>
                  {t}
                </TagChip>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel info="Claims Spark must never make, even where they are true.">Claims to Avoid?</SectionLabel>
            <div style={{ marginTop: 11 }}>
              <TextInput
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
            </div>
            <Suggestions items={GUARDRAIL_SUGGESTIONS} onPick={(v) => setClaims(addTo(claims, v))} />
            <div style={{ marginTop: 22, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {claimList.map((c) => (
                <TagChip key={c} onRemove={() => setClaims(removeFrom(claims, c))}>
                  {c}
                </TagChip>
              ))}
            </div>
          </div>
        </div>

        {busy ? <p style={{ fontSize: 16, color: '#838383' }}>Saving…</p> : null}
        {message ? (
          <p role={message.kind === 'err' ? 'alert' : undefined} style={{ fontSize: 16, color: message.kind === 'err' ? '#F01C1C' : '#838383' }}>
            {message.text}
          </p>
        ) : null}
      </div>
    </ProtoScale>
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
