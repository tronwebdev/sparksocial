'use client';

import { useEffect, useState } from 'react';

/**
 * "A post changed" — fired by the Draft Panel, heard by every list of posts.
 *
 * The Command Center's queue said "3 have no copy yet" after all three had
 * been drafted. The panel writes posts — it fills an empty slot on open,
 * drafts, regenerates, generates media — and the lists that show those posts
 * (the queue, the calendar grids, the drafts table) each read `content.list`
 * once and re-read only when their own `refreshKey` moved, which nothing on
 * the Command Center ever moved. The panel has no handle on whichever lists
 * happen to be mounted beside it, so it says what happened and they listen —
 * the same shape as `BRAND_CHANGED_EVENT`.
 */
export const CONTENT_CHANGED_EVENT = 'spark:content-changed';

/** Tell every mounted list that a post's copy, media, date or status may have changed. */
export function announceContentChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
}

/**
 * A number that goes up each time a post changes — add it to the effect that
 * reads `content.list`, beside `refreshKey`, and the list re-reads.
 */
export function useContentRevision(): number {
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const bump = () => setRev((n) => n + 1);
    window.addEventListener(CONTENT_CHANGED_EVENT, bump);
    return () => window.removeEventListener(CONTENT_CHANGED_EVENT, bump);
  }, []);
  return rev;
}
