'use client';

import { cn } from '@/lib/utils';
import { EMOJI_LEVELS, TONE_AXES, type EmojiLevel, type EngagementTone } from './types';

/**
 * Step 4 — `Settings WS EI Voice`.
 *
 * ── Why "use my brand voice" is a real state and not a preset ─────────────
 *
 * Absent means the brand's `tone_vector`, which is what every reply used before
 * this screen existed. If choosing "recommended" wrote three sliders at 0.5, the
 * brand voice would be silently replaced by a neutral one and the recommended
 * option would be the destructive one. So the toggle clears the field instead.
 *
 * ── Three axes, not four ──────────────────────────────────────────────────
 *
 * The prototype's ends are formal↔casual, professional↔friendly, direct↔warm.
 * `tone_vector` has four different axes. They overlap without matching, so
 * mapping one onto the other would mean dropping an axis or inventing a
 * correspondence nobody chose.
 */
export function VoiceStep({
  tone,
  onTone,
  emoji,
  onEmoji,
}: {
  /** `undefined` is "use my brand voice", the recommended state. */
  tone: EngagementTone | undefined;
  onTone: (next: EngagementTone | undefined) => void;
  emoji: EmojiLevel;
  onEmoji: (v: EmojiLevel) => void;
}) {
  const custom = tone !== undefined;
  const values: EngagementTone = tone ?? { casual: 0.5, friendly: 0.5, warm: 0.5 };

  return (
    <div className="grid grid-cols-1 gap-7">
      <div>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            { on: !custom, label: 'Use my brand voice (recommended)', hint: 'Replies will follow your brand voice.' },
            { on: custom, label: 'Customize engagement voice', hint: 'A separate voice for conversations only.' },
          ].map((o) => (
            <li key={o.label}>
              <button
                type="button"
                aria-pressed={o.on}
                onClick={() =>
                  // Clearing rather than writing neutral sliders: see the note above.
                  onTone(o.label.startsWith('Use') ? undefined : { casual: 0.5, friendly: 0.5, warm: 0.5 })
                }
                className={cn(
                  'w-full rounded-lg border p-3 text-left transition-colors',
                  o.on ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-muted',
                )}
              >
                <span className="block text-[13px] font-medium text-ink">{o.label}</span>
                <span className="mt-0.5 block text-[12px] text-ink-muted">{o.hint}</span>
              </button>
            </li>
          ))}
        </ul>

        {custom && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {TONE_AXES.map((axis) => (
              <div key={axis.key}>
                <div className="flex items-baseline justify-between">
                  <label className="text-[13px] text-ink" htmlFor={`ei-tone-${axis.key}`}>
                    {axis.low} &ndash; {axis.high}
                  </label>
                  <span className="text-[12px] tabular-nums text-ink-muted">
                    {Math.round(values[axis.key] * 100)}%
                  </span>
                </div>
                <input
                  id={`ei-tone-${axis.key}`}
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(values[axis.key] * 100)}
                  onChange={(e) => onTone({ ...values, [axis.key]: Number(e.target.value) / 100 })}
                  className="mt-1 w-full accent-[--ss-primary]"
                />
                <div className="flex justify-between text-[11px] text-ink-muted">
                  <span>{axis.low}</span>
                  <span>{axis.high}</span>
                </div>
              </div>
            ))}
            {/* An axis left in the middle says nothing to the writer, and the
                screen should not imply otherwise. */}
            <p className="text-[12px] text-ink-muted sm:col-span-2">
              A slider left in the middle is not an instruction &mdash; only the ends change how replies
              read.
            </p>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-[14px] font-medium text-ink">Emoji</h3>
        <p className="mt-0.5 text-[12px] text-ink-muted">
          Stated either way. Left unsaid, a model reaches for them about half the time.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EMOJI_LEVELS.map((l) => (
            <button
              key={l.value}
              type="button"
              aria-pressed={emoji === l.value}
              onClick={() => onEmoji(l.value)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[13px] transition-colors',
                emoji === l.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-ink-muted hover:bg-surface-muted',
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
