/**
 * The consent popup's way home.
 *
 * Onboarding opens a platform's consent screen in a small window named
 * `OAUTH_POPUP_NAME`. The platform's callback sends that window to
 * `/settings/accounts?social=…`, which — opened in a 600px popup — is the whole
 * settings screen squeezed into a sign-in window. So the accounts page checks
 * whether it *is* that popup and, if so, posts the result to the window that
 * opened it and closes itself. Opened any other way (a tab, the same window),
 * it shows the result as normal.
 */

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
 * accounts page as a tab would, and onboarding re-reads on focus.
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
