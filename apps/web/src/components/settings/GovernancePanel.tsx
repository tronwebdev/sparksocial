'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
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
  engagementAutonomy: 'off' | 'suggest' | 'auto';
  engagementTypes: string[];
  salesQualification: string[];
  salesHandoff: { hot: string; warm: string; cold: string };
  usingDefaultHandoff: boolean;
  salesDestination?: string;
  salesEscalationKeywords: string[];
}

/**
 * PRD §8.8's autonomy level. `off` is not the same as unset — it is the
 * conservative rung, and it is what `policy.ts` rule 6 reads as
 * "autonomy has not been configured", which holds every reply for approval.
 */
const ENGAGEMENT_LEVELS = [
  { value: 'off', label: 'Draft only', hint: 'SPARK writes the reply. You send it.' },
  { value: 'suggest', label: 'Suggest and hold', hint: 'Replies queue for your approval before sending.' },
  { value: 'auto', label: 'Answer the safe ones', hint: 'SPARK sends replies it judged safe, on its own.' },
] as const;

const ENGAGEMENT_TYPES = [
  { value: 'comment', label: 'Comments' },
  { value: 'dm', label: 'DMs' },
  { value: 'story_reply', label: 'Story replies' },
] as const;

/**
 * Sales Assist (`SET-WS-EI-SALES`).
 *
 * Each option authorises the agent to *do* something specific, so the labels
 * say what will happen rather than naming a capability — "Share your booking
 * link" is a promise the owner is making, and it should read like one.
 */
const QUALIFICATION_OPTIONS = [
  { value: 'ask_qualifying_questions', label: 'Ask qualifying questions', hint: 'What they want, when, budget.' },
  { value: 'share_booking_link', label: 'Share your booking link', hint: 'Sends people straight to your calendar.' },
  { value: 'share_pricing_link', label: 'Share your pricing page', hint: 'Only if your prices are public.' },
  { value: 'collect_contact_details', label: 'Collect contact details', hint: 'Asks for a name and a way to reach them.' },
] as const;

const HANDOFF_DESTINATIONS = [
  { value: 'crm_notify', label: 'Send on + notify me' },
  { value: 'save_notify', label: 'Save + notify me' },
  { value: 'nurture_only', label: 'Nurture only' },
] as const;

