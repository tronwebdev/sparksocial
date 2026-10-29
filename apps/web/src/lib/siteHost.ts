/**
 * Which agency website, if any, a request's host is for.
 *
 *   app.sparkai.social, sparksocial-web.onrender.com, localhost  → the app
 *   northside.sparkai.social                                      → slug `northside`
 *   northside.localhost (development)                             → slug `northside`
 *   youragency.com                                                → custom domain
 *
 * The root comes from `SITE_ROOT_DOMAIN` (default `sparkai.social`). Anything
 * that is plainly infrastructure — an IP literal (Render's health checks), an
 * `onrender.com` host, the root itself or one of the product's own subdomains
 * — is the app, so a misclassified host can only ever fail toward the app
 * rather than toward a 404 site page.
 */

const ROOT = (process.env.SITE_ROOT_DOMAIN ?? 'sparkai.social').toLowerCase();

/** Subdomains the product uses itself. Kept in step with `RESERVED` in `packages/agency/src/agencySite.ts`. */
const APP_LABELS = new Set(['app', 'www', 'api', 'admin', 'mail', 'email', 'status', 'docs', 'help', 'support', 'blog', 'sites', 'static', 'cdn', 'staging', 'dev', 'test']);

/** Extra hosts that are the app (`APP_HOSTS`, comma-separated) — for a new app domain before this file knows it. */
const APP_HOSTS = new Set(
  (process.env.APP_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

const LABEL = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export function siteForHost(rawHost: string | null | undefined): { slug: string } | { domain: string } | null {
  const host = (rawHost ?? '').split(',')[0]!.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || /^[\d.]+$/.test(host) || host.startsWith('[')) return null;
  if (host.endsWith('.onrender.com') || APP_HOSTS.has(host)) return null;

  for (const root of [ROOT, 'localhost']) {
    if (host === root) return null;
    if (host.endsWith(`.${root}`)) {
      const label = host.slice(0, -(root.length + 1));
      return LABEL.test(label) && !APP_LABELS.has(label) ? { slug: label } : null;
    }
  }

  /* No dot means an internal name (a container, a service alias) — the app. */
  if (!host.includes('.')) return null;
  return { domain: host };
}
