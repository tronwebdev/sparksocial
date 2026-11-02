/**
 * The Draft Panel's form vocabulary, for the controls no `DP` prototype draws.
 *
 * Per-scene retiming, voice and preset pickers, dubbing, the variants and
 * repurpose tools, "Ask for a change" — real controls the prototypes leave out.
 * They were built from library defaults (`h-8 rounded border border-border
 * bg-input px-2 text-13`, a hard 1px outline at a 6px radius) and sat inside
 * a panel whose every drawn field is a white 10px-radius box in a soft grey
 * ring, so the undrawn half of the panel read as a different product.
 *
 * Values are the panel's own, taken from the prototypes' fields and cards:
 * the field is `DP video`'s brief box (white, r10, 1px grey ring at 30%), the
 * card is its scene card (grey at 5% in the same ring, r15).
 */
import type { CSSProperties } from 'react';

/** A text field or textarea. */
export const PANEL_FIELD =
  'rounded-[10px] bg-white px-[16px] py-[11px] text-16 font-medium text-ink outline-none ' +
  'shadow-[inset_0_0_0_1px_rgba(131,131,131,0.3)] placeholder:text-ink-placeholder ' +
  'focus:shadow-[0_0_0_2px_var(--ss-ring)] disabled:opacity-50';

/** A one-line field or select beside buttons — the `sm` button's 36px height. */
export const PANEL_FIELD_SM =
  'h-9 rounded-[9px] bg-white px-[12px] text-14 font-medium text-ink outline-none ' +
  'shadow-[inset_0_0_0_1px_rgba(131,131,131,0.3)] placeholder:text-ink-placeholder ' +
  'focus:shadow-[0_0_0_2px_var(--ss-ring)] disabled:opacity-50';

/** A tool's card: the scene card's ground and ring. */
export const PANEL_CARD = 'rounded-[15px] px-[24px] py-[20px]';
export const PANEL_CARD_STYLE: CSSProperties = {
  background: 'rgba(131,131,131,0.05)',
  boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.3)',
};

/** A card's title and its explanation — the panel's 18/500 heading and 15/500 grey body. */
export const PANEL_CARD_TITLE = 'text-18 font-medium text-ink';
export const PANEL_CARD_BODY = 'mt-[6px] text-15 font-medium text-ink-muted';
