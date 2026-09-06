'use client';

import { cn } from '@/lib/utils';

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
  onBack,
  onNext,
  onClose,
  busy,
  note,
}: {
  step: 0 | 1 | 2 | 3;
  draft: WizardDraft;
  onDraft: (next: WizardDraft) => void;
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
        className="absolute inset-0 z-[80] cursor-default"
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
          className="absolute left-[30px] top-[30px] flex h-[46px] items-center rounded-[12px] px-[18px] text-[16.5px] font-semibold transition-colors hover:bg-white/80"
          style={{ background: 'rgba(255,255,255,0.55)', boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.28)', color: 'rgb(59,59,59)' }}
        >
          Back
        </button>

        <div className="absolute left-0 right-0 top-[37px] text-center">
          <p className="text-[18.5px] font-bold leading-none text-ink">
            {step === 3 ? '100% Completed' : `Step ${step + 1} of 4`}
          </p>
          <p className="mt-[8px] text-[14.5px] font-normal" style={{ color: '#9B9B9B' }}>
            {step === 3 ? 'Created your Social Media Agency' : 'Creating your Social Media Agency'}
          </p>
        </div>

        <button
          type="button"
          onClick={onNext}
          disabled={busy}
          className="absolute right-[30px] top-[30px] flex h-[46px] items-center rounded-[10px] px-[22px] text-[17.5px] font-semibold text-ink transition-colors hover:bg-white/70 disabled:opacity-60"
          style={{ background: 'rgba(255,255,255,0.45)' }}
        >
          {busy ? 'Working…' : step === 3 ? 'Launch' : 'Continue'}
        </button>

        <div
          className="absolute left-[292px] top-[94px] h-[14px] w-[452px] overflow-hidden rounded-[8px]"
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

        {/* ── the card ───────────────────────────────────────────────── */}
        <div
          className="absolute left-[24px] top-[296px] w-ag-wiz-card overflow-y-auto rounded-[26px] bg-white"
          style={{ height: h - 320, boxShadow: '0 30px 60px -46px rgba(12,12,12,0.4)' }}
        >
          {step === 0 ? <StepModel draft={draft} set={set} /> : null}
          {step === 1 ? <StepIdentity draft={draft} set={set} /> : null}
          {step === 2 ? <StepWebsite draft={draft} set={set} /> : null}
          {step === 3 ? <StepDone draft={draft} set={set} note={note} /> : null}
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
              className="absolute left-[20px] top-[30px] flex h-[58px] w-[58px] items-center justify-center rounded-[15px]"
              style={{ background: on ? '#F3F4F7' : 'rgba(131,131,131,0.08)' }}
            >
              {i === 0 ? (
                <svg width="30" height="30" viewBox="0 0 26 26" fill="none" aria-hidden>
                  <path d="M3 10 5 4h16l2 6M4 10v11a1.6 1.6 0 0 0 1.6 1.6h14.8A1.6 1.6 0 0 0 22 21V10" stroke="#0C0C0C" strokeWidth="1.7" strokeLinejoin="round" />
                  <path d="M3 10h20M10 22v-6h6v6" stroke="#0C0C0C" strokeWidth="1.7" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="30" height="30" viewBox="0 0 26 26" fill="none" aria-hidden>
                  <circle cx="13" cy="11" r="3" stroke="#0C0C0C" strokeWidth="1.7" />
                  <path d="M8 19c1-2.4 2.8-3.6 5-3.6s4 1.2 5 3.6" stroke="#0C0C0C" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              )}
            </span>

            <span className="absolute left-[20px] top-[106px] text-[19px] font-bold text-ink">{m.name}</span>
            <span className="absolute left-[20px] top-[137px] block w-[350px] text-[15px] font-medium leading-[1.4]" style={{ color: 'rgb(131,131,131)' }}>
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
      </div>

      <div className="mt-[34px] grid grid-cols-2 gap-x-[44px] gap-y-[28px]">
        <Field label="Agency Name">
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} aria-label="Agency name" maxLength={120} className={FIELD} style={RING} />
        </Field>
        <Field label="Your Name">
          <input value={draft.yourName} onChange={(e) => set({ yourName: e.target.value })} aria-label="Your name" className={FIELD} style={RING} />
        </Field>
        <Field label="Phone">
          <input value={draft.phone} onChange={(e) => set({ phone: e.target.value })} aria-label="Phone" inputMode="tel" className={FIELD} style={RING} />
        </Field>
        <Field label="Agency Email">
          <input value={draft.email} onChange={(e) => set({ email: e.target.value })} aria-label="Agency email" type="email" className={FIELD} style={RING} />
        </Field>
        <Field label="Tagline">
          <textarea
            value={draft.tagline}
            onChange={(e) => set({ tagline: e.target.value })}
            aria-label="Tagline"
            className="h-[150px] w-full resize-none rounded-[12px] bg-white px-[18px] py-[14px] text-[15px] font-medium text-ink outline-none"
            style={RING}
          />
        </Field>
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

      <div aria-hidden className="mt-[34px] h-px w-full" style={{ background: 'rgba(131,131,131,0.15)' }} />

      <h3 className="mt-[28px] text-[21px] font-bold leading-none text-ink">Brand Generator</h3>
      <p className="mt-[14px] text-[15px] font-normal" style={{ color: 'rgb(131,131,131)' }}>
        Choose a unique brand theme tailored to your vision.
      </p>
      <p className="mt-[16px] max-w-[720px] text-[14.5px] leading-[1.5]" style={{ color: 'rgb(131,131,131)' }}>
        The design offers logo upload and a colour theme here. Both belong to a brand rather than an
        agency, and the Brand Kit already owns them — a second place to set a palette is a second
        place for it to be wrong.
      </p>
    </div>
  );
}

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
                  className="h-[158px] w-[264px] rounded-[12px] bg-white text-left"
                  style={{ boxShadow: on ? 'inset 0 0 0 1.6px #0C0C0C' : 'inset 0 0 0 1px rgba(131,131,131,0.22)' }}
                >
                  <span className="absolute-none block px-[16px] pt-[13px] text-[14px] font-semibold text-ink">
                    Style {(i % 3) + 1}
                  </span>
                  {/* the design's little wireframe */}
                  <span className="mx-[16px] mt-[8px] block h-[104px] rounded-[8px]" style={{ background: '#EFF0F3' }}>
                    <span className="ml-[14px] mt-[18px] block h-[8px] w-[70px] rounded-[3px]" style={{ background: 'rgba(12,12,12,0.65)' }} />
                    <span className="ml-[14px] mt-[6px] block h-[5px] w-[100px] rounded-[2px]" style={{ background: '#C9CCD2' }} />
                    <span className="ml-[14px] mt-[5px] block h-[5px] w-[78px] rounded-[2px]" style={{ background: '#C9CCD2' }} />
                    <span className="ml-[14px] mt-[11px] block h-[13px] w-[46px] rounded-[4px]" style={{ background: '#5B7CFF' }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
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
                  <span
                    aria-hidden
                    className="absolute right-[11px] top-[11px] block h-[26px] w-[26px] rounded-full"
                    style={{ boxShadow: on ? 'inset 0 0 0 13px #8A45F0' : 'inset 0 0 0 1.5px rgba(131,131,131,0.4)' }}
                  />
                  <span className="mx-[16px] mt-[8px] block h-[124px] rounded-[8px]" style={{ background: '#F4F5F7' }} />
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
  note,
}: {
  draft: WizardDraft;
  set: (p: Partial<WizardDraft>) => void;
  note?: string | null;
}) {
  return (
    <div className="px-[44px] pb-[44px] pt-[56px]">
      <div className="flex items-start gap-[22px]">
        <span
          aria-hidden
          className="flex h-[62px] w-[62px] shrink-0 items-center justify-center rounded-[17px]"
          style={{ background: 'linear-gradient(150deg,#8B7BF5,#6C4BE0)', boxShadow: '0 12px 26px -12px rgba(108,75,224,0.6)' }}
        >
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
            <path d="m5 14 5 5L21 7" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h3 className="text-[28px] font-bold leading-[1.25] text-ink">
          Congratulations On Successfully Creating Your Ai Social Media Agency
        </h3>
      </div>

      <div className="mt-[36px] rounded-[16px] bg-ag-summary p-[24px]">
        <p className="text-[23px] font-bold text-ink">{draft.name.trim() || 'Your agency'}</p>
        <dl className="mt-[16px] grid grid-cols-2 gap-x-[40px] gap-y-[10px] text-[15px]">
          <Row label="Agency Email:" value={draft.email.trim() || '—'} />
          <Row label="Your Name:" value={draft.yourName.trim() || '—'} />
          <Row label="Tagline:" value={draft.tagline.trim() || '—'} />
          <Row label="Tone:" value={draft.tone} />
        </dl>
      </div>

      <p className="mt-[32px] text-[19px] font-bold text-ink">Connect your own domain</p>
      <div className="mt-[14px] rounded-[16px] p-[24px]" style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}>
        <p className="text-[15px] font-normal" style={{ color: 'rgb(91,91,91)' }}>
          Enter the domain you want to connect to your website
        </p>
        <input
          value={draft.domain}
          onChange={(e) => set({ domain: e.target.value })}
          placeholder="youragency.com"
          aria-label="Domain"
          className="mt-[14px] h-[56px] w-full rounded-[11px] px-[18px] text-[16px] font-semibold text-ink outline-none"
          style={{ background: '#F2F3F5' }}
        />

        <p className="mt-[26px] text-[15.5px] font-bold text-ink">DNS Records</p>
        <p className="mt-[8px] text-[14px] font-normal" style={{ color: 'rgb(131,131,131)' }}>
          The design lists the A and TXT records to add. They would come from whichever host serves the
          site — nothing provisions one yet, so there is no address to publish here.
        </p>
      </div>

      {/*
        The one honest statement this step owes. Everything above is a draft;
        Launch records that the portal has been set up and, if a name was given,
        offers to provision the organisation that would hold it.
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn('min-w-0')}>
      <dt className="inline font-normal" style={{ color: 'rgb(91,91,91)' }}>
        {label}{' '}
      </dt>
      <dd className="inline font-semibold" style={{ color: 'rgb(59,59,59)' }}>
        {value}
      </dd>
    </div>
  );
}
