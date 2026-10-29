import { z } from 'zod';
import { defineTool, type ToolCtx } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import { readStoredProfile, type AgencyProfile } from './agencyProfile.js';

/**
 * `agency.site.*` and `agency.domain.*` — the agency's own website.
 *
 * ── What it is ────────────────────────────────────────────────────────────
 *
 * One page per agency, written by a model from the launch wizard's answers and
 * served from `<slug>.<sites root>` (`northside.sparkai.social`), or from a
 * domain the agency owns once it is bound. The wizard's layout, template, font
 * and colours style it; the copy is editable. Its contact form adds the visitor
 * to the agency's own pipeline as an `inbound` lead.
 *
 * ── Who decides ───────────────────────────────────────────────────────────
 *
 * Every write here is `human_only`. A website is public speech on the agency's
 * behalf, and a domain binding is a change at a third party (Render) that a
 * person must also make at their registrar — neither is something SPARK should
 * do unprompted.
 *
 * ── What is public ────────────────────────────────────────────────────────
 *
 * Only what `publicSiteView` projects: the profile's name, tagline, contact
 * email and phone, styling, and this copy. Never the org id — the public route
 * looks the site up by slug or host and hands back the allow-list, nothing more.
 */

/* ── content ──────────────────────────────────────────────────────────── */

export const SiteContent = z.object({
  headline: z.string().trim().min(1).max(120),
  subheadline: z.string().trim().max(280),
  services: z
    .array(z.object({ title: z.string().trim().min(1).max(60), description: z.string().trim().max(240) }))
    .min(1)
    .max(6),
  about: z.string().trim().max(1200),
  ctaLabel: z.string().trim().min(1).max(40),
  contactHeading: z.string().trim().max(120),
});
export type SiteContent = z.infer<typeof SiteContent>;

/** Lower-case letters, digits and single hyphens, 3–40 long — a DNS label. */
export const SiteSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, 'Use 3–40 letters, numbers or hyphens.')
  .refine((s) => !s.includes('--'), 'Use single hyphens.');

/** Subdomains the product itself uses; an agency cannot take them. */
const RESERVED = new Set(['app', 'www', 'api', 'admin', 'mail', 'email', 'status', 'docs', 'help', 'support', 'blog', 'sites', 'static', 'cdn', 'staging', 'dev', 'test', 'by-domain']);

export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return s.length >= 3 ? s : `${s || 'agency'}-site`.slice(0, 40);
}

async function freeSlug(base: string, ctx: ToolCtx): Promise<string> {
  for (let i = 1; i < 50; i++) {
    const candidate = i === 1 ? base : `${base.slice(0, 36)}-${i}`;
    if (RESERVED.has(candidate)) continue;
    if (!(await ctx.db.agencySites.slugTaken(candidate, ctx.orgId))) return candidate;
  }
  throw new ToolError('INVALID_INPUT', 'Could not find a free web address for this name — choose one yourself.', { base });
}

/* ── the site as the owner sees it ────────────────────────────────────── */

export const AgencySiteView = z.object({
  slug: z.string(),
  /** The address it is served on today — the custom domain once bound, else the subdomain. */
  url: z.string(),
  subdomainUrl: z.string(),
  domain: z.string().optional(),
  published: z.boolean(),
  publishedAt: z.string().optional(),
  content: SiteContent,
});

export interface SiteDeps {
  /** `sparkai.social` — the root every agency's subdomain hangs off. */
  rootDomain: string;
  /**
   * Whether `<slug>.<rootDomain>` resolves yet — the wildcard DNS and Render
   * domain are a one-time manual step. Until they are, every link the product
   * shows is the path on the app host, which works from the first deploy;
   * on staging the subdomain links pointed at a name that did not resolve.
   */
  subdomainsLive?: boolean;
  /** The app's own origin, for the path form: `https://app.sparkai.social`. */
  appUrl?: string;
}

function view(rec: { slug: string; domain?: string; content: unknown; publishedAt?: Date }, deps: SiteDeps) {
  const subdomainUrl = deps.subdomainsLive
    ? `https://${rec.slug}.${deps.rootDomain}`
    : `${(deps.appUrl ?? `https://app.${deps.rootDomain}`).replace(/\/$/, '')}/s/${rec.slug}`;
  const content = SiteContent.safeParse(rec.content);
  return {
    slug: rec.slug,
    url: rec.domain ? `https://${rec.domain}` : subdomainUrl,
    subdomainUrl,
    ...(rec.domain ? { domain: rec.domain } : {}),
    published: Boolean(rec.publishedAt),
    ...(rec.publishedAt ? { publishedAt: rec.publishedAt.toISOString() } : {}),
    content: content.success ? content.data : FALLBACK_CONTENT,
  };
}

