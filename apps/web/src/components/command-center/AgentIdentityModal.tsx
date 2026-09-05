'use client';

import { useEffect, useState } from 'react';
import { ModalShell } from '@/components/common/ModalShell';
import { invoke } from '@/lib/tools';

/**
 * AGENT IDENTITY — Ownership & Personality.
 *
 * ── Where the design for this came from ──────────────────────────────────
 *
 * Not from `ui build/`. I searched every `.dc.html` for "Agent Identity",
 * "Identity Attributes", "Governance & Safeguards" and "Ownership &
 * Personality" and none of them appear in any prototype file — the screenshot
 * supplied with the request is the only specification, so this is built to it
 * rather than measured off a stage. Its numbers are therefore read off the
 * image and its structure is followed exactly; if the `.dc.html` for it turns
 * up later, this is the file to diff against it.
 *
 *   panel     ~1164 wide at top 28, radius ~28, on a white → pale-cyan
 *             gradient under a deep shadow (`ModalShell`, whose box this is)
 *   title     28px/700 "Agent Identity — Ownership & Personality" over a
 *             17px/400 grey subtitle
 *   hero      a pale-cyan band, radius 20, with a ringed avatar overlapping
 *             its left edge, the agent's name at 32px/700, a Status pill, and
 *             two inline facts: the voice adjectives in `#2F8291` behind a
 *             person glyph, and the risk tolerance in `#8937D6` behind a shield
 *   cards     two, side by side — "Identity Attributes" (a label/value table)
 *             and "Avatar & Voice" (source, two avatar buttons, voice profile,
 *             one voice button)
 *   footer    "Governance & Safeguards" with a shield, then three ✓ rows
 *
 * ── Every value on this screen, and what it comes from ───────────────────
 *
 * `brand.governance.get` already derives an `agentIdentity` — name, voice
 * adjectives, risk tolerance and the *reason* for it — precisely so a screen
 * like this cannot disagree with the settings it describes
 * (`packages/shared/src/agentIdentity.ts`). That is the whole hero band, and
 * three of the four attribute rows, for free.
 *
 * Two of the screenshot's labels have no field behind them, and each is handled
 * the same way — keep the row, put something true in it, say what changed:
 *
 *   **"Primary Role: Social Growth & Authority"** is not stored anywhere. The
 *   genome has an `objective`, but no read tool exposes it (`genome.list`
 *   returns id/name/updatedAt), and inventing a role from the brand's name
 *   would be a sentence about the agent that nothing could check. The row shows
 *   **Autonomy** instead — the approval mode, which is the closest real answer
 *   to "what is this agent allowed to do on its own" and is the same field the
 *   risk tolerance below it is derived from.
 *
 *   **"Voice Profile: Cloned (v2)"** describes a cloned voice. `genome.voice.set`
 *   and `genome.avatar_config.set` are **write-only** — there is no read for
 *   either — so the card cannot report what is configured. It says where the
 *   setting lives and links there, which is the honest version of a status line
 *   nobody can query.
 *
 * The three governance ticks are real: hard rules are the restricted topics
 * (`brand.governance.get` returns them), and the guardrail pass is
 * `packages/guardrails` running on every draft — a fact about the pipeline, not
 * a toggle, so it is stated as one.
 */

interface AgentIdentity {
  name: string;
  named: boolean;
  voice: string[];
  riskTolerance: 'Low' | 'Moderate' | 'High';
  riskBecause: string;
}

interface Governance {
  agentIdentity: AgentIdentity;
  hardRules: Array<{ id?: string; label?: string; rule?: string }>;
  engagementAutonomy: 'off' | 'suggest' | 'auto';
  logoUrl?: string;
  brandColors: string[];
}

const APPROVAL_LABEL: Record<string, string> = {
  autopublish: 'Publishes on its own',
  review_first_week: 'Reviewed for the first week',
  review_everything: 'Every post reviewed',
};

const CARD = 'rounded-[16px] bg-white';
const CARD_RING = { boxShadow: '0 1px 0 rgba(12,12,12,0.04), inset 0 0 0 1px rgba(131,131,131,0.16)' } as const;

