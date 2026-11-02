'use client';

import { Fragment, useEffect, useState } from 'react';

/**
 * The event the brand switcher fires after it has written the new
 * `spark_genome` cookie.
 */
export const BRAND_CHANGED_EVENT = 'spark:brand-changed';

/** Tell every mounted screen the selected brand has changed. */
export function announceBrandChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(BRAND_CHANGED_EVENT));
}

/**
 * Remounts the signed-in screen when the selected brand changes.
 *
 * Switching brands used to show the old brand's data until a reload. The
 * switcher wrote the cookie and called `router.refresh()`, which re-renders
 * server components only. Every panel here is a client component that resolves
 * its brand once, on mount, through `useSelectedGenome` — and nothing remounted
 * them, so the header said one brand while the page kept showing another.
 *
 * Keying the subtree does what the reload did, without the reload: each panel
 * mounts again, reads the new cookie, and fetches for the new brand. It also
 * drops state that belonged to the old one — an open draft, a half-filled
 * form — which is the point; carrying it across would mean acting on brand A's
 * post with brand B selected, which the API would refuse anyway.
 */
export function BrandScope({ children }: { children: React.ReactNode }) {
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const bump = () => setEpoch((n) => n + 1);
    window.addEventListener(BRAND_CHANGED_EVENT, bump);
    return () => window.removeEventListener(BRAND_CHANGED_EVENT, bump);
  }, []);
  return <Fragment key={epoch}>{children}</Fragment>;
}
