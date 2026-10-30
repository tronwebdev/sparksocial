'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { attachMark, markSvg, moodLabel, type SparkMood } from './sparkMarkEngine';

export type { SparkMood } from './sparkMarkEngine';

/**
 * The SparkSocial mark — the one drawing of the logo, everywhere it appears.
 *
 * It used to be an `<img>` of `public/brand/spark-mark.svg`, and the app also
 * carried a dozen look-alikes: an eyeless orb on the sign-up panel, a separate
 * green success file, hand-built copies in onboarding, the campaign wizard and
 * Settings, a blue ball with dots in three page headers, grey outline faces in
 * the chat. Each was a little different. This is now the only one; the drawing
 * and its motion live in `sparkMarkEngine.ts` (see the moods there).
 *
 * It is alive: the face turns toward the cursor, blinks and glances, smiles on
 * hover and squishes on click, and `mood` changes how it feels — `success`,
 * `error`, `warning`, `thinking`, `asleep` — each with a reaction when it
 * arrives. The server renders the finished mark, so it is never blank before
 * the script runs, and reduced motion keeps the faces without the movement.
 *
 * Sizes: the variant names are the original size vocabulary,
 *
 *   shell  53.57px   the app sidebar lockup
 *   card   91px      the auth card masthead — the export's own size
 *   hero   148px     the Meet Spark splash and Sign Up brand panel
 *
 * and `size` overrides them. Below 48px the mark reacts and blinks but does not
 * follow the cursor or respond to hover, so a toast or a calendar cell does not
 * stare; `track` and `interactive` override that either way.
 */
const SIZES = { shell: 53.57, card: 91, hero: 148 } as const;

export interface SparkMarkProps {
  variant?: keyof typeof SIZES;
  /** Renders at this size instead of the variant's native one. */
  size?: number;
  mood?: SparkMood;
  /** Turn toward the cursor. Defaults to on at 48px and up. */
  track?: boolean;
  /** Smile on hover and squish on click. Defaults to on at 48px and up. */
  interactive?: boolean;
  /** Read out instead of the mood's own label. */
  label?: string;
  /** Hidden from assistive technology — when the text beside it already says it. */
  decorative?: boolean;
  className?: string;
}

export function SparkMark({
  variant = 'shell',
  size,
  mood = 'idle',
  track,
  interactive,
  label,
  decorative = false,
  className,
}: SparkMarkProps) {
  const px = size ?? SIZES[variant];
  const big = px >= 48;
  const follows = track ?? big;
  const responds = interactive ?? big;

  const rawId = useId();
  // Frozen at the first render: React would otherwise rewrite the markup — and
  // throw away the live drawing — whenever the mood changed. The engine moves
  // the drawing from there.
  const [markup] = useState(() => markSvg(`sm${rawId.replace(/[^a-zA-Z0-9]/g, '')}`, mood));
  const ref = useRef<HTMLSpanElement>(null);
  const handle = useRef<ReturnType<typeof attachMark> | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    handle.current = attachMark(ref.current, { size: px, mood, track: follows, interactive: responds });
    return () => {
      handle.current?.detach();
      handle.current = null;
    };
    // Attached once; the two effects below carry every later change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    handle.current?.setMood(mood);
  }, [mood]);
  useEffect(() => {
    handle.current?.setOptions({ size: px, track: follows, interactive: responds });
  }, [px, follows, responds]);

  return (
    <span
      ref={ref}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label ?? moodLabel(mood) })}
      className={cn('relative inline-block shrink-0 select-none leading-[0]', responds && 'cursor-pointer', className)}
      style={{ width: `${px}px`, height: `${px}px` }}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