export function AgentIdentityModal({
  paused,
  approvalMode,
  onClose,
}: {
  /** From `agent.status`, which the rail already holds. */
  paused: boolean;
  /** From `agent.approval_mode.get`, or absent when the caller has not read it. */
  approvalMode?: string;
  onClose: () => void;
}) {
  const [gov, setGov] = useState<Governance | null>(null);
  const [ownMode, setOwnMode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await invoke<Governance>('brand.governance.get', {});
      if (cancelled) return;
      if (res.status !== 'succeeded') {
        setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
        return;
      }
      setGov(res.output);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The approval mode, read here when the caller has not got it.
   *
   * The rail passes it when it knows it; the Calendar tab's own button does
   * not, and the Autonomy row read "—" from that button — a dash where the most
   * load-bearing fact on the panel goes. A modal that needs one more field
   * should fetch one more field.
   */
  useEffect(() => {
    if (approvalMode !== undefined) return;
    let cancelled = false;
    void (async () => {
      /* `approvalMode`, not `mode` — `ApprovalGetOutput` names it the long way,
         and reading the wrong key would have shown "Reading…" forever. */
      const res = await invoke<{ approvalMode: string }>('agent.approval_mode.get', {});
      if (!cancelled && res.status === 'succeeded') setOwnMode(res.output.approvalMode);
    })();
    return () => {
      cancelled = true;
    };
  }, [approvalMode]);

  const id = gov?.agentIdentity;
  const voice = id?.voice.length ? id.voice.join(', ') : 'Workspace default (editable)';

  /**
   * The design's "Educational → Persuasive". The tone vector's four axes are
   * what actually exist (formal/casual, playful/serious, technical/plain,
   * bold/measured), and `voiceWords` has already reduced them to the ones the
   * sliders are decisive about — so the bias is the first two of those, which
   * reads the same way and is a real reading of the brand's own settings.
   */
  const toneBias = id?.voice.length
    ? id.voice.length > 1
      ? `${id.voice[0]} → ${id.voice[1]}`
      : (id.voice[0] as string)
    : 'Not set — the tone sliders are all mid';

  const rows: Array<{ label: string; value: string; title?: string }> = [
    { label: 'Brand Voice', value: voice, title: 'Derived from the tone sliders in Settings → Brand Kit.' },
    {
      label: 'Autonomy',
      value: (() => {
        const mode = approvalMode ?? ownMode;
        return mode ? (APPROVAL_LABEL[mode] ?? mode) : 'Reading…';
      })(),
      title:
        'The design labels this row "Primary Role", which nothing stores. This is the approval mode — what the agent may do without you — which is the closest real answer and the field the risk tolerance below is derived from.',
    },
    { label: 'Tone Bias', value: toneBias },
    {
      label: 'Risk Tolerance',
      value: id ? id.riskTolerance : '—',
      title: id ? `${id.riskTolerance} — ${id.riskBecause}.` : undefined,
    },
  ];

  const restricted = gov?.hardRules.length ?? 0;

  return (
    <ModalShell top={28} height={930} width={1164} label="Agent identity" gradientTo="#EAF9FE" onClose={onClose}>
      <div className="px-[48px] pt-[44px]">
        <p className="text-[28px] font-bold leading-[1.2] text-ink">Agent Identity — Ownership &amp; Personality</p>
        <p className="mt-[10px] text-[17px] font-normal text-ink-muted">
          A brief summary of an agent&rsquo;s distinct identity, showcasing their ownership and personality traits.
        </p>
      </div>

      {error ? (
        <p className="px-[48px] pt-[24px] text-16 font-medium text-ink-muted">{error}</p>
      ) : (
        <>
          {/* ── hero band ─────────────────────────────────────────────── */}
          <div className="px-[48px] pt-[34px]">
            <div className="relative flex items-center gap-[30px] rounded-[20px] py-[26px] pl-[150px] pr-[30px]" style={{ background: '#D9F1FA' }}>
              {/* The avatar overlaps the band's left edge, ringed twice — a
                  pale halo and a magenta hairline. */}
              <span
                aria-hidden
                className="absolute left-[-24px] top-1/2 flex h-[170px] w-[170px] -translate-y-1/2 items-center justify-center rounded-full"
                style={{ background: 'rgba(255,255,255,0.55)' }}
              >
                <span
                  className="flex h-[118px] w-[118px] items-center justify-center rounded-full bg-ink text-[38px] font-bold text-white"
                  style={{ boxShadow: '0 0 0 2px #F56BFF' }}
                >
                  {(id?.name ?? 'A').slice(0, 1).toUpperCase()}
                </span>
              </span>

              <div className="min-w-0">
                <p className="truncate text-[32px] font-bold leading-[1.2] text-ink">{id?.name ?? 'Loading…'}</p>

                <div className="mt-[10px] flex flex-wrap items-center gap-[12px]">
                  <span className="text-16 text-ink">Status</span>
                  <span className="flex h-[31px] items-center gap-[7px] rounded-full bg-white px-[13px]">
                    <span
                      className="block h-[11px] w-[11px] rounded-full"
                      style={{ background: paused ? '#F35525' : '#13D711' }}
                    />
                    <span className="text-14 text-ink">{paused ? 'Paused' : 'Active'}</span>
                  </span>
                </div>

                <div className="mt-[16px] flex flex-wrap items-center gap-x-[26px] gap-y-[10px]">
                  <span className="flex items-center gap-[9px] text-18 font-semibold" style={{ color: '#2F8291' }}>
                    <svg width="16" height="20" viewBox="0 0 16 20" fill="none" aria-hidden>
                      <circle cx="8" cy="4" r="4" fill="#2F8291" />
                      <path d="M16 15.5C16 18 16 20 8 20S0 18 0 15.5 3.6 11 8 11s8 2 8 4.5Z" fill="#2F8291" />
                    </svg>
                    {voice}
                  </span>

                  {id ? (
                    <span
                      className="flex items-center gap-[9px] text-18 font-medium"
                      style={{ color: '#8937D6' }}
                      title={`${id.riskTolerance} — ${id.riskBecause}.`}
                    >
                      <svg width="16" height="20" viewBox="0 0 16 20" fill="none" aria-hidden>
                        <path
                          d="M7.7.04c.21-.06.44-.05.64.03l7 2.75.14.07c.3.18.5.5.5.86v5.5c0 4.9-3.09 9.1-7.67 10.69a1 1 0 0 1-.66 0C3.09 18.35 0 14.15 0 9.25v-5.5l.01-.15c.05-.35.29-.65.62-.78l7-2.75.07-.03Z"
                          fill="#8937D6"
                        />
                      </svg>
                      Risk Tolerance: <b className="font-semibold">{id.riskTolerance}</b>
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {/* ── the two cards ─────────────────────────────────────────── */}
          <div className="flex flex-wrap gap-[32px] px-[48px] pt-[30px]">
            <div className={CARD} style={{ ...CARD_RING, flex: '1 1 380px' }}>
              <p className="px-[24px] py-[20px] text-[22px] font-bold text-ink">Identity Attributes</p>
              <div className="h-px w-full" style={{ background: 'rgba(131,131,131,0.16)' }} />
              <dl className="px-[24px] py-[20px]">
                {rows.map((r) => (
                  <div key={r.label} className="flex items-baseline gap-4 py-[11px]" title={r.title}>
                    <dt className="w-[150px] shrink-0 text-[17px] font-normal text-ink-muted">{r.label}:</dt>
                    <dd className="min-w-0 flex-1 text-[17px] font-medium text-ink">{r.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className={CARD} style={{ ...CARD_RING, flex: '1 1 380px' }}>
              <p className="px-[24px] py-[20px] text-[22px] font-bold text-ink">Avatar &amp; Voice</p>
              <div className="h-px w-full" style={{ background: 'rgba(131,131,131,0.16)' }} />
              <div className="px-[24px] py-[20px]">
                {/* `genome.avatar_config.set` is write-only — there is no read —
                    so this names where the setting lives instead of reporting a
                    source it cannot see. */}
                <p className="text-[17px] font-normal text-ink-muted">
                  Avatar source: set in Settings
                </p>
                <div className="mt-[14px] flex flex-wrap gap-[12px]">
                  <a
                    href="/settings/brand-kit"
                    className="flex h-[46px] items-center gap-[10px] rounded-xl px-[18px] text-[16px] font-semibold text-white"
                    style={{ background: 'linear-gradient(90deg, #C46BF5 0%, #A341FF 100%)' }}
                  >
                    <svg width="18" height="16" viewBox="0 0 20 18" fill="none" aria-hidden>
                      <path d="M5 12.5A3.5 3.5 0 0 1 5.5 5.6a5 5 0 0 1 9.2-1.1A4 4 0 0 1 15 12.5H5Z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
                      <path d="M10 15.5V8.5M7.6 10.6 10 8.2l2.4 2.4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Change Avatar
                  </a>
                  <a
                    href="/settings/brand-kit"
                    className="flex h-[46px] items-center gap-[10px] rounded-xl bg-white px-[18px] text-[16px] font-semibold text-ink"
                    style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)' }}
                  >
                    <svg width="17" height="17" viewBox="0 0 20 19" fill="none" aria-hidden>
                      <path d="M10 0.8 11.9 6.4 17.6 8.3 11.9 10.2 10 15.8 8.1 10.2 2.4 8.3 8.1 6.4Z" fill="#A341FF" />
                    </svg>
                    Generate Avatar
                  </a>
                </div>

                <p className="mt-[22px] text-[17px] font-normal text-ink-muted">Voice profile: set in Settings</p>
                <a
                  href="/settings/brand-kit"
                  className="mt-[14px] flex h-[46px] w-fit items-center gap-[10px] rounded-xl px-[18px] text-[16px] font-semibold text-ink"
                  style={{ background: '#9CEFFF' }}
                >
                  <svg width="18" height="16" viewBox="0 0 20 18" fill="none" aria-hidden>
                    <path d="M2 9h2.5M7 4v10M11 1.5v15M15 5.5v7M18.5 9H20" stroke="#0C0C0C" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  Manage Voice
                </a>
              </div>
            </div>
          </div>

          {/* ── governance ────────────────────────────────────────────── */}
          <div className="px-[48px] pb-[44px] pt-[34px]">
            <p className="flex items-center gap-[12px] text-[22px] font-bold text-ink">
              <svg width="20" height="24" viewBox="0 0 16 20" fill="none" aria-hidden>
                <path
                  d="M7.7.04c.21-.06.44-.05.64.03l7 2.75.14.07c.3.18.5.5.5.86v5.5c0 4.9-3.09 9.1-7.67 10.69a1 1 0 0 1-.66 0C3.09 18.35 0 14.15 0 9.25v-5.5l.01-.15c.05-.35.29-.65.62-.78l7-2.75.07-.03Z"
                  fill="#0C0C0C"
                />
              </svg>
              Governance &amp; Safeguards
            </p>

            <ul className="mt-[20px] flex flex-col gap-[16px]">
              {[
                {
                  label: 'Compliance filters active',
                  detail:
                    'guard.compliance runs on every draft, from the brand’s compliance profile — a regulated brand gets the stricter pass automatically.',
                },
                {
                  label:
                    restricted > 0
                      ? `Restricted topics enforced — ${restricted} rule${restricted === 1 ? '' : 's'}`
                      : 'Restricted topics — none set yet',
                  detail:
                    restricted > 0
                      ? 'Your hard rules, from Settings → Brand Kit. Every draft is checked against them before it can be scheduled.'
                      : 'No hard rules are set for this brand. Add them in Settings → Brand Kit and every draft will be checked against them.',
                  off: restricted === 0,
                },
                {
                  label: 'Brand safety guardrails ON',
                  detail:
                    'guard.brand_voice and guard.claim_grounding are part of the draft pipeline rather than a toggle — an ungrounded claim holds the post regardless of any setting.',
                },
              ].map((g) => (
                <li key={g.label} className="flex items-start gap-[14px]" title={g.detail}>
                  <span
                    className="mt-[2px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full"
                    style={{ background: g.off ? 'rgba(131,131,131,0.15)' : 'rgba(19,215,17,0.16)' }}
                  >
                    {g.off ? (
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                        <path d="M2.5 6h7" stroke="#838383" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg width="12" height="10" viewBox="0 0 13 11" fill="none" aria-hidden>
                        <path d="m1 5.5 3.6 3.6L12 1.5" stroke="#13A711" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className={`text-[18px] font-medium ${g.off ? 'text-ink-muted' : 'text-ink'}`}>{g.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </ModalShell>
  );
}
