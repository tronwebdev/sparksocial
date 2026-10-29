import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AgencySite } from '@/components/site/AgencySite';
import { sendSiteLead } from '../../actions';
import { loadLogo, loadSite, siteMetadata } from '../../site';

/**
 * An agency website by its custom domain. `middleware.ts` rewrites a request
 * for a bound domain (`youragency.com`) here; the API finds the site by host.
 * `by-domain` is a reserved slug, so no agency can take this path.
 */

export async function generateMetadata({ params }: { params: Promise<{ domain: string }> }): Promise<Metadata> {
  return siteMetadata(await loadSite({ domain: decodeURIComponent((await params).domain) }));
}

export default async function SiteByDomainPage({ params }: { params: Promise<{ domain: string }> }) {
  const domain = decodeURIComponent((await params).domain);
  const site = await loadSite({ domain });
  if (!site) notFound();
  const logo = site.hasLogo ? await loadLogo(site.slug) : undefined;
  return <AgencySite site={site} {...(logo ? { logo } : {})} sendLead={sendSiteLead.bind(null, site.slug)} />;
}
