'use client';

import { cn } from '@/lib/utils';
import { ENGAGEMENT_LEVELS, ENGAGEMENT_TYPES, PLATFORMS, type EngagementAutonomy } from './types';

/**
 * Step 3 — `Settings WS EI Platforms`.
 *
 * ── One control with four states, not two controls with three ─────────────
 *
 * The stored row has both an `autonomy` and an `enabled` flag, and in the reply
 * gate they collapse: `enabled: false` and `autonomy: 'off'` both narrow to the
 * same "no". Drawing them as two controls would put a switch on this screen that
 * changes nothing you cannot already say with the other one — so the screen
 * offers one choice per platform, and `enabled: false` is simply how "don't
 * engage here" is stored.
 *
 * ── Why "Reply freely" is not one of the choices ──────────────────────────
 *
 * The prototype offers three: suggest replies, answer common questions, reply
 * freely. The first two are the two things the engine distinguishes. Nothing
 * behind the third exists — SPARK holds a message it is unsure about at every
 * level, and it would have to stop doing that for "freely" to mean anything. A
 * third button that behaved exactly like the second is worse than its absence,
 * because the owner would believe they had authorised something.
 *
 * ── An override narrows ───────────────────────────────────────────────────
 *
 * Every row starts on "Follow my default", which stores nothing at all. That is
 * why an existing brand's behaviour is untouched by this screen existing, and it
 * is why a platform can never be set *above* the brand's own answer.
 */

export interface PlatformDraft {
  platform: string;
  /** `inherit` stores no row. The other three are overrides. */
  choice: 'inherit' | 'off' | 'suggest' | 'auto';
  /** `null` inherits the brand's list; an array overrides it for this platform. */
  types: string[] | null;
}

const CHOICES = [
  { value: 'suggest', label: 'Suggest replies', hint: 'Drafts queue for approval; sensitive conversations escalate.' },
  { value: 'auto', label: 'Answer common questions', hint: 'Auto-replies to the safe ones; leads and risky messages come to you.' },
  { value: 'off', label: 'Don’t engage here', hint: 'SPARK reads this platform and says nothing on it.' },
] as const;

const AUTONOMY_WORD: Record<EngagementAutonomy, string> = {
  off: ENGAGEMENT_LEVELS[0].label,
  suggest: ENGAGEMENT_LEVELS[1].label,
  auto: ENGAGEMENT_LEVELS[2].label,
};

export function PlatformsStep({
  drafts,
  brandAutonomy,
  brandTypes,
  onChange,
}: {
  drafts: PlatformDraft[];
  brandAutonomy: EngagementAutonomy;
  brandTypes: string[];
  onChange: (platform: string, patch: Partial<PlatformDraft>) => void;
}) {
  return (
    <div>
      <p className="text-[13px] text-ink-muted">
        Where your default is not the right answer. A platform can be quieter than your default, never
        louder &mdash; step 1 is the ceiling.
      </p>

      <ul className="mt-4 grid grid-cols-1 gap-3">
        {PLATFORMS.map((p) => {
          const draft = drafts.find((d) => d.platform === p.value) ?? {
            platform: p.value,
            choice: 'inherit' as const,
            types: null,
          };
          const inheriting = draft.choice === 'inherit';
          const effectiveTypes = draft.types ?? brandTypes;
          const allTypes = effectiveTypes.length === 0;

          return (
            <li key={p.value} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[14px] font-medium text-ink">{p.label}</h3>
                {inheriting ? (
                  <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-ink-muted">
                    Following my default &middot; {AUTONOMY_WORD[brandAutonomy]}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onChange(p.value, { choice: 'inherit', types: null })}
                    className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-ink-muted transition-colors hover:bg-surface-muted"
                  >
                    Reset to my default
                  </button>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-ink-muted">
                Respond to activity from your connected {p.label} account.
              </p>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {CHOICES.map((c) => {
                  const on = draft.choice === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      aria-pressed={on}
                      title={c.hint}
                      onClick={() => onChange(p.value, { choice: c.value })}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-[13px] transition-colors',
                        on
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-ink-muted hover:bg-surface-muted',
                      )}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
              {!inheriting && (
                <p className="mt-2 text-[12px] text-ink-muted">
                  {CHOICES.find((c) => c.value === draft.choice)?.hint}
                </p>
              )}

              {/* Message types are a separate axis: a platform can be on
                  "suggest" for comments and silent in DMs. Hidden while the row
                  is silent, because there is nothing for it to qualify. */}
              {draft.choice !== 'off' && (
                <div className="mt-3">
                  <p className="text-[12px] font-medium text-ink-muted">
                    Message types{draft.types === null ? ' · following my default' : ''}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {ENGAGEMENT_TYPES.map((t) => {
                      const on = allTypes || effectiveTypes.includes(t.value);
                      return (
                        <button
                          key={t.value}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            const current = allTypes
                              ? ENGAGEMENT_TYPES.map((x) => x.value as string)
                              : [...effectiveTypes];
                            const next = current.includes(t.value)
                              ? current.filter((x) => x !== t.value)
                              : [...current, t.value];
                            /**
                             * All three selected goes back to inheriting rather
                             * than storing a list that happens to contain
                             * everything — the same rule step 1 uses, so the two
                             * screens do not disagree about what "all" means.
                             * Selecting types is itself an override, so a row on
                             * "Follow my default" is promoted to `suggest`
                             * rather than storing types nothing would read.
                             */
                            onChange(p.value, {
                              types: next.length === ENGAGEMENT_TYPES.length ? null : next,
                              ...(draft.choice === 'inherit' && next.length !== ENGAGEMENT_TYPES.length
                                ? { choice: 'suggest' as const }
                                : {}),
                            });
                          }}
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
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
