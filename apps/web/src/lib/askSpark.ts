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
