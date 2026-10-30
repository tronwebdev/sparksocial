'use client';

import { useEffect, useRef, useState } from 'react';
import { BRAND_FONTS } from '@sparksocial/shared';
import {
  SectionLabel, SelectField, SmallSelect, Toggle, TagChip, Suggestions, TextInput,
  guardrailSuggestions,
} from './kit';
import { ProtoScale } from './Stage';
import { TimezoneField } from '@/components/common/TimezoneField';
import { invoke } from '@/lib/tools';
import { notifyResult } from '@/lib/notify';
import { SparkLoader } from '@/components/brand/SparkLoader';

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



interface Governance {
  brandColors: string[];
  brandFonts?: { display?: string; body?: string };
  toneVector?: { formal: number; playful: number; technical: number; bold: number };
  timezone: string;
  strictMode: boolean;
  restrictedTopics: string[];
  claimsToAvoid: string[];
}

export function BrandKitStep({
  registerSave,
  crawledKit,
}: {
  registerSave?: (save: () => Promise<boolean>) => void;
  /**
   * What the crawl read off the site, when there was a crawl.
   *
   * `genome.bootstrap_from_url` already wrote these into governance, so the
   * values below would show them either way — this says where they came
   * from, which is the difference between the step's own promise ("generated
   * from your URL") and a palette the owner picked by hand on the step
   * before.
   */
  crawledKit?: { colors: string[]; fonts?: { display?: string; body?: string }; logoUrl?: string };
} = {}) {
  const [loaded, setLoaded] = useState(false);
  const [colors, setColors] = useState<string[]>([]);
  const [fonts, setFonts] = useState<{ display?: string; body?: string }>({});
  const [voice, setVoice] = useState<string>('');
  const [timezone, setTimezone] = useState('');
  const [strictMode, setStrictMode] = useState(false);
  /**
   * Press counts, not indices, so `guardrailSuggestions` can deal a fresh four
   * each time the row is pressed and wrap when it runs out of pool.
   */
  const [topicRound, setTopicRound] = useState(0);
  const [claimRound, setClaimRound] = useState(0);
  const [topics, setTopics] = useState('');
  const [claims, setClaims] = useState('');
  const [topicDraft, setTopicDraft] = useState('');
  const [claimDraft, setClaimDraft] = useState('');
  const [busy, setBusy] = useState(false);

  /*
   * ── These two live here, with the other hooks, and must stay here ──────
   *
   * They were below `if (!loaded) return …` further down, which is an early
   * return: the first render (nothing loaded yet) ran fewer hooks than the
   * second, and React refuses that — error #310, "rendered more hooks than
   * during the previous render". It does not degrade, it throws, and because
   * it throws during render it takes the whole app down to the Next.js
   * "client-side exception" screen. Every brand reaching this step hit it.
   *
   * Nothing in the build catches this: `tsc` is happy, the production build
   * compiles, and `apps/web` has no component tests. It was found by walking
   * the deployed flow in a browser, which is the only thing that would have.
   */
  const ownKit = useRef<{ colors: string[]; fonts: { display?: string; body?: string } } | null>(null);
  const [usingPreset, setUsingPreset] = useState(false);

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
    // Quiet on success: it saves on every blur as well as on Continue, and a
    // card per field would bury the step. Only a failure says so.
    return notifyResult(res, undefined, 'Couldn’t save your brand kit');
  }

  /*
   * Hand `save` up so Continue can call it.
   *
   * The only other trigger is `onBlur` on the container below, which fires when
   * focus leaves whatever the owner last touched. That covers the ordinary path
   * and nothing else: a control that never takes focus, or a value set without
   * one, leaves this screen looking filled in and saves nothing — and `save`
   * carries all seven settings here, so the silent loss is colours, fonts,
   * voice, timezone, strict mode and both guardrail lists together.
   *
   * Registered on every render rather than once, deliberately: `save` closes
   * over this render's state, and a stale closure would post the values as they
   * were when the step mounted.
   */
  useEffect(() => {
    registerSave?.(save);
  });

  if (!loaded) return <SparkLoader size="panel" label="Reading what SPARK already has…" />;

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

  /*
   * The preset, and what it replaced.
   *
   * `ownKit` remembers the colours and fonts as this screen first found them,
   * so turning the toggle off has something to go back to. It is captured on
   * load rather than on first toggle: by the time anyone can press it the
   * crawl's values are already in governance, so "before" has to mean "before
   * this screen opened", not "before the press".
   */
  const hasPreset = Boolean(crawledKit && (crawledKit.colors.length > 0 || crawledKit.fonts));

  function applyPreset(next: boolean) {
    if (!crawledKit) return;
    if (next) {
      ownKit.current = { colors, fonts };
      if (crawledKit.colors.length > 0) setColors(crawledKit.colors);
      if (crawledKit.fonts) setFonts(crawledKit.fonts);
    } else if (ownKit.current) {
      setColors(ownKit.current.colors);
      setFonts(ownKit.current.fonts);
    }
    setUsingPreset(next);
    /*
     * No `save()` here on purpose.
     *
     * `save` closes over `colors` and `fonts` from the current render, so
     * calling it in the same handler as `setColors` would persist the palette
     * this press just replaced — the previous one — and the screen would then
     * show one thing and have stored another. Every other control in this
     * block behaves the same way: the container saves on blur and `Continue`
     * flushes through `registerSave`, both of which run on a later render
     * where the new values are the ones in scope.
     */
  }

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
            The toggle used to be permanently off and disabled, because
            nothing proposed a palette from a crawl. `crawl.ts` now reads the
            site's own custom properties, button fills, fonts and logo, and
            `genome.bootstrap_from_url` writes them into governance.

            So the control is live — and it only switches *back*. Turning it
            off restores whatever the owner had chosen before the crawl
            proposed anything, which is the only second state that honestly
            exists: the preset is already applied by the time this screen
            opens.
          */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 14, height: 57, padding: '0 20px', borderRadius: 10, background: '#FFFFFF' }}>
            <span style={{ fontSize: 18, fontWeight: 500, color: '#0C0C0C' }}>Use This Brand Preset</span>
            <Toggle
              checked={usingPreset}
              disabled={!hasPreset}
              onChange={applyPreset}
              label="Use this brand preset"
              title={
                hasPreset
                  ? 'Switch between the colours and fonts read from your site and your own.'
                  : 'We could not read a palette or fonts from your site, so there is no preset to switch to.'
              }
            />
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '432px 432px', columnGap: 27, rowGap: 38 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <SectionLabel>Color Theme</SectionLabel>
            {/*
              Shown, not edited.
              
              This was a second `BrandColorPicker`, bound to the same
              `brandColors` field as the one on the Brand Details step — the
              same control, twice, two screens apart, with no way to tell
              which one you had already used. The palette is chosen there,
              beside the logo that is generated from it; here it is the kit
              being confirmed.
            */}
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 12, width: 432, height: 132, borderRadius: 10, background: '#FFFFFF', boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.1)', padding: '0 20px', flexWrap: 'wrap' }}
            >
              {colors.length === 0 ? (
                <span style={{ fontSize: 17, color: '#838383' }}>No colours chosen yet.</span>
              ) : (
                colors.map((hex) => (
                  <span key={hex} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      aria-hidden
                      style={{ width: 34, height: 34, borderRadius: 9, background: hex, boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.12)' }}
                    />
                    <span style={{ fontSize: 15, color: '#838383' }}>{hex}</span>
                  </span>
                ))
              )}
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
              {/*
                The design labels this pair "Country / Timezone". It says
                "Region" because the left select has only ever offered IANA
                region prefixes — Europe, Africa, America — and calling that a
                country is why the control read as broken: you cannot find
                Nigeria in a list whose entries are continents. A real country
                list is a dataset rather than a computation; see
                `packages/shared/src/timezones.ts`.
              */}
              <span style={{ position: 'absolute', left: 23, top: 17, fontSize: 18, color: '#838383' }}>Region</span>
              <span style={{ position: 'absolute', left: 226, top: 17, fontSize: 18, color: '#838383' }}>Timezone</span>
              {/* Only `timezone` reaches the tool: Region filters this list and
                  is not stored, since an IANA zone already implies its region. */}
              <div style={{ position: 'absolute', left: 20, top: 55, display: 'flex', gap: 13 }}>
                <TimezoneField value={timezone} onChange={setTimezone} Select={SmallSelect} />
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#0C0C0C' }}>Enable Strict Compliance</span>
          <Toggle checked={strictMode} onChange={setStrictMode} label="Enable strict compliance" />
        </div>

        {/*
          The prototype gates both guardrail fields on the toggle:
          `opacity: strict ? 1 : 0.4` and `pointer-events: strict ? auto : none`,
          over a 0.25s ease. `strict` starts false, so the fields open only once
          compliance is switched on - which is the right way round, since an
          empty restricted-topics list under strict mode is a decision, while
          the same list with the mode off is just an unanswered question.

          `pointer-events: none` alone would leave the inputs reachable by Tab,
          so the fieldset carries `disabled` too - that takes the controls out of
          the tab order and out of form submission, which is what the visual
          state is claiming.
        */}
        <fieldset
          disabled={!strictMode}
          style={{
            display: 'grid',
            gridTemplateColumns: '433px 433px',
            columnGap: 27,
            border: 'none',
            margin: 0,
            padding: 0,
            opacity: strictMode ? 1 : 0.4,
            pointerEvents: strictMode ? 'auto' : 'none',
            transition: 'opacity 0.25s ease',
          }}
        >
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
            <Suggestions
              items={guardrailSuggestions.restricted(topicRound)}
              onPick={(v) => setTopics(addTo(topics, v))}
              onRegenerate={() => setTopicRound((r) => r + 1)}
            />
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
            <Suggestions
              items={guardrailSuggestions.claims(claimRound)}
              onPick={(v) => setClaims(addTo(claims, v))}
              onRegenerate={() => setClaimRound((r) => r + 1)}
            />
            <div style={{ marginTop: 22, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {claimList.map((c) => (
                <TagChip key={c} onRemove={() => setClaims(removeFrom(claims, c))}>
                  {c}
                </TagChip>
              ))}
            </div>
          </div>
        </fieldset>

        {busy ? <SparkLoader size="inline" label="Saving…" /> : null}
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
