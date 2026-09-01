import { cn } from '@/lib/utils';

/**
 * The SparkSocial mark — the project's logo export, served from
 * `public/brand/spark-mark.svg`.
 *
 * This used to be a CSS reconstruction: a stack of absolutely-positioned blurred
 * blobs behind a visor pill, with three hand-tuned variants. It reproduced the
 * asset closely (same `#F56BFF` / `#6CE8FF` / `#A341FF`), but a reconstruction is
 * a second source of truth for a logo, and the logo is the one thing in a product
 * that must never drift. The export is now authoritative everywhere the mark
 * appears.
 *
 * The variant names survive because eight call sites use them, and they were only
 * ever a size vocabulary in the first place — the export is a single artwork at
 * 91px, which is what `card` always was. Being vector, it scales to the other two
 * without a second file:
 *
 *   shell  53.57px   the app sidebar lockup
 *   card   91px      the auth card masthead — the export's own size
 *   hero   148px     the Meet Spark splash and Sign Up brand panel
 *
 * `size` overrides the variant when a screen measures something else.
 *
 * One known limitation: the export puts two blur layers in `foreignObject`
 * elements carrying `backdrop-filter`, and Chrome renders SVG-in-`<img>` in a
 * restricted static mode that skips `foreignObject`. Those layers only frost
 * whatever sits behind the mark, and at 91px the effect is subtle — but it is a
 * real difference from Figma, not a thing I chose. Everything that draws the mark
 * itself (the cyan disc, the four blobs, the visor, the two eyes) is ordinary SVG
 * and renders.
 */
const SIZES = { shell: 53.57, card: 91, hero: 148 } as const;

export interface SparkMarkProps {
  variant?: keyof typeof SIZES;
  /** Renders at this size instead of the variant's native one. */
  size?: number;
  className?: string;
  /** Breathes the mark, as the auth hero does. Off in the shell. */
  animated?: boolean;
}

export function SparkMark({ variant = 'shell', size, className, animated = false }: SparkMarkProps) {
  const px = size ?? SIZES[variant];
  return (
    <img
      src="/brand/spark-mark.svg"
      alt="SparkSocial"
      width={px}
      height={px}
      className={cn('shrink-0 select-none', animated && 'animate-breathe', className)}
      style={{ width: `${px}px`, height: `${px}px` }}
    />
  );
}
