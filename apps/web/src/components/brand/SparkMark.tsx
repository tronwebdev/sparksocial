import { cn } from '@/lib/utils';

/**
 * The SPARK "ghost face" mark, rebuilt from
 * `ui build/SparkSocial Dashboard.dc.html:31-43`.
 *
 * It is a stack of positioned circles behind a blurred visor, not an SVG or a
 * bitmap — so it stays crisp at every size and the colour blobs can animate later
 * (the prototype breathes them on the auth splash).
 *
 * The source is authored at 53.57px. Every offset below is expressed as a fraction
 * of that base and multiplied by `size`, which is why the mark can be dropped in at
 * the four sizes the prototype uses (148 on the auth panel, 91, 70.2, 53.57 in the
 * shell) without a second hand-tuned copy.
 */

const BASE = 53.57;

export interface SparkMarkProps {
  size?: number;
  className?: string;
  /** Animates the colour blobs — used on the auth splash, off in the shell. */
  animated?: boolean;
}

export function SparkMark({ size = BASE, className, animated = false }: SparkMarkProps) {
  const k = size / BASE;
  const px = (n: number) => `${n * k}px`;

  return (
    <div
      className={cn('relative shrink-0', className)}
      style={{ width: px(BASE), height: px(BASE) }}
      role="img"
      aria-label="SparkSocial"
    >
      {/* Outer ring + inner sheen */}
      <div
        className="absolute inset-0 rounded-full bg-white"
        style={{ boxShadow: `inset 0 0 0 ${px(2.68)} #000000` }}
      />
      <div
        className="absolute inset-0 rounded-full"
        style={{ background: '#FBFBFB', boxShadow: `inset 0 0 ${px(5.36)} ${px(-1.07)} #E9EFF5` }}
      />

      {/* Colour blobs, clipped by the face */}
      <div
        className="absolute overflow-hidden"
        style={{ left: px(9.38), top: px(11.16), width: px(35.08), height: px(31.52) }}
      >
        <span
          className={cn('absolute rounded-full', animated && 'animate-breathe motion-reduce:animate-none')}
          style={{ left: 0, top: px(8.3), width: px(15.8), height: px(15.8), background: '#F56BFF' }}
        />
        <span
          className={cn('absolute rounded-full', animated && 'animate-breathe motion-reduce:animate-none')}
          style={{ left: px(17.2), top: 0, width: px(15.8), height: px(15.8), background: '#A341FF' }}
        />
        <span
          className="absolute rounded-full"
          style={{ left: px(18.6), top: px(14.9), width: px(15.8), height: px(15.8), background: '#F56BFF' }}
        />
        <span
          className={cn('absolute rounded-full', animated && 'animate-breathe motion-reduce:animate-none')}
          style={{ left: px(6.7), top: px(0.7), width: px(12.9), height: px(12.9), background: '#6CE8FF' }}
        />
      </div>

      {/* Visor */}
      <div
        className="absolute"
        style={{
          left: px(10.68),
          top: px(19.83),
          width: px(32.71),
          height: px(13.26),
          borderRadius: px(9.9),
          background: 'rgba(255,255,255,0.07)',
          backdropFilter: `blur(${px(8.94)})`,
          WebkitBackdropFilter: `blur(${px(8.94)})`,
          boxShadow: `inset 0 0 ${px(4.98)} ${px(-0.88)} #6CE8FF`,
        }}
      />

      {/* Eyes */}
      <span
        className="absolute rounded-full bg-white"
        style={{ left: px(15.54), top: px(23.8), width: px(5.36), height: px(5.36) }}
      />
      <span
        className="absolute rounded-full bg-white"
        style={{ left: px(33.75), top: px(23.8), width: px(5.36), height: px(5.36) }}
      />
    </div>
  );
}
