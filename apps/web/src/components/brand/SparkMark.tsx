import { cn } from '@/lib/utils';

/**
 * The SPARK "ghost face" — a stack of positioned circles behind a blurred visor,
 * not an SVG or a bitmap, so it stays crisp at any size and the blobs can animate.
 *
 * There are three *distinct artworks* in the prototype, not one scaled three ways:
 * the shell logo (53.57px), the auth card (91px) and the auth hero (148px) each
 * use different internal proportions — the hero's blobs sit at 24% of the face
 * where the shell's sit at 30%, and only the two auth variants carry the
 * full-face blur wash. Scaling one to cover all three visibly distorts it, so each
 * is a spec here, transcribed from its own source block.
 *
 * Sources: `Dashboard.dc.html:31-43`, `Auth.dc.html:37-48` (hero) and
 * `Auth.dc.html:96-107` (card).
 */

interface Blob {
  left: number;
  top: number;
  size: number;
  color: string;
}

interface MarkSpec {
  base: number;
  ring: number;
  inner: { left: number; top: number; width: number; height: number };
  blobs: Blob[];
  /** The auth variants add a wash over the whole face; the shell logo does not. */
  wash?: { background: string; blur: number; inset: string };
  visor: { left: number; top: number; width: number; height: number; radius: number; blur: number; inset: string };
  eyes: { left: number; right: number; top: number; size: number };
}

const PINK = '#F56BFF';
const PURPLE = '#A341FF';
const CYAN = '#6CE8FF';

const SPECS: Record<'shell' | 'card' | 'hero', MarkSpec> = {
  shell: {
    base: 53.57,
    ring: 2.68,
    inner: { left: 9.38, top: 11.16, width: 35.08, height: 31.52 },
    blobs: [
      { left: 0, top: 8.3, size: 15.8, color: PINK },
      { left: 17.2, top: 0, size: 15.8, color: PURPLE },
      { left: 18.6, top: 14.9, size: 15.8, color: PINK },
      { left: 6.7, top: 0.7, size: 12.9, color: CYAN },
    ],
    visor: { left: 10.68, top: 19.83, width: 32.71, height: 13.26, radius: 9.9, blur: 8.94, inset: `inset 0 0 4.98px -0.88px ${CYAN}` },
    eyes: { left: 15.54, right: 33.75, top: 23.8, size: 5.36 },
  },
  card: {
    base: 91,
    ring: 4.5,
    inner: { left: 18.6, top: 25, width: 54.1, height: 48.6 },
    blobs: [
      { left: 0, top: 13, size: 24.4, color: PINK },
      { left: 27, top: 0, size: 24.4, color: PURPLE },
      { left: 29, top: 23, size: 24.4, color: PINK },
      { left: 10, top: 1, size: 20, color: CYAN },
    ],
    wash: { background: 'rgba(108,232,255,0.2)', blur: 43.6, inset: 'inset 0 0 13.9px 5px rgba(255,255,255,0.84)' },
    visor: { left: 18.1, top: 33.7, width: 55.5, height: 22.5, radius: 16.8, blur: 15.2, inset: `inset 0 0 8.5px -1.5px ${CYAN}` },
    eyes: { left: 26.4, right: 57.3, top: 40.4, size: 9.1 },
  },
  hero: {
    base: 148,
    ring: 7.4,
    inner: { left: 35, top: 41, width: 80, height: 72 },
    blobs: [
      { left: 0, top: 20, size: 36, color: PINK },
      { left: 40, top: 0, size: 36, color: PURPLE },
      { left: 44, top: 34, size: 36, color: PINK },
      { left: 16, top: 2, size: 30, color: CYAN },
    ],
    wash: { background: 'rgba(255,255,255,0.01)', blur: 48.7, inset: 'inset 0 0 14.8px -3px rgba(108,232,255,0.16)' },
    visor: { left: 29.4, top: 54.7, width: 90.1, height: 36.6, radius: 69, blur: 24.6, inset: `inset 0 0 13.7px -2.4px ${CYAN}` },
    eyes: { left: 42.8, right: 93.6, top: 65.6, size: 14.8 },
  },
};

export interface SparkMarkProps {
  variant?: keyof typeof SPECS;
  /** Renders at this size instead of the variant's native one, scaled uniformly. */
  size?: number;
  className?: string;
  /** Breathes the visor, as the auth hero does. Off in the shell. */
  animated?: boolean;
}

export function SparkMark({ variant = 'shell', size, className, animated = false }: SparkMarkProps) {
  const spec = SPECS[variant];
  const k = (size ?? spec.base) / spec.base;
  const px = (n: number) => `${n * k}px`;

  return (
    <div
      className={cn('relative shrink-0', className)}
      style={{ width: px(spec.base), height: px(spec.base) }}
      role="img"
      aria-label="SparkSocial"
    >
      <div className="absolute inset-0 rounded-full bg-white" style={{ boxShadow: `inset 0 0 0 ${px(spec.ring)} #000` }} />

      <div
        className="absolute overflow-hidden"
        style={{ left: px(spec.inner.left), top: px(spec.inner.top), width: px(spec.inner.width), height: px(spec.inner.height) }}
      >
        {spec.blobs.map((b, i) => (
          <span
            key={i}
            className="absolute rounded-full"
            style={{ left: px(b.left), top: px(b.top), width: px(b.size), height: px(b.size), background: b.color }}
          />
        ))}
      </div>

      {spec.wash ? (
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: spec.wash.background,
            backdropFilter: `blur(${px(spec.wash.blur)})`,
            WebkitBackdropFilter: `blur(${px(spec.wash.blur)})`,
            boxShadow: spec.wash.inset,
          }}
        />
      ) : null}

      <div
        className={cn('absolute', animated && 'animate-breathe motion-reduce:animate-none')}
        style={{
          left: px(spec.visor.left),
          top: px(spec.visor.top),
          width: px(spec.visor.width),
          height: px(spec.visor.height),
          borderRadius: px(spec.visor.radius),
          background: 'rgba(255,255,255,0.07)',
          backdropFilter: `blur(${px(spec.visor.blur)})`,
          WebkitBackdropFilter: `blur(${px(spec.visor.blur)})`,
          boxShadow: spec.visor.inset,
        }}
      />

      {[spec.eyes.left, spec.eyes.right].map((x) => (
        <span
          key={x}
          className="absolute rounded-full bg-white"
          style={{ left: px(x), top: px(spec.eyes.top), width: px(spec.eyes.size), height: px(spec.eyes.size) }}
        />
      ))}
    </div>
  );
}
