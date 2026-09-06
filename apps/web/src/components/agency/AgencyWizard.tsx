'use client';


/**
 * `Agency Launch Wizard` — four steps in one modal.
 *
 *   modal    346,30 · 1036 wide r30 on `--ss-grad-ag-wiz`, shadow
 *            `0 60px 140px -40px rgba(0,0,0,0.55)`, entering with
 *            `ss-modal-in 0.25s cubic-bezier(0.22,1,0.36,1)`
 *   heights  **760 · 1280 · 1400 · 1360**, and the inner card is always 320 less
 *   back     30,30 · h46 r12 on `rgba(255,255,255,0.55)`, 16.5/600 `#3B3B3B`
 *   title    18.5/700 — "Step N of 4", then "100% Completed" on the last
 *   sub      14.5/400 `#9B9B9B` — "Creating…", then "Created…"
 *   next     h46 r10 on `rgba(255,255,255,0.45)`, 17.5/600 — "Continue",
 *            then "Launch"
 *   progress 292,94 · h14 r8 track `rgba(12,12,12,0.05)`, fill
 *            `--ss-grad-ag-progress` at **20% · 52% · 78% · 100%**
 *   card     24,296 · 988 x (H-320) r26 white, shadow
 *            `0 30px 60px -46px rgba(12,12,12,0.4)`
 *
 * ── What Launch actually does ─────────────────────────────────────────────
 *
 * The prototype writes `ss-agency-launched=1` to `localStorage` and toasts. That
 * is the whole of it — there is no agency record, no website generator, no DNS
 * provisioning behind any of these fields.
 *
 * This keeps the same latch, because the two home states are real states worth
 * having, and it says on the last step what did and did not happen. The one
 * field with a real destination is the agency name: `org.create` provisions an
 * organisation, which is the closest thing the registry has to an agency, and
 * it is offered as an explicit action rather than a side effect of "Launch".
 */

export const WIZ_HEIGHTS = [760, 1280, 1400, 1360] as const;
const PROGRESS = ['20%', '52%', '78%', '100%'] as const;

export interface WizardDraft {
  model: 0 | 1;
  name: string;
  yourName: string;
  phone: string;
  email: string;
  tagline: string;
  tone: string;
  /** The design's timezone pair, and step 3's two dropdowns. */
  country: string;
  timezone: string;
  titleFont: string;
  service: string;
  layout: number;
  template: number;
  domain: string;
}

export const emptyWizardDraft = (): WizardDraft => ({
  model: 0,
  name: '',
  yourName: '',
  phone: '',
  email: '',
  tagline: '',
  tone: 'Professional',
  country: '',
  timezone: '',
  titleFont: 'Asgard',
  service: 'Content creation',
  layout: 0,
  template: 0,
  domain: '',
});

const MODELS = [
  {
    name: 'Local Business Agency',
    desc: 'Help local businesses grow with AI content and social media.',
    x: 98,
  },
  {
    name: 'Personal Brand Agency',
    desc: 'Help coaches and creators dominate social media.',
    x: 534,
  },
] as const;