const FALLBACK_CONTENT: SiteContent = {
  headline: 'Social media, handled',
  subheadline: '',
  services: [{ title: 'Content creation', description: '' }],
  about: '',
  ctaLabel: 'Get in touch',
  contactHeading: 'Tell us about your business',
};

export function makeAgencySiteGet(deps: SiteDeps) {
  return defineTool({
    name: 'agency.site.get',
    version: 1,
    summary: 'Read this agency’s website — its address, whether it is live, its custom domain and its copy.',
    input: z.object({}),
    output: z.object({ site: AgencySiteView.nullable(), rootDomain: z.string() }),
    effect: 'read',
    autonomy: 'auto',
    scopes: ['owner', 'admin'],
    idempotent: true,
    surfaces: ['AG-WIZ-03'],
    async handler(_input, ctx) {
      const rec = await ctx.db.agencySites.get(ctx.orgId);
      return { site: rec ? view(rec, deps) : null, rootDomain: deps.rootDomain };
    },
  });
}

/* ── generate ─────────────────────────────────────────────────────────── */

/** Cut at the last word boundary that fits, so a long line ends on a word, not mid-syllable. */
function clip(v: unknown, max: number): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[,;:\s]+$/, '')}…`;
}

/**
 * The writer's copy, fitted to the page before it is checked.
 *
 * The model is asked for lengths and mostly keeps to them, but not always — on
 * staging a first press failed with "copy that did not fit the page" and the
 * second worked. One sentence too long is not a reason to throw the whole page
 * away and bill again: over-long text is trimmed at a word, services beyond six
 * are dropped, and only a page with no headline or no services still fails.
 */
export function fitContent(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as Record<string, unknown>;
  const services = Array.isArray(r.services) ? r.services : [];
  return {
    headline: clip(r.headline, 120),
    subheadline: clip(r.subheadline, 280),
    services: services
      .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
      .map((x) => ({ title: clip(x.title, 60), description: clip(x.description, 240) }))
      .filter((x) => x.title)
      .slice(0, 6),
    about: clip(r.about, 1200),
    ctaLabel: clip(r.ctaLabel, 40) || 'Get in touch',
    contactHeading: clip(r.contactHeading, 120),
  };
}

export interface SiteWriter {
  write(args: { prompt: string }): Promise<unknown>;
}

const MODEL_LINE: Record<AgencyProfile['model'], string> = {
  local_business: 'a social media agency for local businesses',
  personal_brand: 'a social media agency for coaches, creators and personal brands',
};

export function makeAgencySiteGenerate(writer: SiteWriter, deps: SiteDeps) {
  return defineTool({
    name: 'agency.site.generate',
    version: 1,
    summary:
      'Write and publish the agency’s one-page website from its launch-wizard profile, at its own ' +
      'subdomain. Replaces the copy if a site exists; keeps its address and domain. Spends real money.',
    input: z.object({}),
    output: z.object({ site: AgencySiteView, why: Explanation }),
    effect: 'write',
    autonomy: 'human_only',
    scopes: ['owner', 'admin'],
    /** Pressing it again asks for new copy. */
    idempotent: false,
    surfaces: ['AG-WIZ-03'],
    estimateCents: () => 2,

    async handler(_input, ctx) {
      const stored = await ctx.db.agencyProfiles.get(ctx.orgId);
      const profile = stored ? readStoredProfile(stored.profile) : undefined;
      if (!profile || !profile.name.trim()) {
        throw new ToolError('INVALID_INPUT', 'Give the agency a name in the launch wizard first — the site is written from it.', {});
      }

      const prompt = [
        `Agency name: ${profile.name}`,
        `It is ${MODEL_LINE[profile.model]}.`,
        profile.tagline ? `Tagline: ${profile.tagline}` : '',
        profile.service ? `Main service: ${profile.service}` : '',
        `Tone: ${profile.tone}`,
        '',
        'Write the copy for its one-page website: a headline, a one-sentence subheadline, three to four ' +
          'services each with a short description, a short "about" paragraph, a call-to-action button label ' +
          'and a heading for the contact form.',
        'Write in the tone given. Do not invent clients, results, statistics, prices, awards or years in business.',
        // On staging the first site reused the tagline word for word as its
        // headline, so the page opened on the same sentence twice.
        profile.tagline ? 'The headline must be new wording — not the tagline repeated.' : '',
      ]
        .filter(Boolean)
        .join('\n');

      const parsed = SiteContent.safeParse(fitContent(await writer.write({ prompt })));
      if (!parsed.success) {
        throw new ToolError('UPSTREAM_FAILED', 'The website writer returned copy that did not fit the page.', {
          issues: parsed.error.issues.slice(0, 3).map((i) => i.message),
        });
      }

      const existing = await ctx.db.agencySites.get(ctx.orgId);
      const slug = existing?.slug ?? (await freeSlug(slugify(profile.name), ctx));
      const rec = await ctx.db.agencySites.save({
        orgId: ctx.orgId,
        slug,
        content: parsed.data,
        publishedAt: existing?.publishedAt ?? new Date(),
      });
      ctx.logger.info('agency site generated', { orgId: ctx.orgId, slug });
      return {
        site: view(rec, deps),
        why: {
          summary: `Written from ${profile.name}'s wizard answers — the agency model, service, tagline and tone.`,
          factors: [
            { label: 'Agency model', detail: MODEL_LINE[profile.model] },
            { label: 'Tone', detail: profile.tone },
            ...(profile.service ? [{ label: 'Service', detail: profile.service }] : []),
          ],
          evidence: [],
          alternatives: [],
        },
      };
    },
  });
}

