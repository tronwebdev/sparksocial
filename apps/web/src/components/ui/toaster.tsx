'use client';

import { Toaster as Sonner } from 'sonner';
import { SparkMark } from '@/components/brand/SparkMark';

/**
 * Prototype toast: pinned bottom, near-black, 12px radius, 15px medium label.
 *
 * `SparkSocial Command Center.dc.html:1049` — `#0C0C0C`, white 15px/500,
 * `padding:13px 22px`, `border-radius:12px`, `0 12px 32px -8px rgba(0,0,0,0.4)`,
 * sized to its text and centred 34px off the bottom.
 *
 * `unstyled`, because the classes alone never applied: Sonner's own
 * `[data-styled=true]` rule outranks a utility class, so every toast came out
 * white, 13px, radius 8, 356 wide — its default, not the design's. Nothing
 * called `toast()` until the Command Center's actions did, which is why it
 * went unnoticed.
 *
 * ── SPARK says it ─────────────────────────────────────────────────────────
 *
 * A typed toast carries the mark in the matching mood: `toast.success` jumps,
 * `toast.error` shakes its head, `toast.warning` pops with its "!", and
 * `toast.loading` thinks. A plain `toast()` stays text only. The mark sits in
 * the left padding, so a toast with one is the same height as one without.
 */
const ICON = 32;

export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      offset={34}
      icons={{
        success: <SparkMark size={ICON} mood="success" decorative />,
        error: <SparkMark size={ICON} mood="error" decorative />,
        warning: <SparkMark size={ICON} mood="warning" decorative />,
        info: <SparkMark size={ICON} mood="idle" decorative />,
        loading: <SparkMark size={ICON} mood="thinking" decorative />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'inset-x-0 mx-auto flex w-max max-w-[calc(100vw-32px)] items-center gap-[10px] rounded-[12px] bg-[--ss-ink-900] px-[22px] py-[13px] text-15 font-medium text-white shadow-[0_12px_32px_-8px_rgba(0,0,0,0.4)] has-[[data-icon]]:pl-[10px]',
          icon: 'flex shrink-0 items-center my-[-8px]',
          description: 'text-white/70',
        },
      }}
    />
  );
}
