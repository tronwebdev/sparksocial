import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { ScopedDb } from '@sparksocial/tools/defineTool';
import { publicSiteView } from '@sparksocial/agency';
import { leadDedupeKey } from '@sparksocial/shared/agencyPipeline';
import { createLimiter } from './public-proposal.js';

/**
 * The agency websites' public surface — what `<slug>.sparkai.social` and a
 * bound custom domain are rendered from.
 *
 *   GET  /v1/public/sites/:slug              the page's data
 *   GET  /v1/public/sites/by-domain/:domain  the same, found by host
 *   GET  /v1/public/sites/:slug/logo         the agency's logo bytes
 *   POST /v1/public/sites/:slug/leads        the contact form
 *
 * ── Why these are not tools ───────────────────────────────────────────────
 *
 * Same reason as `public-proposal.ts`: a website visitor has no session, no
 * org and no role, and a tool registry with an unauthenticated tool in it would
 * have its whole scope model resting on the proxy never being made public. So
 * this is a deliberately narrow non-tool surface. The reads return an
 * allow-listed projection (`publicSiteView`); the one write can only create an
 * `inbound` lead on the org the site belongs to.
 *
 * ── The org id never leaves ───────────────────────────────────────────────
 *
 * Every lookup starts from a slug or a host. The logo is fetched server-side
 * and its bytes returned, because Clerk's image URL base64-embeds the org id —
 * the reason `public-proposal.ts` dropped the logo altogether.
 *
 * ── The contact form ──────────────────────────────────────────────────────
 *
 * Rate-limited per visitor and per site, with a honeypot field a person never
 * sees. A submission matching a lead the agency already has answers exactly as
 * a new one does, so the form cannot be used to test who is in a pipeline.
 */

export interface PublicSiteDeps {
  db: ScopedDb;
  /** The agency logo for an org, as bytes, or undefined if it has none. */
  resolveLogo?: (orgId: string) => Promise<{ contentType: string; bytes: ArrayBuffer } | undefined>;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const LeadForm = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(320),
  phone: z.string().trim().max(50).optional(),
  company: z.string().trim().max(200).optional(),
  message: z.string().trim().max(2000).optional(),
  /** The honeypot. Hidden from people; a bot that fills every field fills this. */
  website: z.string().max(500).optional(),
});

const ipOf = (c: Context) => (c.req.header('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'unknown';

const HEADERS = { 'cache-control': 'public, max-age=60', 'x-content-type-options': 'nosniff' };

export function registerPublicSites(app: Hono, deps: PublicSiteDeps): void {
  const readLimit = createLimiter({ max: 120, windowMs: 60_000 });
  /* A person fills a form once; five a ten minutes from one address is generous. */
  const formByIp = createLimiter({ max: 5, windowMs: 10 * 60_000 });
  const formBySite = createLimiter({ max: 60, windowMs: 60 * 60_000 });
  const logoCache = new Map<string, { at: number; value: { contentType: string; bytes: ArrayBuffer } | undefined }>();

  async function load(by: { slug: string } | { domain: string }) {
    const site = await deps.db.agencySites.findPublished(by);
    if (!site) return undefined;
    const profile = await deps.db.agencyProfiles.get(site.orgId);
    return { site, view: publicSiteView(site, profile?.profile) };
  }

  async function logoFor(orgId: string) {
    if (!deps.resolveLogo) return undefined;
    const hit = logoCache.get(orgId);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
    const value = await deps.resolveLogo(orgId).catch(() => undefined);
    logoCache.set(orgId, { at: Date.now(), value });
    return value;
  }

  const notFound = (c: Context) => c.json({ error: 'No site here.' }, 404, { 'cache-control': 'no-store' });
  const limited = (c: Context) => c.json({ error: 'Too many requests.' }, 429, { 'retry-after': '60' });

  async function respond(c: Context, by: { slug: string } | { domain: string }) {
    if (!readLimit(ipOf(c))) return limited(c);
    const found = await load(by);
    if (!found) return notFound(c);
    const hasLogo = Boolean(await logoFor(found.site.orgId));
    return c.json({ ...found.view, hasLogo }, 200, HEADERS);
  }

  app.get('/v1/public/sites/by-domain/:domain', (c) => {
    const domain = c.req.param('domain').toLowerCase();
    return DOMAIN_RE.test(domain) ? respond(c, { domain }) : notFound(c);
  });

  app.get('/v1/public/sites/:slug', (c) => {
    const slug = c.req.param('slug');
    return SLUG_RE.test(slug) ? respond(c, { slug }) : notFound(c);
  });

  app.get('/v1/public/sites/:slug/logo', async (c) => {
    const slug = c.req.param('slug');
    if (!SLUG_RE.test(slug) || !readLimit(ipOf(c))) return notFound(c);
    const site = await deps.db.agencySites.findPublished({ slug });
    if (!site) return notFound(c);
    const logo = await logoFor(site.orgId);
    if (!logo) return notFound(c);
    return c.body(logo.bytes, 200, { ...HEADERS, 'content-type': logo.contentType, 'cache-control': 'public, max-age=600' });
  });

  app.post('/v1/public/sites/:slug/leads', async (c) => {
    const slug = c.req.param('slug');
    if (!SLUG_RE.test(slug)) return notFound(c);
    if (!formByIp(ipOf(c)) || !formBySite(slug)) return limited(c);

    const parsed = LeadForm.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Please give your name and a valid email address.' }, 400, { 'cache-control': 'no-store' });
    }
    const ok = () => c.json({ ok: true }, 200, { 'cache-control': 'no-store' });
    /* A filled honeypot gets the same answer as a real submission, and nothing is written. */
    if (parsed.data.website) return ok();

    const site = await deps.db.agencySites.findPublished({ slug });
    if (!site) return notFound(c);

    const f = parsed.data;
    const fields = {
      businessName: f.company || f.name,
      contactName: f.name,
      email: f.email,
      ...(f.phone ? { phone: f.phone } : {}),
      ...(f.message ? { interest: f.message } : {}),
      notes: 'Sent from the agency website’s contact form.',
    };
    const dedupeKey = leadDedupeKey(fields);
    const existing = await deps.db.leads.getByDedupeKey({ orgId: site.orgId, dedupeKey });
    if (!existing) {
      await deps.db.leads.create({ ...fields, orgId: site.orgId, source: 'inbound', dedupeKey, createdBy: 'website' });
    }
    return ok();
  });
}
