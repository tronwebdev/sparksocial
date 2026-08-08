'use client';

import { Toaster as Sonner } from 'sonner';

/** Prototype toast: pinned bottom, near-black, 12px radius, 15px medium label. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      offset={34}
      toastOptions={{
        classNames: {
          toast: 'rounded-md bg-[--ss-ink-900] text-white shadow-overlay text-[15px] font-medium',
          description: 'text-white/70',
        },
      }}
    />
  );
}
