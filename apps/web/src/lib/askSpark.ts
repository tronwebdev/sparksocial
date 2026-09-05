'use client';

/**
 * One way to open the shell's Ask Spark drawer from anywhere on the page.
 *
 * The drawer lives in `AskSpark`, in the sidebar, and holds its own `open` state.
 * The cockpit needs Ask Spark as a *primary action* in its header (`DASH-B-01`,
 * M1) — and the wrong way to do that is a second `ChatDrawer` mounted by the
 * page, which is the exact failure `AskSpark`'s own header warns about: two
 * independent conversations one keystroke apart, neither aware of the other.
 *
 * So the header button asks the existing drawer to open. A DOM event rather than
 * a React context because the two components are not in a parent/child
 * relationship and never will be — the drawer is shell furniture and the caller
 * is whatever page happens to want it. A provider wrapping the whole app to carry
 * one boolean would be more machinery for less reach.
 *
 * A caller on a screen with no listener (`/agents` suppresses the shell drawer in
 * favour of its own) simply gets nothing, which is the right outcome: that screen
 * has a conversation panel already open on it.
 */

const OPEN_EVENT = 'spark:ask-open';

export function openAskSpark(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

/** Returns a teardown, for `useEffect` to hand back. */
export function onAskSparkOpen(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(OPEN_EVENT, handler);
  return () => window.removeEventListener(OPEN_EVENT, handler);
}

/* ── Pinning ─────────────────────────────────────────────────────────────
 *
 * "Pin" on the drawer's header meant nothing — it was drawn because the design
 * draws it and disabled because there was no preference to store. There is a
 * right place to store it, though, and it is not the database: a pinned panel
 * is a property of *this browser*, not of the brand, and a schema column would
 * make one person's pin follow the whole team around.
 *
 * So it lives in `localStorage`, and it does two things:
 *
 *   1. The drawer stays open across navigation — every mounting site reads
 *      `isSparkPinned()` for its initial `open`, so walking from Discovery to
 *      the Calendar keeps the conversation on screen instead of closing it.
 *   2. Escape and the scrim stop closing it. A pin whose panel still vanished
 *      on the next keystroke would not be a pin.
 *
 * Wrapped in try/catch because a private window, cleared site data or a browser
 * set to block storage all throw on access rather than returning null, and a
 * drawer that cannot remember a pin must still open.
 */

const PIN_KEY = 'spark:ask-pinned';
const PIN_EVENT = 'spark:ask-pin-changed';

export function isSparkPinned(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PIN_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSparkPinned(pinned: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (pinned) window.localStorage.setItem(PIN_KEY, '1');
    else window.localStorage.removeItem(PIN_KEY);
  } catch {
    /* Unavailable storage is not a reason to refuse the toggle — the pin simply
       does not survive a reload, which is strictly better than an error. */
  }
  window.dispatchEvent(new CustomEvent(PIN_EVENT, { detail: pinned }));
}

/** Returns a teardown, for `useEffect` to hand back. */
export function onSparkPinChanged(handler: (pinned: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (e: Event) => handler(Boolean((e as CustomEvent<boolean>).detail));
  window.addEventListener(PIN_EVENT, listener);
  return () => window.removeEventListener(PIN_EVENT, listener);
}
