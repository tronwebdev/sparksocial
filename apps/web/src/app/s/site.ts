import type { Metadata } from 'next';
import type { PublicSite } from '@/components/site/AgencySite';

/**
 * Server-side reads for the agency websites (`app/s/...`). Both pages call the
 * API's public site endpoints server-to-server — the browser never sees the
 * API or Clerk — and inline the logo as a data URI for the same reason.
 */

export const API_URL = process.env.SPARK_API_URL ?? 'http://localhost:8080';

export async function loadSite(by: { slug: string } | { domain: string }): Promise<PublicSite | null> {
  const path =
    'slug' in by
      ? `/v1/public/sites/${encodeURIComponent(by.slug)}`
      : `/v1/public/sites/by-domain/${encodeURIComponent(by.domain)}`;
  try {
    const res = await fetch(`${API_URL}${path}`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return (await res.json()) as PublicSite;
  } catch {
    return null;
  }
}

/** The logo as a data URI, or undefined. Small images only — a logo, not a photo. */
export async function loadLogo(slug: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${API_URL}/v1/public/sites/${encodeURIComponent(slug)}/logo`, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return undefined;
    const type = res.headers.get('content-type') ?? 'image/png';
    if (!type.startsWith('image/')) return undefined;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > 1_500_000) return undefined;
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return undefined;
  }
}

export function siteMetadata(site: PublicSite | null): Metadata {
  if (!site) return { title: 'Site not found', robots: { index: false } };
  return {
    title: site.tagline ? `${site.name} — ${site.tagline}` : site.name,
    description: site.content.subheadline || site.tagline || undefined,
  };
}
