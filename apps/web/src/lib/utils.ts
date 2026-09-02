import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * `tailwind-merge`, taught about the project's px-named type scale.
 *
 * ── Why this is not the default `twMerge` ─────────────────────────────────
 *
 * The scale is `text-13 … text-26` (see `tailwind.config.ts`). Stock
 * tailwind-merge decides what `text-*` means by validator: the `font-size` group
 * accepts t-shirt sizes (`text-sm`, `text-lg`) and arbitrary lengths
 * (`text-[18px]`), and `13`/`18`/`26` are none of those. The `text-color` group
 * accepts *anything*, so `text-18` falls through and is classified as a colour.
 *
 * That makes `cn('text-18', 'text-ink-muted')` a conflict between two "colours",
 * and the later one wins — so **the size is silently deleted from the class
 * string**. Not overridden in CSS, not invalid: absent. It was found by reading
 * `element.className` in the browser and seeing `text-18` simply not there,
 * while the utility existed in the stylesheet the whole time.
 *
 * Every component that sets a size and a colour together goes through `cn`, so
 * unconfigured this quietly removes the type scale from the entire project while
 * looking completely correct in source. Same failure mode as the `alpha()` bug
 * documented in `tailwind.config.ts`: it fails open.
 *
 * Keep this list in sync with `theme.extend.fontSize`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['13', '14', '16', '18', '20', '22', '26'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