const TEMPERATURES = [
  { value: 'hot', label: 'Hot', emoji: '\ud83d\udd25', hint: 'Ready to buy' },
  { value: 'warm', label: 'Warm', emoji: '\ud83c\udf21\ufe0f', hint: 'Interested, not yet' },
  { value: 'cold', label: 'Cold', emoji: '\u2744\ufe0f', hint: 'Just looking' },
] as const;

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
  const [brandColors, setBrandColors] = useState<string[]>([]);
  const { genome } = useSelectedGenome();
  const genomeId = genome?.genomeId;
  const logoInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [engagementAutonomy, setEngagementAutonomy] = useState<'off' | 'suggest' | 'auto'>('off');
  const [engagementTypes, setEngagementTypes] = useState<string[]>([]);
  const [salesQualification, setSalesQualification] = useState<string[]>([]);
  const [salesHandoff, setSalesHandoff] = useState<{ hot: string; warm: string; cold: string }>({
    hot: 'crm_notify',
    warm: 'save_notify',
    cold: 'nurture_only',
  });
  const [usingDefaultHandoff, setUsingDefaultHandoff] = useState(true);
  const [salesDestination, setSalesDestination] = useState('');
  const [escalationText, setEscalationText] = useState('');
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
      setBrandColors(g.brandColors);
      setEngagementAutonomy(g.engagementAutonomy);
      setEngagementTypes(g.engagementTypes);
      setSalesQualification(g.salesQualification);
      setSalesHandoff(g.salesHandoff);
      setUsingDefaultHandoff(g.usingDefaultHandoff);
      setSalesDestination(g.salesDestination ?? '');
      setEscalationText(g.salesEscalationKeywords.join(', '));
    })();
  }, []);

  /**
   * `asset.upload_url` → PUT the bytes → use the read URL as the logo.
   *
   * Deliberately does *not* call `asset.ingest_url` afterwards, unlike
   * `AssetUploadForm`. A logo is not a content asset: putting it in the Asset
   * Graph would make it eligible for retrieval into posts as though it were
   * footage, and it would count against the reuse cooldown. It needs to be a
   * URL a renderer can fetch, and nothing more.
   */
  async function uploadLogo(file: File) {
    if (!genomeId) {
      setMessage({ kind: 'err', text: 'Pick a brand first.' });
      return;
    }
    const contentType = file.type;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) {
      setMessage({ kind: 'err', text: 'PNG, JPEG or WebP. A vector logo needs exporting to one of those first.' });
      return;
    }

    setUploading(true);
    setMessage(null);

    const presigned = await invoke<{ uploadUrl: string; readUrl: string }>('asset.upload_url', {
      genomeId,
      filename: file.name,
      contentType,
      sizeBytes: file.size,
    });
    if (presigned.status !== 'succeeded') {
      setUploading(false);
      setMessage({
        kind: 'err',
        text: presigned.status === 'failed' ? presigned.error.message : 'That upload was gated.',
      });
      return;
    }

    try {
      // `x-ms-blob-type` is Azure's requirement for a SAS upload, not ours —
      // same header `AssetUploadForm` sends, and omitting it 400s.
      const put = await fetch(presigned.output.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': contentType, 'x-ms-blob-type': 'BlockBlob' },
        body: file,
      });
      if (!put.ok) throw new Error(`Storage rejected the upload (${put.status}).`);
    } catch (e) {
      setUploading(false);
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'The upload could not reach storage.' });
      return;
    }

    setUploading(false);
    setLogoUrl(presigned.output.readUrl);
    // Not saved yet, and said so: the field is part of one form with a single
    // Save, and a logo that persisted on upload while the colours beside it did
    // not would be two different rules on one panel.
    setMessage({ kind: 'ok', text: 'Uploaded. Save brand rules to apply it.' });
  }

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
      // Same `null`-clears rule as the lists above: an empty palette and "no
      // palette" mean the same thing to a renderer, and only one of them lets
      // the default come back.
      brandColors: brandColors.length ? brandColors : null,
      engagementAutonomy,
      // Empty means every type, which is a different fact from "none" — so it
      // clears rather than storing an empty list.
      engagementTypes: engagementTypes.length ? engagementTypes : null,
      // Same `null`-clears rule: no qualification moves is the safe state, and
      // an empty list has to be able to mean that rather than being unsendable.
      salesQualification: salesQualification.length ? salesQualification : null,
      // Only send a handoff map the brand has actually chosen. Sending the
      // resolved default back would convert "no preference" into a choice and
      // the default could then never move \u2014 the same reasoning as
      // `postingWindows` above.
      salesHandoff: usingDefaultHandoff ? null : salesHandoff,
      salesDestination: salesDestination.trim() ? salesDestination.trim() : null,
      salesEscalationKeywords: splitList(escalationText).length ? splitList(escalationText) : null,
    });

    setBusy(false);
    if (res.status === 'succeeded') {
      setUsingDefaultWindows(res.output.usingDefaultWindows);
      setWindows(res.output.postingWindows);
      // Resolved server-side, so an incomplete map the client sent comes back as
      // the defaults rather than leaving the screen claiming a rule nothing obeys.
      setUsingDefaultHandoff(res.output.usingDefaultHandoff);
      setSalesHandoff(res.output.salesHandoff);
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

          {/* ── Engagement (§8.8) ──────────────────────────────────────── */}
          <div>
            <h3 className="text-[14px] font-medium text-ink">Answering your audience</h3>
            <p className="mt-0.5 text-[12px] text-ink-muted">
              How much SPARK may say back on its own. It cannot reply at all until a campaign has been
              running two weeks with five posts out — this decides what happens after that.
            </p>

            <ul className="mt-3 grid grid-cols-1 gap-2">
              {ENGAGEMENT_LEVELS.map((l) => (
                <li key={l.value}>
                  <button
                    type="button"
                    aria-pressed={engagementAutonomy === l.value}
                    onClick={() => setEngagementAutonomy(l.value)}
                    className={cn(
                      'w-full rounded-lg border p-3 text-left transition-colors',
                      engagementAutonomy === l.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-surface-muted',
                    )}
                  >
                    <span className="block text-[14px] font-medium text-ink">{l.label}</span>
                    <span className="mt-0.5 block text-[12px] text-ink-muted">{l.hint}</span>
                  </button>
                </li>
              ))}
            </ul>

            <p className="mt-3 text-[12px] font-medium text-ink-muted">Where it may answer</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {ENGAGEMENT_TYPES.map((t) => {
                // Empty means all three, so nothing selected reads as "everywhere".
                const on = engagementTypes.length === 0 || engagementTypes.includes(t.value);
                return (
                  <button
                    key={t.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setEngagementTypes((prev) => {
                        const current = prev.length ? prev : ENGAGEMENT_TYPES.map((x) => x.value);
                        const next = current.includes(t.value)
                          ? current.filter((x) => x !== t.value)
                          : [...current, t.value];
                        // Back to "all" rather than storing a list that happens
                        // to contain everything.
                        return next.length === ENGAGEMENT_TYPES.length ? [] : next;
                      })
                    }
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-[13px] transition-colors',
                      on
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-ink-muted hover:bg-surface-muted',
                    )}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Sales Assist (`SET-WS-EI-SALES`) ───────────────────────────
              The screen the design specified and nothing could store. Four
              qualification moves, a handoff rule per lead temperature, and the
              escalation list \u2014 which is the one hard guarantee here:
              `engage.classify` overrides itself deterministically on a match,
              rather than asking the model to weigh it against everything else. */}
          <div>
            <h3 className="text-[14px] font-medium text-ink">Turning interest into work</h3>
            <p className="mt-0.5 text-[12px] text-ink-muted">
              When someone sounds like a customer rather than a commenter, this decides what SPARK may do
              about it and where the lead goes.
            </p>

            <p className="mt-3 text-[12px] font-medium text-ink-muted">What SPARK may do</p>
            <ul className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {QUALIFICATION_OPTIONS.map((o) => {
                const on = salesQualification.includes(o.value);
                return (
                  <li key={o.value}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setSalesQualification((prev) =>
                          prev.includes(o.value) ? prev.filter((x) => x !== o.value) : [...prev, o.value],
                        )
                      }
                      className={cn(
                        'w-full rounded-lg border p-3 text-left transition-colors',
                        on ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-muted',
                      )}
                    >
                      <span className="block text-[13px] font-medium text-ink">{o.label}</span>
                      <span className="mt-0.5 block text-[12px] text-ink-muted">{o.hint}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {salesQualification.length === 0 && (
              <p className="mt-2 text-[12px] text-ink-muted">
                Nothing selected: SPARK will flag the lead and let you take it from there.
              </p>
            )}

            <p className="mt-4 text-[12px] font-medium text-ink-muted">Where each lead goes</p>
            <div className="mt-1.5 space-y-2">
              {TEMPERATURES.map((t) => (
                <div key={t.value} className="flex flex-wrap items-center gap-2">
                  <span className="flex w-[132px] shrink-0 items-baseline gap-1.5">
                    <span aria-hidden>{t.emoji}</span>
                    <span className="text-[13px] font-medium text-ink">{t.label}</span>
                    <span className="text-[11px] text-ink-muted">{t.hint}</span>
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {HANDOFF_DESTINATIONS.map((d) => {
                      const on = salesHandoff[t.value] === d.value;
                      return (
                        <button
                          key={d.value}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            setSalesHandoff((prev) => ({ ...prev, [t.value]: d.value }));
                            // Touching any row makes the whole map this brand's
                            // own choice. A partly-chosen map is a lead with no
                            // rule, so it is all three or the defaults.
                            setUsingDefaultHandoff(false);
                          }}
                          className={cn(
                            'rounded-full border px-3 py-1.5 text-[13px] transition-colors',
                            on
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border text-ink-muted hover:bg-surface-muted',
                            usingDefaultHandoff && on && 'opacity-60',
                          )}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {usingDefaultHandoff && (
              <p className="mt-2 text-[12px] text-ink-muted">
                These are the defaults. Change any row to make them yours.
              </p>
            )}

            <label className="mt-4 block text-[12px] font-medium text-ink-muted" htmlFor="gov-sales-destination">
              Send leads on to
            </label>
            <p className="mt-1 text-[12px] text-ink-muted">
              An email address or a CRM inbox. Only used for the rows set to &ldquo;send on&rdquo; \u2014 without
              it, those leads wait in Sales Opportunities instead.
            </p>
            <Input
              id="gov-sales-destination"
              value={salesDestination}
              onChange={(e) => setSalesDestination(e.target.value)}
              placeholder="sales@yourcompany.com"
              className="mt-1.5 max-w-md"
            />

            <label className="mt-4 block text-[12px] font-medium text-ink-muted" htmlFor="gov-escalation">
              Always send these to you
            </label>
            <p className="mt-1 text-[12px] text-ink-muted">
              A message containing any of these words goes to Needs Review and SPARK will not offer a reply for
              it \u2014 no matter how routine it looked. Comma separated.
            </p>
            <Input
              id="gov-escalation"
              value={escalationText}
              onChange={(e) => setEscalationText(e.target.value)}
              placeholder="refund, chargeback, lawsuit, complaint, scam"
              className="mt-1.5 max-w-xl"
            />
            {splitList(escalationText).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {splitList(escalationText).map((word) => (
                  <span
                    key={word}
                    className="rounded-full border border-warn/40 bg-warn/10 px-2.5 py-1 text-[12px] text-ink"
                  >
                    {word}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ── Brand kit ──────────────────────────────────────────────────
              §8.6's "Apply Brand Kit". Both fields have existed on the row and
              been writable for a while, and until now nothing rendered with
              either: `compose.static` and `compose.render` read them now, so
              what is set here reaches actual pixels. */}
          <div className="max-w-xl">
            <p className="text-[12px] font-medium text-ink-muted">Brand kit</p>
            <p className="mt-1 text-[12px] text-ink-muted">
              Used when SPARK renders an image or video: the first colour is the background, the second is the
              text on it, the third is an accent. The logo goes bottom-left. Photos and video are never tinted —
              a brand colour over somebody&rsquo;s product shot ruins the shot.
            </p>

            <label className="mt-3 block text-[12px] text-ink-muted" htmlFor="gov-logo">
              Logo
            </label>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Input
                id="gov-logo"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://… or upload"
                className="min-w-[200px] flex-1"
              />
              <input
                ref={logoInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadLogo(file);
                  e.target.value = '';
                }}
              />
              <Button variant="outline" size="sm" disabled={uploading} onClick={() => logoInput.current?.click()}>
                {uploading ? 'Uploading…' : 'Upload'}
              </Button>
            </div>
            {logoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={logoUrl}
                alt="Brand logo"
                className="mt-2 h-12 w-auto max-w-[160px] rounded border border-border bg-surface-muted object-contain p-1"
              />
            ) : null}

            <label className="mt-4 block text-[12px] text-ink-muted">Colours</label>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {brandColors.map((c, i) => (
                <div key={`${c}-${i}`} className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1">
                  <input
                    type="color"
                    value={normaliseHex(c)}
                    onChange={(e) => setBrandColors(brandColors.map((x, j) => (j === i ? e.target.value : x)))}
                    className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0"
                    aria-label={`${COLOR_ROLE[i] ?? 'Extra'} colour`}
                  />
                  <span className="font-mono text-[11px] text-ink-muted">
                    {COLOR_ROLE[i] ?? 'extra'}
                    {/* A stored value the colour input cannot show (`red`, an
                        `rgb()`) is named here rather than silently displayed as
                        the fallback swatch — otherwise the panel would claim the
                        brand's colour is grey. */}
                    {normaliseHex(c) !== c.trim().toLowerCase() ? (
                      <span className="ml-1 text-warn">{c}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => setBrandColors(brandColors.filter((_, j) => j !== i))}
                    className="text-[13px] text-ink-muted hover:text-ink"
                    aria-label={`Remove ${c}`}
                  >
                    ×
                  </button>
                </div>
              ))}
              {brandColors.length < 3 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBrandColors([...brandColors, DEFAULT_NEW_COLOR])}
                >
                  Add {COLOR_ROLE[brandColors.length] ?? 'colour'}
                </Button>
              ) : null}
            </div>
            {brandColors.length > 0 ? (
              /* A swatch row is not a preview. Showing the two colours against
                 each other is the one check that catches the mistake that
                 matters — a type colour nobody can read on its own ground. */
              <div
                className="mt-2 flex h-16 items-center justify-center rounded-lg border border-border"
                style={{ backgroundColor: brandColors[0] ?? '#0C0C0C' }}
              >
                <span className="text-[15px] font-medium" style={{ color: brandColors[1] ?? '#FFFFFF' }}>
                  This is how text will read
                </span>
              </div>
            ) : null}
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

/**
 * The palette is positional, and the labels say so rather than leaving somebody
 * to discover it. Matches `resolveKit` in `@sparksocial/compose` exactly — if
 * these ever disagree, the panel is lying about what the renderer will do.
 */
const COLOR_ROLE = ['background', 'text', 'accent'] as const;

/** A mid grey: visibly unset, and legible against either default while it is being changed. */
const DEFAULT_NEW_COLOR = '#808080';

/**
 * `<input type="color">` accepts only `#rrggbb`. A stored value could be
 * anything a person typed — `red`, `#fff`, an `rgb()` — so anything that is not
 * already six-digit hex falls back rather than making the swatch render black
 * and silently rewrite the stored colour on the next save.
 */
function normaliseHex(value: string): string {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return DEFAULT_NEW_COLOR;
}
