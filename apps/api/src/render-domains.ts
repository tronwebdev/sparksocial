import type { DomainProvider } from '@sparksocial/agency';

/**
 * Custom domains on the Render web service, behind `agency.domain.*`.
 *
 * Every agency website is served by the one web service, so binding
 * `youragency.com` means adding it to that service's custom domains — Render
 * then issues and renews the certificate. Registered only when all three
 * settings are in the env group (`RENDER_API_KEY`, `RENDER_WEB_SERVICE_ID`,
 * `SITE_CNAME_TARGET`); without them the domain tools are absent and the
 * wizard says custom domains are not set up, rather than failing at call time.
 *
 * Note the bill: Render counts custom domains per workspace (15 on Pro, then
 * $0.25 a month each), and every agency that connects one adds to it.
 */

const API = 'https://api.render.com/v1';
const TIMEOUT_MS = 15_000;

interface RenderDomain {
  name: string;
  domainType: 'apex' | 'subdomain';
  verificationStatus: 'verified' | 'unverified';
}

export function renderDomainProvider(opts: {
  apiKey: string;
  serviceId: string;
  cnameTarget: string;
  fetchImpl?: typeof fetch;
}): DomainProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = `${API}/services/${encodeURIComponent(opts.serviceId)}/custom-domains`;

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    return doFetch(`${base}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${opts.apiKey}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  async function get(domain: string): Promise<RenderDomain | undefined> {
    const res = await call(`/${encodeURIComponent(domain)}`);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`Render answered ${res.status}`);
    return (await res.json()) as RenderDomain;
  }

  const shape = (d: RenderDomain) => ({ domainType: d.domainType, verified: d.verificationStatus === 'verified' });

  return {
    cnameTarget: opts.cnameTarget,

    async add(domain) {
      const res = await call('', { method: 'POST', body: JSON.stringify({ name: domain }) });
      /* Already on the service (a retry, or a second press): read it back. */
      if (res.status === 409) {
        const existing = await get(domain);
        if (existing) return shape(existing);
      }
      if (!res.ok) throw new Error(`Render answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const created = (await res.json()) as RenderDomain[] | RenderDomain;
      const mine = (Array.isArray(created) ? created : [created]).find((d) => d.name === domain);
      if (!mine) throw new Error('Render did not return the domain it was asked to add');
      return shape(mine);
    },

    async status(domain) {
      /* Ask Render to re-check DNS first; a failure there still leaves the last known state worth reading. */
      await call(`/${encodeURIComponent(domain)}/verify`, { method: 'POST' }).catch(() => undefined);
      const d = await get(domain);
      return d ? shape(d) : undefined;
    },

    async remove(domain) {
      const res = await call(`/${encodeURIComponent(domain)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`Render answered ${res.status}`);
    },
  };
}
