/**
 * The consent popup, and its way home.
 *
 * Any screen that connects an account mid-task — onboarding, a campaign's
 * account step, a recipe's account picker — opens the platform's consent
 * screen in a small window named `OAUTH_POPUP_NAME`. The platform's callback
 * sends that window to `/settings/accounts?social=…` (or `?canva=…`), which —
 * opened in a 600px popup — is the whole settings screen squeezed into a
 * sign-in window. So the accounts page checks whether it *is* that popup and,
 * if so, posts the result to the window that opened it and closes itself.
 * Opened any other way (a tab, the same window), it shows the result as normal.
 *
 * The campaign wizard and the recipe picker used to open a plain new tab with
 * `noopener`, which severed exactly the link this relies on: the consent
 * finished in a second tab that landed on Settings, and the campaign being
 * built was left behind in the first one with no sign anything had happened.
 */

import { useEffect, useRef } from 'react';
import { platformLabel } from './platforms';
import { notify } from './notify';

export const OAUTH_POPUP_NAME = 'spark-oauth';

export interface OAuthPopupResult {
  type: 'spark-oauth';
  social: 'connected' | 'denied' | 'failed';
  provider: string | null;
  reason: string | null;
}

/**
 * Hands the result to the opener and closes. Returns false when there is no
 * opener of ours to hand it to.
 *
 * Decided by the opener, not by `window.name`: browsers may clear a window's
 * name when it navigates across sites, which the trip through a platform's
 * consent page does. Reading `opener.location.origin` throws for a
 * cross-origin opener, so only a window this app opened passes. Some consent
 * pages sever the opener entirely; then this returns false, the popup shows the
 * accounts page as a tab would, and the opener re-reads on focus.
 */
export function handBackToOpener(result: Omit<OAuthPopupResult, 'type'>): boolean {
  if (typeof window === 'undefined' || !window.opener || window.opener === window) return false;
  try {
    const opener = window.opener as Window;
    if (opener.location.origin !== window.location.origin) return false;
    opener.postMessage({ type: 'spark-oauth', ...result } satisfies OAuthPopupResult, window.location.origin);
  } catch {
    return false;
  }
  window.close();
  return true;
}

/** Centred over the current window, at a size every consent page fits. */
function popupFeatures(): string {
  const w = 600;
  const h = 760;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
  return `width=${w},height=${h},left=${left},top=${top}`;
}

/**
 * Open a consent screen in the popup, from a click.
 *
 * The window is opened *first*, empty, and pointed at the consent page once
 * the authorize URL comes back. Browsers only allow a popup during the click
 * that asked for it, and fetching the URL is a network round trip — open the
 * window after it and a slow response turns the popup into a blocked one.
 *
 * `getUrl` returns `null` when the request failed (the caller has already said
 * why); the empty window is closed rather than left behind.
 */
export async function openConsentPopup(getUrl: () => Promise<string | null>): Promise<'opened' | 'blocked' | 'failed'> {
  const win = window.open('', OAUTH_POPUP_NAME, popupFeatures());
  if (win) {
    try {
      win.document.title = 'Connecting…';
      win.document.body.innerHTML =
        '<p style="font:15px system-ui,sans-serif;color:#838383;padding:28px">Opening the sign-in page…</p>';
    } catch {
      /* a window of that name already showing another origin — it is navigated below anyway */
    }
  }

  const url = await getUrl();
  if (!url) {
    win?.close();
    return 'failed';
  }
  if (!win || win.closed) {
    notify.warning('Your browser blocked the sign-in window', {
      body: 'Allow pop-ups for this site, then try again. Nothing you have entered here is lost.',
    });
    return 'blocked';
  }
  win.location.href = url;
  win.focus();
  return 'opened';
}

/**
 * Listen for the popup's result, say how it went, and hand it to `onResult`.
 *
 * Also re-runs `onResult` with no result when this window regains focus: a
 * consent page that cut the opener link cannot post back, and coming back to
 * this window is then the only signal there is.
 */
export function useConsentPopupResult(onResult: (result: OAuthPopupResult | null) => void, active = true): void {
  const handler = useRef(onResult);
  handler.current = onResult;

  useEffect(() => {
    if (!active) return;
    const onMessage = (e: MessageEvent<OAuthPopupResult>) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'spark-oauth') return;
      const label = e.data.provider ? platformLabel(e.data.provider) : 'The platform';
      if (e.data.social === 'connected') notify.success(`${label} connected`);
      else if (e.data.social === 'denied') notify.info(`${label} connection cancelled`, { body: 'Nothing was connected.' });
      else notify.error(`Couldn’t connect ${label}`, { body: 'The connection did not go through. Try again.' });
      handler.current(e.data);
    };
    const onFocus = () => handler.current(null);
    window.addEventListener('message', onMessage);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('focus', onFocus);
    };
  }, [active]);
}
