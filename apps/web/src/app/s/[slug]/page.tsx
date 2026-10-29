import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AgencySite } from '@/components/site/AgencySite';
import { sendSiteLead } from '../actions';
import { loadLogo, loadSite, siteMetadata } from '../site';

/**
 * An agency website by its slug — what `<slug>.sparkai.social` is rewritten to
 * by `middleware.ts`, and reachable directly at `/s/<slug>` on the app host.
 *
 * Public: no session, no providers, no auth SDK (see `app/p/[token]` for why
 * that matters). Only published sites resolve; anything else is a 404.
 */

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return siteMetadata(await loadSite({ slug: (await params).slug }));
}

export default async function SitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await loadSite({ slug });
  if (!site) notFound();
  const logo = site.hasLogo ? await loadLogo(site.slug) : undefined;
  return <AgencySite site={site} {...(logo ? { logo } : {})} sendLead={sendSiteLead.bind(null, site.slug)} />;
}