export function AgencyWizard({
  step,
  draft,
  onDraft,
  accounts,
  onBack,
  onNext,
  onClose,
  busy,
  note,
}: {
  step: 0 | 1 | 2 | 3;
  draft: WizardDraft;
  onDraft: (next: WizardDraft) => void;
  /** Connected publishing accounts, for the summary step's Accounts row. */
  accounts: Array<{ platform: string; label: string }>;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
  busy?: boolean;
  note?: string | null;
}) {
  const h = WIZ_HEIGHTS[step];
  const set = (patch: Partial<WizardDraft>) => onDraft({ ...draft, ...patch });

  return (
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 z-[80] animate-fade-in cursor-default motion-reduce:animate-none"
        style={{ background: 'rgba(30,34,40,0.5)' }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Agency launch wizard"
        className="absolute left-ag-wiz-x top-[30px] z-[81] w-ag-wiz-w animate-modal-in overflow-hidden rounded-[30px] bg-ag-wiz motion-reduce:animate-none"
        style={{ height: h, boxShadow: '0 60px 140px -40px rgba(0,0,0,0.55)' }}
      >
        {/* ── header ─────────────────────────────────────────────────── */}
        <button
          type="button"
          onClick={onBack}
          className="absolute left-[30px] top-[30px] z-[5] flex h-[46px] items-center gap-[10px] rounded-[12px] pl-[15px] pr-[22px] text-[16.5px] font-semibold transition-colors hover:bg-white"
          style={{ background: 'rgba(255,255,255,0.55)', boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.28)', color: 'rgb(59,59,59)' }}
        >
          <svg width="9" height="15" viewBox="0 0 8 16" fill="none" aria-hidden className="block">
            <path d="M7 1 1 8l6 7" stroke="#5B5B5B" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>

        <p className="absolute left-0 right-0 top-[37px] text-center text-[18.5px] font-bold leading-none text-ink">
          {step === 3 ? '100% Completed' : `Step ${step + 1} of 4`}
        </p>

        {/* The design sets this beside the progress track, not under the title. */}
        <div className="absolute right-[198px] top-[40px] flex items-center gap-[8px]">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden className="block">
            <path d="M13 7.5A5.5 5.5 0 1 1 11.4 3.6" stroke="#9B9B9B" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M13.2 1.6v3.2H10" stroke="#9B9B9B" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="whitespace-nowrap text-[14.5px] font-normal" style={{ color: '#9B9B9B' }}>
            {step === 3 ? 'Created your Social Media Agency' : 'Creating your Social Media Agency'}
          </span>
        </div>

        <button
          type="button"
          onClick={onNext}
          disabled={busy}
          className="absolute right-[28px] top-[30px] z-[5] flex h-[46px] items-center gap-[9px] rounded-[10px] px-[16px] text-[17.5px] font-semibold text-ink transition-colors hover:bg-white disabled:opacity-60"
          style={{ background: 'rgba(255,255,255,0.45)' }}
        >
          <span className="whitespace-nowrap">{busy ? 'Working…' : step === 3 ? 'Launch' : 'Continue'}</span>
          <svg width="8" height="14" viewBox="0 0 8 16" fill="none" aria-hidden className="block">
            <path d="m1 1 6 7-6 7" stroke="#0C0C0C" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div
          className="absolute left-[292px] right-[188px] top-[94px] h-[14px] overflow-hidden rounded-[8px]"
          style={{ background: 'rgba(12,12,12,0.05)' }}
          role="progressbar"
          aria-valuenow={step + 1}
          aria-valuemin={1}
          aria-valuemax={4}
          aria-label={`Step ${step + 1} of 4`}
        >
          <div
            className="h-full rounded-[8px] bg-ag-progress transition-[width] duration-500"
            style={{ width: PROGRESS[step] }}
          />
        </div>

        {/*
          The floating icon cluster and the scalloped notch it sits in — the
          design's decoration between the progress track and the step card.
          Purely ornamental, so the whole group is `aria-hidden`.
        */}
        <div aria-hidden>
          {/* a document/photo tile, tilted left */}
          <div
            className="absolute left-[352px] top-[186px] flex h-[42px] w-[58px] items-center justify-center rounded-[9px]"
            style={{ background: 'linear-gradient(160deg,#FDF3DE,#F6D89A)', boxShadow: '0 16px 30px -16px rgba(210,170,90,0.7)', transform: 'rotate(-7deg)', opacity: 0.92 }}
          >
            <svg width="32" height="22" viewBox="0 0 32 22" fill="none" className="block">
              <rect x="1" y="1" width="30" height="20" rx="3" fill="#FFFCF4" />
              <circle cx="8.5" cy="8" r="3" fill="#EBB24B" />
              <rect x="14" y="5" width="12" height="2.4" rx="1.2" fill="#E7C583" />
              <rect x="14" y="10" width="8" height="2.4" rx="1.2" fill="#EED9A6" />
              <path d="M1 18l7-6 5 4 4-3 14 7H1Z" fill="#E5A63C" opacity="0.5" />
            </svg>
          </div>

          {/* the Instagram tile */}
          <div
            className="absolute left-[634px] top-[184px] flex h-[48px] w-[48px] items-center justify-center rounded-[13px]"
            style={{ background: 'radial-gradient(circle at 30% 108%,#FFD600 0%,#FF6930 34%,#E1306C 62%,#7638FA 100%)', boxShadow: '0 16px 32px -14px rgba(225,48,108,0.6)', opacity: 0.95 }}
          >
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" className="block">
              <rect x="4" y="4" width="18" height="18" rx="5.4" stroke="#FFFFFF" strokeWidth="2" />
              <circle cx="13" cy="13" r="4.4" stroke="#FFFFFF" strokeWidth="2" />
              <circle cx="18.6" cy="7.4" r="1.4" fill="#FFFFFF" />
            </svg>
          </div>

          {/* the blue person disc */}
          <div
            className="absolute left-[348px] top-[262px] flex h-[44px] w-[44px] items-center justify-center rounded-full"
            style={{ background: 'linear-gradient(160deg,#8CD2F4,#5B93E8)', boxShadow: '0 14px 28px -14px rgba(76,140,224,0.7)', opacity: 0.85 }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="block">
              <circle cx="10" cy="4" r="2.6" fill="#FFFFFF" />
              <path d="M10 6.4v5.2m0 0 3.4 6.4M10 11.6 6.6 18" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>

          {/* the tilted photo tile */}
          <div
            className="absolute left-[436px] top-[280px] flex h-[44px] w-[54px] items-center justify-center rounded-[11px]"
            style={{ background: 'linear-gradient(160deg,#FFE9B8,#F4A94C)', boxShadow: '0 14px 30px -16px rgba(240,160,60,0.65)', opacity: 0.9, transform: 'rotate(6deg)' }}
          >
            <svg width="32" height="24" viewBox="0 0 32 24" fill="none" className="block">
              <rect x="1" y="1" width="30" height="22" rx="4" fill="#FDF4E0" />
              <circle cx="9" cy="8" r="3" fill="#F2A93C" />
              <path d="M1 18l8-8 5 5 4-4 13 10v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-4Z" fill="#E88F30" />
            </svg>
          </div>

          {/* the browser mock */}
          <div
            className="absolute left-[584px] top-[266px] h-[50px] w-[62px] rounded-[11px]"
            style={{ background: 'linear-gradient(170deg,#4E7BF0,#3157D6)', boxShadow: '0 16px 34px -16px rgba(64,102,224,0.65)', opacity: 0.92 }}
          >
            <div className="absolute left-[6px] right-[6px] top-[6px] flex h-[9px] items-center gap-[2.5px] rounded-[3px] bg-white px-[4px]">
              <span className="block h-[3px] w-[3px] rounded-full" style={{ background: '#57D9F2' }} />
              <span className="block h-[3px] w-[3px] rounded-full" style={{ background: '#F8B84A' }} />
              <span className="block h-[3px] w-[3px] rounded-full" style={{ background: '#F06BF5' }} />
            </div>
            <span className="absolute left-[6px] top-[20px] block h-[22px] w-[22px] rounded-[3px]" style={{ background: '#F2B23E' }} />
            <span className="absolute left-[32px] right-[6px] top-[20px] block h-[6px] rounded-[2px]" style={{ background: '#8FE39A' }} />
            <span className="absolute left-[32px] right-[6px] top-[30px] block h-[6px] rounded-[2px]" style={{ background: '#79D6F2' }} />
          </div>

          {/* the purple chat bubble */}
          <div
            className="absolute left-[664px] top-[238px] flex h-[44px] w-[46px] items-center justify-center"
            style={{ background: 'linear-gradient(160deg,#C99BF7,#9A55E8)', boxShadow: '0 14px 28px -14px rgba(150,80,230,0.6)', opacity: 0.85, borderRadius: '12px 12px 12px 3px' }}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" className="block">
              <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h11A1.5 1.5 0 0 1 18 5.5v7A1.5 1.5 0 0 1 16.5 14H9l-4 3.5V14H5.5A1.5 1.5 0 0 1 4 12.5v-7Z" fill="#FFFFFF" />
            </svg>
          </div>

          <div className="absolute left-[500px] top-[238px] flex gap-[10px]">
            <span className="block h-[9px] w-[9px] rounded-full" style={{ background: 'rgba(131,131,131,0.4)' }} />
            <span className="block h-[9px] w-[9px] rounded-full" style={{ background: 'rgba(131,131,131,0.4)' }} />
          </div>

          {/* the scalloped lip that ties the cluster to the card below */}
          <svg width="360" height="54" viewBox="0 0 360 54" fill="none" className="absolute left-[338px] top-[248px] z-[1] block">
            <path d="M0 54C72 54 96 6 180 6C264 6 288 54 360 54Z" fill="#FFFFFF" />
          </svg>
        </div>

        {/* ── the card ───────────────────────────────────────────────── */}
        <div
          className="absolute left-[24px] top-[296px] w-ag-wiz-card overflow-y-auto rounded-[26px] bg-white"
          style={{ height: h - 320, boxShadow: '0 30px 60px -46px rgba(12,12,12,0.4)' }}
        >
          {step === 0 ? <StepModel draft={draft} set={set} /> : null}
          {step === 1 ? <StepIdentity draft={draft} set={set} /> : null}
          {step === 2 ? <StepWebsite draft={draft} set={set} /> : null}
          {step === 3 ? <StepDone draft={draft} set={set} accounts={accounts} note={note} /> : null}
        </div>
      </div>
    </>
  );
}

/* ── step 1 · model ──────────────────────────────────────────────────── */

function StepModel({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  return (
    <div className="relative h-full">
      <h3 className="absolute left-[44px] top-[58px] text-[22px] font-bold leading-none text-ink">Choose Agency Model</h3>
      <p className="absolute left-[44px] top-[94px] text-[15.5px] font-normal" style={{ color: 'rgb(131,131,131)' }}>
        Select your preferred agency model
      </p>

      <div
        className="absolute left-[44px] top-[140px] h-[250px] w-[900px] rounded-[20px]"
        style={{ background: 'linear-gradient(180deg, rgba(238,240,251,0.6), rgba(236,230,248,0.45))' }}
      />

      {MODELS.map((m, i) => {
        const on = draft.model === i;
        return (
          <button
            key={m.name}
            type="button"
            onClick={() => set({ model: i as 0 | 1 })}
            aria-pressed={on}
            className="absolute top-[162px] h-[206px] w-[404px] rounded-[18px] text-left transition-shadow"
            style={{
              left: m.x - 24,
              background: on ? '#FFFFFF' : 'rgba(255,255,255,0.35)',
              boxShadow: on ? 'inset 0 0 0 1.6px #0C0C0C' : 'inset 0 0 0 1.3px rgba(12,12,12,0.1)',
            }}
          >
            <span
              aria-hidden
              className="absolute left-1/2 top-[30px] flex h-[58px] w-[58px] -translate-x-1/2 items-center justify-center rounded-[15px]"
              style={{ background: on ? '#F3F4F7' : 'rgba(131,131,131,0.08)' }}
            >
              {i === 0 ? (
                <svg width="34" height="34" viewBox="0 0 26 26" fill="none" aria-hidden>
                  <path d="M3 10 5 4h16l2 6M4 10v11a1.6 1.6 0 0 0 1.6 1.6h14.8A1.6 1.6 0 0 0 22 21V10" stroke="#0C0C0C" strokeWidth="1.7" strokeLinejoin="round" />
                  <path d="M3 10h20M10 22v-6h6v6" stroke="#0C0C0C" strokeWidth="1.7" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="34" height="34" viewBox="0 0 26 26" fill="none" aria-hidden>
                  <path d="M3 6.5V4.5A1.5 1.5 0 0 1 4.5 3H6M20 3h1.5A1.5 1.5 0 0 1 23 4.5v2M23 19.5v2a1.5 1.5 0 0 1-1.5 1.5H20M6 23H4.5A1.5 1.5 0 0 1 3 21.5v-2" stroke="#0C0C0C" strokeWidth="1.7" strokeLinecap="round" />
                  <circle cx="13" cy="11" r="3" stroke="#0C0C0C" strokeWidth="1.7" />
                  <path d="M8 19c1-2.4 2.8-3.6 5-3.6s4 1.2 5 3.6" stroke="#0C0C0C" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              )}
            </span>

            <span className="absolute left-[20px] right-[20px] top-[106px] text-center text-[19px] font-bold text-ink">{m.name}</span>
            <span className="absolute left-[34px] right-[34px] top-[137px] block text-center text-[15px] font-medium leading-[1.35]" style={{ color: 'rgb(131,131,131)' }}>
              {m.desc}
            </span>

            {on ? (
              <span
                aria-hidden
                className="absolute right-[18px] top-[18px] flex h-[26px] w-[26px] items-center justify-center rounded-full"
                style={{ background: 'linear-gradient(90deg,#6CE8FF,#F56BFF)' }}
              >
                <svg width="11" height="9" viewBox="0 0 12 10" fill="none" aria-hidden>
                  <path d="m1 5 3.2 3.2L11 1" stroke="#FFFFFF" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            ) : (
              <span
                aria-hidden
                className="absolute right-[18px] top-[18px] block h-[24px] w-[24px] rounded-full"
                style={{ boxShadow: 'inset 0 0 0 1.6px rgba(131,131,131,0.42)' }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── step 2 · identity ───────────────────────────────────────────────── */

const FIELD = 'h-[56px] w-full rounded-[12px] bg-white px-[18px] text-[15px] font-medium text-ink outline-none';
const RING = { boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.25)' } as const;

function StepIdentity({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  return (
    <div className="px-[44px] pb-[40px] pt-[56px]">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-[21px] font-bold leading-none text-ink">Agency Identity</h3>
          <p className="mt-[14px] text-[15px] font-normal" style={{ color: 'rgb(131,131,131)' }}>
            Create the business identity
          </p>
        </div>
        <GenerateWithAi />
      </div>

      <div className="mt-[34px] grid grid-cols-2 gap-x-[44px] gap-y-[28px]">
        <Field label="Agency Name">
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Enter agency name" aria-label="Agency name" maxLength={120} className={FIELD} style={RING} />
        </Field>
        <Field label="Your Name">
          <input value={draft.yourName} onChange={(e) => set({ yourName: e.target.value })} placeholder="Enter name" aria-label="Your name" className={FIELD} style={RING} />
        </Field>
        <Field label="Phone">
          <input value={draft.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="Enter phone" aria-label="Phone" inputMode="tel" className={FIELD} style={RING} />
        </Field>
        <Field label="Agency Email">
          <input value={draft.email} onChange={(e) => set({ email: e.target.value })} placeholder="Enter email" aria-label="Agency email" type="email" className={FIELD} style={RING} />
        </Field>
        <Field label="Tagline">
          <textarea
            value={draft.tagline}
            onChange={(e) => set({ tagline: e.target.value })}
            placeholder="Enter tagline"
            aria-label="Tagline"
            className="h-[150px] w-full resize-none rounded-[12px] bg-white px-[18px] py-[14px] text-[15px] font-medium text-ink outline-none"
            style={RING}
          />
        </Field>

        {/* The design's timezone pair, in its own 150-tall bordered panel. */}
        <Field label="Pick a timezone">
          <div className="h-[150px] rounded-[12px] p-[20px]" style={RING}>
            <div className="flex gap-[28px]">
              <div className="w-[180px]">
                <span className="block text-[14px] font-normal" style={{ color: 'rgb(131,131,131)' }}>Country</span>
                <select
                  value={draft.country}
                  onChange={(e) => set({ country: e.target.value, timezone: '' })}
                  aria-label="Country"
                  className="mt-[12px] h-[52px] w-full cursor-pointer appearance-none rounded-[11px] px-[16px] text-[15px] font-medium outline-none"
                  style={{ background: '#F2F3F5', color: draft.country ? 'rgb(59,59,59)' : '#9B9B9B' }}
                >
                  <option value="">Select</option>
                  {Object.keys(ZONES).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="w-[180px]">
                <span className="block text-[14px] font-normal" style={{ color: 'rgb(131,131,131)' }}>Timezone</span>
                <select
                  value={draft.timezone}
                  onChange={(e) => set({ timezone: e.target.value })}
                  aria-label="Timezone"
                  disabled={!draft.country}
                  className="mt-[12px] h-[52px] w-full cursor-pointer appearance-none rounded-[11px] px-[16px] text-[15px] font-medium outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ background: '#F2F3F5', color: draft.timezone ? 'rgb(59,59,59)' : '#9B9B9B' }}
                >
                  <option value="">Select</option>
                  {(ZONES[draft.country] ?? []).map((z) => (
                    <option key={z} value={z}>{z}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </Field>
      </div>

      <div aria-hidden className="mt-[34px] h-px w-full" style={{ background: 'rgba(131,131,131,0.15)' }} />

      <div className="mt-[28px] flex items-start justify-between">
        <div>
          <h3 className="text-[21px] font-bold leading-none text-ink">Brand Generator</h3>
          <p className="mt-[14px] text-[15px] font-normal" style={{ color: 'rgb(131,131,131)' }}>
            Choose unique brand theme tailored to your vision.
          </p>
        </div>
        <GenerateWithAi />
      </div>

      <div className="mt-[26px] w-[428px]">
        <Field label="Tone">
          <select
            value={draft.tone}
            onChange={(e) => set({ tone: e.target.value })}
            aria-label="Tone"
            className={`${FIELD} cursor-pointer appearance-none`}
            style={RING}
          >
            {['Professional', 'Friendly', 'Bold', 'Playful', 'Authoritative'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
      </div>

      <p className="mt-[24px] max-w-[720px] text-[14.5px] leading-[1.5]" style={{ color: 'rgb(131,131,131)' }}>
        The design puts a logo upload and a colour theme here too. Both belong to a brand rather than
        an agency, and the Brand Kit already owns them — a second place to set a palette is a second
        place for it to be wrong. brand.logo.generate is the tool that fills one, per brand.
      </p>
    </div>
  );
}

/**
 * The design's `#93E1F2` "Generate With Ai" button, twice on this step.
 *
 * Present and inert: no tool writes an agency identity or a brand theme — there
 * is no agency record for either to land on — so it says that on hover rather
 * than filling the fields with invented copy the user would have to undo.
 */
function GenerateWithAi() {
  return (
    <span
      className="flex h-[38px] shrink-0 items-center gap-[8px] rounded-[10px] px-[15px] text-[14px] font-semibold text-ink"
      style={{ background: '#93E1F2', opacity: 0.55 }}
      title="No tool generates an agency identity yet"
    >
      <svg width="15" height="15" viewBox="0 0 20 19" fill="none" aria-hidden className="block">
        <defs>
          <linearGradient id="ss-wiz-spark" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#3157D6" />
            <stop offset="1" stopColor="#A341FF" />
          </linearGradient>
        </defs>
        <path d="M10 0.8 11.9 6.4 17.6 8.3 11.9 10.2 10 15.8 8.1 10.2 2.4 8.3 8.1 6.4Z" fill="url(#ss-wiz-spark)" />
      </svg>
      <span className="whitespace-nowrap">Generate With Ai</span>
    </span>
  );
}

/** Enough of a spread to be useful without shipping a tz database in the bundle. */
const ZONES: Record<string, string[]> = {
  India: ['Asia/Kolkata'],
  Nigeria: ['Africa/Lagos'],
  'United Kingdom': ['Europe/London'],
  'United States': ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'],
  Canada: ['America/Toronto', 'America/Vancouver'],
  Australia: ['Australia/Sydney', 'Australia/Perth'],
  Germany: ['Europe/Berlin'],
  'South Africa': ['Africa/Johannesburg'],
  Kenya: ['Africa/Nairobi'],
  Singapore: ['Asia/Singapore'],
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[15.5px] font-semibold text-ink">{label}</label>
      <div className="mt-[10px]">{children}</div>
    </div>
  );
}

/* ── step 3 · website ────────────────────────────────────────────────── */

function StepWebsite({ draft, set }: { draft: WizardDraft; set: (p: Partial<WizardDraft>) => void }) {
  return (
    <div className="px-[44px] pb-[40px] pt-[56px]">
      <h3 className="text-[21px] font-bold leading-none text-ink">Agency Website</h3>
      <p className="mt-[14px] text-[15px] font-normal" style={{ color: 'rgb(131,131,131)' }}>
        A cutting-edge AI-driven agency website
      </p>

      <p className="mt-[28px] text-[15.5px] font-semibold text-ink">Layout Style</p>
      <div className="mt-[14px] rounded-[16px] p-[22px]" style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}>
        <p className="text-[14.5px] font-normal" style={{ color: '#9B9B9B' }}>Select Layout Style</p>
        <ul className="mt-[16px] grid grid-cols-3 gap-[8px]">
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const on = draft.layout === i;
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => set({ layout: i })}
                  aria-pressed={on}
                  className="relative h-[158px] w-[264px] rounded-[12px] bg-white text-left"
                  style={{ boxShadow: on ? 'inset 0 0 0 1.6px #0C0C0C' : 'inset 0 0 0 1px rgba(131,131,131,0.22)' }}
                >
                  <span className="block px-[16px] pt-[13px] text-[14px] font-semibold text-ink">
                    Style {(i % 3) + 1}
                  </span>
                  <span
                    aria-hidden
                    className="absolute right-[14px] top-[13px] flex items-center justify-center rounded-full"
                    style={
                      on
                        ? { width: 22, height: 22, background: 'linear-gradient(90deg,#6CE8FF,#F56BFF)' }
                        : { width: 20, height: 20, boxShadow: 'inset 0 0 0 1.5px rgba(131,131,131,0.4)' }
                    }
                  >
                    {on ? (
                      <svg width="11" height="9" viewBox="0 0 12 10" fill="none" aria-hidden className="block">
                        <path d="m1 5 3.2 3.2L11 1" stroke="#FFFFFF" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </span>

                  {/* the design's little wireframe */}
                  <span className="relative mx-[16px] mt-[8px] block h-[104px] overflow-hidden rounded-[8px]" style={{ background: '#EFF0F3' }}>
                    <span className="ml-[14px] mt-[18px] block h-[8px] w-[70px] rounded-[3px]" style={{ background: 'rgba(12,12,12,0.65)' }} />
                    <span className="ml-[14px] mt-[6px] block h-[5px] w-[100px] rounded-[2px]" style={{ background: '#C9CCD2' }} />
                    <span className="ml-[14px] mt-[5px] block h-[5px] w-[78px] rounded-[2px]" style={{ background: '#C9CCD2' }} />
                    <span className="ml-[14px] mt-[11px] block h-[13px] w-[46px] rounded-[4px]" style={{ background: '#5B7CFF' }} />
                    <span
                      className="absolute right-[14px] top-[16px] block h-[72px] w-[66px] rounded-[5px] bg-white"
                      style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.06)' }}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-[28px] grid grid-cols-2 gap-x-[44px]">
        <Field label="Title Fonts Style">
          <select
            value={draft.titleFont}
            onChange={(e) => set({ titleFont: e.target.value })}
            aria-label="Title fonts style"
            className="h-[58px] w-full cursor-pointer appearance-none rounded-[12px] bg-white px-[18px] text-[18px] font-bold text-ink outline-none"
            style={RING}
          >
            {['Asgard', 'Inter', 'Playfair Display', 'Space Grotesk', 'DM Serif'].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </Field>
        <Field label="Select services">
          <select
            value={draft.service}
            onChange={(e) => set({ service: e.target.value })}
            aria-label="Select services"
            className="h-[58px] w-full cursor-pointer appearance-none rounded-[12px] bg-white px-[18px] text-[15.5px] font-medium outline-none"
            style={{ ...RING, color: 'rgb(59,59,59)' }}
          >
            {['Content creation', 'Social media management', 'Paid ads', 'Strategy & consulting', 'Community management'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
      </div>

      <p className="mt-[28px] text-[15.5px] font-semibold text-ink">Templates</p>
      <div className="mt-[14px] rounded-[16px] p-[22px]" style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}>
        <p className="text-[14.5px] font-normal" style={{ color: '#9B9B9B' }}>Select Template Design</p>
        <ul className="mt-[16px] grid grid-cols-3 gap-[8px]">
          {[0, 1, 2].map((i) => {
            const on = draft.template === i;
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => set({ template: i })}
                  aria-pressed={on}
                  className="relative h-[196px] w-[264px] rounded-[12px] bg-white text-left"
                  style={{ boxShadow: 'inset 0 0 0 1.5px rgba(131,131,131,0.18)' }}
                >
                  <span className="block px-[16px] pt-[13px] text-[14px] font-semibold text-ink">Style {i + 1}</span>

                  {/* The design's preview eye. Nothing renders a template yet. */}
                  <span
                    aria-hidden
                    className="absolute right-[48px] top-[11px] flex h-[26px] w-[26px] items-center justify-center rounded-full"
                    style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)', opacity: 0.55 }}
                  >
                    <svg width="15" height="12" viewBox="0 0 19 15" fill="none" aria-hidden className="block">
                      <path d="M1.5 7.5S4.4 1.8 9.5 1.8s8 5.7 8 5.7-2.9 5.7-8 5.7-8-5.7-8-5.7Z" stroke="#5B5B5B" strokeWidth="1.3" strokeLinejoin="round" />
                      <circle cx="9.5" cy="7.5" r="2.2" stroke="#5B5B5B" strokeWidth="1.3" />
                    </svg>
                  </span>

                  <span
                    aria-hidden
                    className="absolute right-[14px] top-[11px] flex h-[26px] w-[26px] items-center justify-center rounded-full"
                    style={{ boxShadow: on ? 'inset 0 0 0 13px #8A45F0' : 'inset 0 0 0 1.5px rgba(131,131,131,0.4)' }}
                  >
                    {on ? (
                      <svg width="11" height="9" viewBox="0 0 12 10" fill="none" aria-hidden className="block">
                        <path d="m1 5 3.2 3.2L11 1" stroke="#FFFFFF" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </span>

                  <span className="mx-[16px] mt-[8px] flex h-[124px] items-end justify-center overflow-hidden rounded-[8px]" style={{ background: '#F4F5F7' }}>
                    <span
                      aria-hidden
                      className="block h-[108px] w-[96px] rounded-t-[8px] bg-white"
                      style={{ boxShadow: '0 -6px 20px -10px rgba(12,12,12,0.25)' }}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/* ── step 4 · done ───────────────────────────────────────────────────── */

function StepDone({
  draft,
  set,
  accounts,
  note,
}: {
  draft: WizardDraft;
  set: (p: Partial<WizardDraft>) => void;
  /** Connected publishing accounts, for the design's Accounts row. */
  accounts: Array<{ platform: string; label: string }>;
  note?: string | null;
}) {
  return (
    <div className="relative px-[44px] pb-[44px] pt-[56px]">
      {/* ── the two tiles the design floats either side of the headline ── */}
      <div aria-hidden className="absolute left-[30px] top-[56px] h-[62px] w-[62px]" style={{ transform: 'rotate(-12deg)' }}>
        <span className="absolute inset-0 block rounded-[15px] bg-white" style={{ boxShadow: '0 12px 26px -14px rgba(12,12,12,0.28)' }} />
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none" className="absolute left-[16px] top-[15px] block">
          <path d="M5 3.5 23 11l-7.2 2.2L13 21 5 3.5Z" fill="#F056C9" />
        </svg>
      </div>

      <div aria-hidden className="absolute right-[30px] top-[56px] h-[62px] w-[62px]" style={{ transform: 'rotate(11deg)' }}>
        <span
          className="absolute inset-0 block rounded-[17px]"
          style={{ background: 'linear-gradient(150deg,#8B7BF5,#6C4BE0)', boxShadow: '0 12px 26px -12px rgba(108,75,224,0.6)' }}
        />
        <svg width="30" height="26" viewBox="0 0 30 26" fill="none" className="absolute left-[16px] top-[18px] block">
          <circle cx="9" cy="8" r="2.4" fill="#FFFFFF" />
          <circle cx="20" cy="8" r="2.4" fill="#FFFFFF" />
          <path d="M8 15c2 2.4 11 2.4 13 0" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>

      <h3 className="mx-auto max-w-[700px] text-center text-[28px] font-bold leading-[1.26] text-ink">
        Congratulations On Successfully Creating Your Ai Social Media Agency
      </h3>

      {/* ── the summary card ─────────────────────────────────────────── */}
      <div className="relative mt-[60px] h-[300px] overflow-hidden rounded-[16px] bg-ag-summary">
        {/* the tilted glass panel the design floats on the right */}
        <span
          aria-hidden
          className="absolute right-[44px] top-[36px] block h-[236px] w-[196px] rounded-[12px]"
          style={{
            background: 'linear-gradient(160deg,rgba(255,255,255,0.7),rgba(255,255,255,0.25))',
            boxShadow: '0 18px 40px -26px rgba(60,120,200,0.5)',
            transform: 'rotate(4deg)',
          }}
        />

        <span
          aria-hidden
          className="absolute left-[24px] top-[30px] flex h-[56px] w-[56px] items-center justify-center rounded-full"
          style={{ background: 'radial-gradient(circle at 40% 34%,#EAF6FF,#BFE1FB)', boxShadow: '0 8px 20px -12px rgba(60,120,200,0.6)' }}
        >
          <svg width="30" height="28" viewBox="0 0 30 28" fill="none" className="block">
            <path d="M6 12a9 9 0 0 1 18 0v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V12Z" fill="#FFFFFF" />
            <circle cx="11.5" cy="13.5" r="2" fill="#3B6FB0" />
            <circle cx="18.5" cy="13.5" r="2" fill="#3B6FB0" />
          </svg>
        </span>

        <p className="absolute left-[96px] top-[46px] max-w-[420px] truncate text-[23px] font-bold text-ink">
          {draft.name.trim() || 'Your agency'}
        </p>

        {/*
          The design prints a live website URL here. Nothing provisions one, so
          this names the field and says it is unset rather than showing an
          address that would 404.
        */}
        <p className="absolute left-[24px] top-[114px] text-[15px] font-normal" style={{ color: 'rgb(91,91,91)' }}>
          Website URL:{' '}
          <b className="font-semibold" style={{ color: 'rgb(59,59,59)' }}>Not connected yet</b>
        </p>
        <p className="absolute left-[24px] top-[150px] text-[15px] font-normal" style={{ color: 'rgb(91,91,91)' }}>
          Agency Email:{' '}
          <b className="font-semibold" style={{ color: 'rgb(59,59,59)' }}>{draft.email.trim() || 'Not set'}</b>
        </p>
        <p className="absolute left-[24px] top-[186px] max-w-[420px] truncate text-[15px] font-normal" style={{ color: 'rgb(91,91,91)' }}>
          Tagline:{' '}
          <b className="font-semibold" style={{ color: 'rgb(59,59,59)' }}>{draft.tagline.trim() || 'Not set'}</b>
        </p>

        <span className="absolute left-[24px] top-[230px] text-[15px] font-semibold text-ink">Accounts:</span>
        <div className="absolute left-[120px] top-[222px] flex items-center gap-[9px]">
          {accounts.length === 0 ? (
            <span className="text-[13.5px]" style={{ color: 'rgb(131,131,131)' }}>None connected yet</span>
          ) : (
            accounts.slice(0, 7).map((a) => (
              <span
                key={a.platform}
                title={a.label}
                className="block h-[30px] w-[30px] rounded-[8px]"
                style={{ background: ACCOUNT_TINT[a.platform] ?? '#838383' }}
              />
            ))
          )}
        </div>

        <span className="absolute left-[24px] top-[272px] text-[15px] font-semibold text-ink">Tone:</span>
        <span
          className="absolute left-[82px] top-[264px] flex h-[32px] items-center rounded-[9px] px-[14px] text-[14px] font-semibold"
          style={{ background: '#EDEEF1', color: 'rgb(91,91,91)' }}
        >
          {draft.tone}
        </span>
        {/*
          The design's second chip counts generated assets ("6 Social Media
          Assets"). Nothing generates agency collateral, so it counts the thing
          that is real: the publishing accounts the portal can actually post to.
        */}
        <span
          className="absolute left-[214px] top-[264px] flex h-[32px] items-center rounded-[9px] px-[14px] text-[14px] font-semibold"
          style={{ background: '#EAF1FF', boxShadow: 'inset 0 0 0 1px rgba(59,111,255,0.4)', color: '#3B6FFF' }}
        >
          {accounts.length} Connected {accounts.length === 1 ? 'Account' : 'Accounts'}
        </span>
      </div>

      {/* ── domain ───────────────────────────────────────────────────── */}
      <div className="mt-[38px] flex items-start justify-between">
        <p className="text-[19px] font-bold text-ink">Connect your own domain</p>
        {/*
          The design's "Skip for now" advances the same way Launch does — it is
          the wizard's own escape from a step that cannot complete.
        */}
        <span
          className="flex h-[40px] items-center gap-[9px] rounded-[10px] bg-white px-[16px] text-[14.5px] font-semibold"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)', color: 'rgb(91,91,91)', opacity: 0.55 }}
          title="Nothing to skip — no domain can be linked yet"
        >
          Skip for now
          <svg width="14" height="11" viewBox="0 0 14 11" fill="none" aria-hidden className="block">
            <path d="m1 1 4.5 4.5L1 10M7 1l4.5 4.5L7 10" stroke="#5B5B5B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>

      <div className="mt-[14px] rounded-[16px] p-[24px]" style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}>
        <p className="text-[15px] font-normal" style={{ color: 'rgb(91,91,91)' }}>
          Enter the domain you want to connect to your website
        </p>
        <div className="mt-[14px] flex h-[56px] items-center justify-between rounded-[11px] px-[20px]" style={{ background: '#F2F3F5' }}>
          <input
            value={draft.domain}
            onChange={(e) => set({ domain: e.target.value })}
            placeholder="youragency.com"
            aria-label="Domain"
            className="h-full w-full bg-transparent text-[16px] font-semibold text-ink outline-none"
          />
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden className="block shrink-0">
            <path d="m12.4 4.2 3.4 3.4M2.6 17.4l.7-3.3a2 2 0 0 1 .54-1L11.4 5.8a1.7 1.7 0 0 1 2.4 0l1.4 1.4a1.7 1.7 0 0 1 0 2.4l-7.6 7.6a2 2 0 0 1-1 .54l-3.3.7-.7-1.2Z" stroke="#5B5B5B" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </div>

        <p className="mt-[26px] text-[15.5px] font-bold text-ink">DNS Records</p>
        <p className="mt-[8px] text-[14px] font-normal" style={{ color: 'rgb(131,131,131)' }}>
          Next, add the following records to your domain&apos;s DNS settings.
        </p>

        {/*
          The design's table, with its own two rows blanked. Its fixtures are a
          real A record and a real `replit.verify` token from whatever host
          served the mock — publishing either would point this user's domain at
          someone else's box. The shape stays so the step reads correctly.
        */}
        <div className="mt-[16px] overflow-hidden rounded-[10px]" style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.14)' }}>
          <div className="grid h-[48px] grid-cols-[148px_210px_1fr] items-center px-[22px]" style={{ background: '#ECEDF0' }}>
            <span className="text-[14.5px] font-semibold" style={{ color: 'rgb(59,59,59)' }}>Type</span>
            <span className="text-[14.5px] font-semibold" style={{ color: 'rgb(59,59,59)' }}>Hostname</span>
            <span className="text-[14.5px] font-semibold" style={{ color: 'rgb(59,59,59)' }}>Records</span>
          </div>
          {(['A', 'TXT'] as const).map((t) => (
            <div
              key={t}
              className="grid h-[60px] grid-cols-[148px_210px_1fr] items-center px-[22px]"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.14)' }}
            >
              <span className="text-[15px] font-medium" style={{ color: 'rgb(59,59,59)' }}>{t}</span>
              <span className="text-[15px] font-medium" style={{ color: 'rgb(59,59,59)' }}>@</span>
              <span className="text-[15px] font-medium" style={{ color: 'rgb(155,155,155)' }}>
                Issued when a host is provisioned
              </span>
            </div>
          ))}
        </div>
      </div>

      {/*
        The design's Cancel / Link pair. Link is what Launch already does at the
        top of the modal, so this is the same action rather than a second one.
      */}
      <div className="mt-[28px] flex justify-center gap-[12px]">
        <span
          className="flex h-[52px] w-[180px] items-center justify-center rounded-[11px] bg-white text-[15.5px] font-semibold"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)', color: 'rgb(91,91,91)', opacity: 0.55 }}
          title="Use Back, or close the wizard"
        >
          Cancel
        </span>
        <span
          className="flex h-[52px] w-[180px] items-center justify-center gap-[9px] rounded-[11px] bg-ink text-[15.5px] font-semibold text-white"
          style={{ opacity: 0.55 }}
          title="No domain can be linked yet — use Launch to finish"
        >
          Link
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none" aria-hidden className="block">
            <path d="M1 9 9 1M9 1H3M9 1v6" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>

      {/*
        The one honest statement this step owes. Everything above is a draft;
        Launch records that the portal has been set up.
      */}
      <p className="mt-[26px] max-w-[820px] text-[14.5px] leading-[1.55]" style={{ color: 'rgb(131,131,131)' }}>
        Launch marks the portal as set up and takes you to it. No website, collateral or DNS is
        generated — none of that exists in the product yet, and the fields above are kept as a draft
        rather than sent somewhere that would discard them.
      </p>
      {note ? <p className="mt-[14px] text-[15px] text-destructive">{note}</p> : null}
    </div>
  );
}

/** The chip tints, matching the account chips on Portal Home. */
const ACCOUNT_TINT: Record<string, string> = {
  instagram: '#E1306C',
  instagram_story: '#E1306C',
  facebook: '#1877F2',
  facebook_group: '#1877F2',
  linkedin: '#0A66C2',
  x: '#0C0C0C',
  tiktok: '#010101',
  youtube_shorts: '#FF0000',
  youtube_long: '#FF0000',
  threads: '#0C0C0C',
  pinterest: '#E60023',
  google_business: '#4285F4',
  reddit: '#FF4500',
  bluesky: '#0085FF',
};

