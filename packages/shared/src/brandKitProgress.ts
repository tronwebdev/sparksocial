/**
 * HOW FINISHED IS THIS BRAND KIT — the cockpit's setup chip (`DASH-B-01`, M1).
 *
 * Derived on read, never stored, for the same reason `agentIdentity` is: a
 * percentage kept in a column can disagree with the fields it claims to
 * summarise, and the first time it does, nobody trusts it again.
 *
 * ── Why these four, and not more ───────────────────────────────────────────
 *
 * Every step here is something the *renderer* uses. Colours and the logo reach
 * `resolveKit` at composition time; the voice sliders reach the copy writers; the
 * timezone decides when anything goes out at all. A checklist that also counted
 * fields nothing reads would be a progress bar measuring paperwork — and it would
 * stall at 80% for brands that were, in every way that shows up in a post,
 * finished.
 *
 * Fonts are the one obvious absence. `brands` has no font column yet (M4, and the
 * brand-kit-as-a-record decision of 22 August), so a font step here would be a
 * box nobody could tick. It joins the list when the column does.
 */

export interface BrandKitStep {
  /** Stable key, for a UI that wants to link straight at the field. */
  id: 'colors' | 'logo' | 'voice' | 'timezone';
  /** What the owner is being asked for, in their words. */
  label: string;
  done: boolean;
  /** Why it matters — shown against the steps still outstanding. */
  because: string;
}

export interface BrandKitProgress {
  steps: BrandKitStep[];
  /** How many are done. */
  completed: number;
  total: number;
  /** 0–100, rounded. The number on the chip. */
  pct: number;
  /**
   * The step to do next — the first one outstanding, or absent when the kit is
   * finished. One rather than a list, because a chip has room for one and an
   * owner acting on it does them one at a time.
   */
  next?: BrandKitStep;
}

/**
 * The timezone is `notNull` with a default, so "has one" cannot be tested by
 * presence. `UTC` is what a brand that never answered gets, which makes it the
 * honest sentinel for unanswered — at the cost of reading as unanswered for the
 * handful of brands genuinely in UTC. Overstating a brand's readiness is the
 * worse error: it publishes at the wrong hour and nothing on screen suggested
 * why.
 */
const UNSET_TIMEZONE = 'UTC';

export function brandKitProgress(gov: {
  brandColors?: string[];
  logoUrl?: string;
  toneVector?: { formal: number; playful: number; technical: number; bold: number };
  timezone?: string;
}): BrandKitProgress {
  const steps: BrandKitStep[] = [
    {
      id: 'colors',
      label: 'Brand colours',
      done: (gov.brandColors?.length ?? 0) > 0,
      because: 'posts render on default colours until this is set',
    },
    {
      id: 'logo',
      label: 'Logo',
      done: Boolean(gov.logoUrl),
      because: 'formats with a logo beat fall back to text without it',
    },
    {
      id: 'voice',
      label: 'Voice',
      done: Boolean(gov.toneVector),
      because: 'the copy writers have nothing to aim at, so captions read generically',
    },
    {
      id: 'timezone',
      label: 'Timezone',
      done: Boolean(gov.timezone) && gov.timezone !== UNSET_TIMEZONE,
      because: 'posts go out on UTC hours, which may be the middle of your night',
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);

  return {
    steps,
    completed,
    total: steps.length,
    pct: Math.round((completed / steps.length) * 100),
    ...(next ? { next } : {}),
  };
}