/* ── edit ─────────────────────────────────────────────────────────────── */

export function makeAgencySiteSet(deps: SiteDeps) {
  return defineTool({
    name: 'agency.site.set',
    version: 1,
    summary: 'Edit the agency website: its copy, its subdomain, or take it offline and back. Owner or admin.',
    input: z.object({
      slug: SiteSlug.optional(),
      content: SiteContent.optional(),
      published: z.boolean().optional(),
    }),
    output: z.object({ site: AgencySiteView }),
    effect: 'write',
    autonomy: 'human_only',
    scopes: ['owner', 'admin'],
    idempotent: true,
    surfaces: ['AG-WIZ-03'],

    async handler(input, ctx) {
      const existing = await ctx.db.agencySites.get(ctx.orgId);
      if (!existing) throw new ToolError('NOT_FOUND', 'Generate the website first.', {});

      if (input.slug && input.slug !== existing.slug) {
        if (RESERVED.has(input.slug) || (await ctx.db.agencySites.slugTaken(input.slug, ctx.orgId))) {
          throw new ToolError('INVALID_INPUT', `${input.slug}.${deps.rootDomain} is taken — try another.`, { slug: input.slug });
        }
      }

      const publishedAt =
        input.published === undefined ? (existing.publishedAt ?? null) : input.published ? (existing.publishedAt ?? new Date()) : null;
      const rec = await ctx.db.agencySites.save({
        orgId: ctx.orgId,
        slug: input.slug ?? existing.slug,
        content: input.content ?? existing.content,
        publishedAt,
      });
      return { site: view(rec, deps) };
    },
  });
}

/* ── custom domain ────────────────────────────────────────────────────── */

/** The host serving every site — Render, in this deployment. Injected. */
export interface DomainProvider {
  /** What a subdomain's CNAME points at, e.g. `sparksocial-web.onrender.com`. */
  cnameTarget: string;
  add(domain: string): Promise<{ domainType: 'apex' | 'subdomain'; verified: boolean }>;
  /** Re-checks DNS. Undefined when the provider no longer has the domain. */
  status(domain: string): Promise<{ domainType: 'apex' | 'subdomain'; verified: boolean } | undefined>;
  remove(domain: string): Promise<void>;
}

/** Render's load balancer, for registrars that cannot ALIAS a root domain. */
export const RENDER_APEX_IP = '216.24.57.1';

export const DnsRecord = z.object({ type: z.enum(['CNAME', 'A']), host: z.string(), value: z.string(), note: z.string().optional() });

export const DomainView = z.object({
  domain: z.string(),
  verified: z.boolean(),
  records: z.array(DnsRecord),
});

const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normaliseDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');
}

function records(domain: string, domainType: 'apex' | 'subdomain', target: string): z.infer<typeof DnsRecord>[] {
  if (domainType === 'subdomain') {
    return [{ type: 'CNAME', host: domain.split('.')[0]!, value: target }];
  }
  return [
    {
      type: 'A',
      host: '@',
      value: RENDER_APEX_IP,
      note: 'Or an ALIAS/ANAME (or a flattened CNAME) to ' + target + ' if your registrar offers one.',
    },
    { type: 'CNAME', host: 'www', value: target, note: 'So www. redirects to the root.' },
  ];
}

/*
  Three factories rather than one returning an array: the tool-type generator
  recognises a `make*` export that returns one tool, and an array would leave
  these three out of the typed client.
*/
export function makeAgencyDomainConnect(provider: DomainProvider, deps: SiteDeps) {
  return defineTool({
    name: 'agency.domain.connect',
    version: 1,
    summary:
      'Bind a domain the agency owns to its website. Registers it with the host and returns the DNS records ' +
      'to set at the registrar; it goes live once they resolve. Owner or admin.',
    input: z.object({ domain: z.string().min(4).max(253) }),
    output: DomainView,
    effect: 'external',
    autonomy: 'human_only',
    scopes: ['owner', 'admin'],
    /** Connecting the same domain again re-reads its records. */
    idempotent: true,
    surfaces: ['AG-WIZ-04'],

    async handler(input, ctx) {
      const domain = normaliseDomain(input.domain);
      if (!HOSTNAME.test(domain)) {
        throw new ToolError('INVALID_INPUT', `${input.domain} is not a domain name — something like youragency.com.`, {});
      }
      if (domain === deps.rootDomain || domain.endsWith(`.${deps.rootDomain}`)) {
        throw new ToolError('INVALID_INPUT', `Addresses on ${deps.rootDomain} are given out by the product — use a domain you own.`, {});
      }
      const site = await ctx.db.agencySites.get(ctx.orgId);
      if (!site) throw new ToolError('NOT_FOUND', 'Generate the website before connecting a domain.', {});
      if (await ctx.db.agencySites.domainTaken(domain, ctx.orgId)) {
        throw new ToolError('INVALID_INPUT', `${domain} is already connected to another account.`, {});
      }
      if (site.domain && site.domain !== domain) {
        throw new ToolError('INVALID_INPUT', `Remove ${site.domain} before connecting a different domain.`, {});
      }

      let added: Awaited<ReturnType<DomainProvider['add']>>;
      try {
        added = await provider.add(domain);
      } catch (e) {
        throw new ToolError('UPSTREAM_FAILED', 'The host would not register that domain. Nothing was changed.', {
          cause: e instanceof Error ? e.message : String(e),
        });
      }
      await ctx.db.agencySites.setDomain(ctx.orgId, domain);
      ctx.logger.info('agency domain connected', { orgId: ctx.orgId, domainType: added.domainType });
      return { domain, verified: added.verified, records: records(domain, added.domainType, provider.cnameTarget) };
    },
  });
}

export function makeAgencyDomainStatus(provider: DomainProvider) {
  return defineTool({
    name: 'agency.domain.status',
    version: 1,
    summary: 'Re-check whether the agency’s custom domain resolves to its website yet, with the records it needs.',
    input: z.object({}),
    output: DomainView.nullable(),
    effect: 'read',
    autonomy: 'auto',
    scopes: ['owner', 'admin'],
    idempotent: true,
    surfaces: ['AG-WIZ-04'],

    async handler(_input, ctx) {
      const site = await ctx.db.agencySites.get(ctx.orgId);
      if (!site?.domain) return null;
      let s: Awaited<ReturnType<DomainProvider['status']>>;
      try {
        s = await provider.status(site.domain);
      } catch (e) {
        throw new ToolError('UPSTREAM_FAILED', 'The host did not answer. Try the check again in a minute.', {
          cause: e instanceof Error ? e.message : String(e),
        });
      }
      const domainType = s?.domainType ?? (site.domain.split('.').length > 2 ? 'subdomain' : 'apex');
      return { domain: site.domain, verified: s?.verified ?? false, records: records(site.domain, domainType, provider.cnameTarget) };
    },
  });
}

export function makeAgencyDomainRemove(provider: DomainProvider) {
  return defineTool({
    name: 'agency.domain.remove',
    version: 1,
    summary: 'Disconnect the agency’s custom domain. The site stays live on its subdomain. Owner or admin.',
    input: z.object({}),
    output: z.object({ removed: z.string().nullable() }),
    effect: 'external',
    autonomy: 'human_only',
    scopes: ['owner', 'admin'],
    idempotent: true,
    surfaces: ['AG-WIZ-04'],

    async handler(_input, ctx) {
      const site = await ctx.db.agencySites.get(ctx.orgId);
      if (!site?.domain) return { removed: null };
      try {
        await provider.remove(site.domain);
      } catch (e) {
        throw new ToolError('UPSTREAM_FAILED', 'The host would not release that domain. Nothing was changed.', {
          cause: e instanceof Error ? e.message : String(e),
        });
      }
      await ctx.db.agencySites.setDomain(ctx.orgId, null);
      return { removed: site.domain };
    },
  });
}

/* ── the public projection ────────────────────────────────────────────── */

/**
 * What a visitor's browser may see — an explicit allow-list, never a spread.
 * The org id, the slug's owner, the domain binding's provider ids: none of it.
 */
export function publicSiteView(rec: { slug: string; content: unknown }, profileRaw: unknown) {
  const p = readStoredProfile(profileRaw);
  const content = SiteContent.safeParse(rec.content);
  return {
    slug: rec.slug,
    name: p.name || 'Our agency',
    tagline: p.tagline,
    contact: {
      ...(p.email ? { email: p.email } : {}),
      ...(p.phone ? { phone: p.phone } : {}),
    },
    style: { colors: p.colors, titleFont: p.titleFont, layout: p.layout, template: p.template },
    content: content.success ? content.data : FALLBACK_CONTENT,
  };
}
export type PublicSite = ReturnType<typeof publicSiteView>;
