import { describe, expect, it } from 'vitest';
import type { AgencySiteRecord, ToolCtx } from '@sparksocial/tools';
import { evaluate } from '@sparksocial/tools/policy';
import {
  makeAgencyDomainConnect,
  makeAgencyDomainRemove,
  makeAgencyDomainStatus,
  makeAgencySiteGenerate,
  makeAgencySiteGet,
  makeAgencySiteSet,
  publicSiteView,
  slugify,
  type DomainProvider,
  type SiteContent,
} from '../src/agencySite.js';
import { DEFAULT_AGENCY_PROFILE } from '../src/agencyProfile.js';

/**
 * `agency.site.*` / `agency.domain.*` — the agency website.
 *
 * What these guard: the address is derived and never collides, a website is
 * a person's decision, a domain on the product's own root cannot be claimed,
 * and the public projection carries nothing that identifies the org.
 */

const COPY: SiteContent = {
  headline: 'Posts that bring people in',
  subheadline: 'Social media for local businesses.',
  services: [{ title: 'Content', description: 'Made weekly.' }],
  about: 'A small team.',
  ctaLabel: 'Book a call',
  contactHeading: 'Tell us about you',
};

const deps = { rootDomain: 'sparkai.social' };

function world(orgId = 'org_1', profile: unknown = { ...DEFAULT_AGENCY_PROFILE, name: 'Northside Social' }) {
  const sites = new Map<string, AgencySiteRecord>();
  const profiles = new Map<string, unknown>([[orgId, profile]]);
  const ctx = (id = orgId) =>
    ({
      orgId: id,
      role: 'owner',
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
      db: {
        agencyProfiles: { get: async (o: string) => (profiles.has(o) ? { profile: profiles.get(o), updatedAt: new Date() } : undefined) },
        agencySites: {
          get: async (o: string) => sites.get(o),
          save: async ({ orgId: o, slug, content, publishedAt }: { orgId: string; slug: string; content: unknown; publishedAt: Date | null }) => {
            const prev = sites.get(o);
            const rec: AgencySiteRecord = { orgId: o, slug, content, ...(prev?.domain ? { domain: prev.domain } : {}), ...(publishedAt ? { publishedAt } : {}) };
            sites.set(o, rec);
            return rec;
          },
          setDomain: async (o: string, domain: string | null) => {
            const prev = sites.get(o)!;
            const { domain: _d, ...rest } = prev;
            const rec = domain ? { ...rest, domain } : rest;
            sites.set(o, rec);
            return rec;
          },
          slugTaken: async (slug: string, except: string) => [...sites.values()].some((s) => s.slug === slug && s.orgId !== except),
          domainTaken: async (d: string, except: string) => [...sites.values()].some((s) => s.domain === d && s.orgId !== except),
          findPublished: async () => undefined,
        },
      },
    }) as unknown as ToolCtx;
  return { sites, profiles, ctx };
}

const writer = { write: async () => COPY };

function decide(tool: { name: string; effect: string; autonomy: string; scopes: readonly string[] }, caller = 'user', role = 'owner') {
  return evaluate({
    caller,
    role,
    tool: { name: tool.name, effect: tool.effect, autonomy: tool.autonomy, scopes: tool.scopes },
    brand: { approvalMode: 'autopublish', agentPaused: false },
    budget: { estimatedCents: 0, remainingCents: 10_000 },
  } as unknown as Parameters<typeof evaluate>[0]);
}

describe('agency.site.generate', () => {
  it('writes the site, publishes it, and gives it an address from the agency name', async () => {
    const w = world();
    const out = await makeAgencySiteGenerate(writer, deps).handler({}, w.ctx());
    expect(out.site).toMatchObject({
      slug: 'northside-social',
      url: 'https://northside-social.sparkai.social',
      published: true,
      content: COPY,
    });
    expect(out.why.summary).toMatch(/Northside Social/);
  });

  it('never takes another agency’s address', async () => {
    const w = world();
    w.sites.set('org_2', { orgId: 'org_2', slug: 'northside-social', content: COPY, publishedAt: new Date() });
    const out = await makeAgencySiteGenerate(writer, deps).handler({}, w.ctx());
    expect(out.site.slug).toBe('northside-social-2');
  });

  it('keeps the address when the copy is rewritten', async () => {
    const w = world();
    const tool = makeAgencySiteGenerate(writer, deps);
    await tool.handler({}, w.ctx());
    w.profiles.set('org_1', { ...DEFAULT_AGENCY_PROFILE, name: 'Renamed Agency' });
    expect((await tool.handler({}, w.ctx())).site.slug).toBe('northside-social');
  });

  it('asks for a name before writing anything', async () => {
    const w = world('org_1', { ...DEFAULT_AGENCY_PROFILE, name: '' });
    await expect(makeAgencySiteGenerate(writer, deps).handler({}, w.ctx())).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('refuses copy that does not fit the page', async () => {
    const w = world();
    const bad = { write: async () => ({ headline: '' }) };
    await expect(makeAgencySiteGenerate(bad, deps).handler({}, w.ctx())).rejects.toMatchObject({ code: 'UPSTREAM_FAILED' });
  });

  it('is a person’s decision — refused to SPARK and to an editor', () => {
    const tool = makeAgencySiteGenerate(writer, deps);
    expect(decide(tool, 'agent').kind).toBe('deny');
    expect(decide(tool, 'user', 'editor').kind).toBe('deny');
    expect(decide(tool).kind).toBe('allow');
  });
});

describe('agency.site.set / get', () => {
  it('takes the site offline and back without losing its first publish date', async () => {
    const w = world();
    await makeAgencySiteGenerate(writer, deps).handler({}, w.ctx());
    const set = makeAgencySiteSet(deps);
    expect((await set.handler(set.input.parse({ published: false }), w.ctx())).site.published).toBe(false);
    expect((await set.handler(set.input.parse({ published: true }), w.ctx())).site.published).toBe(true);
  });

  it('refuses a reserved or taken subdomain', async () => {
    const w = world();
    await makeAgencySiteGenerate(writer, deps).handler({}, w.ctx());
    w.sites.set('org_2', { orgId: 'org_2', slug: 'taken-name', content: COPY });
    const set = makeAgencySiteSet(deps);
    await expect(set.handler(set.input.parse({ slug: 'app' }), w.ctx())).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(set.handler(set.input.parse({ slug: 'taken-name' }), w.ctx())).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(set.input.safeParse({ slug: 'Not A Slug' }).success).toBe(false);
  });

  it('reads null before a site exists', async () => {
    expect(await makeAgencySiteGet(deps).handler({}, world().ctx())).toEqual({ site: null, rootDomain: 'sparkai.social' });
  });
});

describe('agency.domain.*', () => {
  const provider = (verified = false): DomainProvider & { added: string[]; removed: string[] } => {
    const added: string[] = [];
    const removed: string[] = [];
    return {
      cnameTarget: 'sparksocial-web.onrender.com',
      added,
      removed,
      add: async (d) => {
        added.push(d);
        return { domainType: d.split('.').length > 2 ? 'subdomain' : 'apex', verified };
      },
      status: async (d) => ({ domainType: d.split('.').length > 2 ? 'subdomain' : 'apex', verified }),
      remove: async (d) => {
        removed.push(d);
      },
    };
  };

  it('binds a root domain and returns the A and www records', async () => {
    const w = world();
    await makeAgencySiteGenerate(writer, deps).handler({}, w.ctx());
    const p = provider();
    const out = await makeAgencyDomainConnect(p, deps).handler({ domain: 'https://NorthsideSocial.com/' }, w.ctx());
    expect(p.added).toEqual(['northsidesocial.com']);
    expect(out.records).toEqual([
      expect.objectContaining({ type: 'A', host: '@', value: '216.24.57.1' }),
      expect.objectContaining({ type: 'CNAME', host: 'www', value: 'sparksocial-web.onrender.com' }),
    ]);
    expect(w.sites.get('org_1')!.domain).toBe('northsidesocial.com');
    expect((await makeAgencySiteGet(deps).handler({}, w.ctx())).site!.url).toBe('https://northsidesocial.com');
  });

  it('gives a subdomain one CNAME', async () => {
    const w = world();
    await makeAgencySiteGenerate(writer, deps).handler({}, w.ctx());
    const out = await makeAgencyDomainConnect(provider(), deps).handler({ domain: 'social.northside.co.uk' }, w.ctx());
    expect(out.records).toEqual([{ type: 'CNAME', host: 'social', value: 'sparksocial-web.onrender.com' }]);
  });

  it('will not bind the product’s own root, a non-domain, or another agency’s domain', async () => {
    const w = world();
    await makeAgencySiteGenerate(writer, deps).handler({}, w.ctx());
    w.sites.set('org_2', { orgId: 'org_2', slug: 'other', content: COPY, domain: 'claimed.com' });
    const connect = makeAgencyDomainConnect(provider(), deps);
    for (const domain of ['evil.sparkai.social', 'sparkai.social', 'not a domain', 'claimed.com']) {
      await expect(connect.handler({ domain }, w.ctx())).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });

  it('needs a site before a domain', async () => {
    await expect(makeAgencyDomainConnect(provider(), deps).handler({ domain: 'acme.com' }, world().ctx())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('reports verification, and removes the binding at the host and here', async () => {
    const w = world();
    await makeAgencySiteGenerate(writer, deps).handler({}, w.ctx());
    const p = provider(true);
    await makeAgencyDomainConnect(p, deps).handler({ domain: 'acme.com' }, w.ctx());
    expect((await makeAgencyDomainStatus(p).handler({}, w.ctx()))!.verified).toBe(true);
    expect(await makeAgencyDomainRemove(p).handler({}, w.ctx())).toEqual({ removed: 'acme.com' });
    expect(p.removed).toEqual(['acme.com']);
    expect(w.sites.get('org_1')!.domain).toBeUndefined();
  });

  it('connecting a domain is refused to SPARK', () => {
    expect(decide(makeAgencyDomainConnect(provider(), deps), 'agent').kind).toBe('deny');
  });
});

describe('publicSiteView', () => {
  it('projects an allow-list — no org id, nothing the wizard did not mean to publish', () => {
    const view = publicSiteView(
      { slug: 'northside-social', content: COPY },
      { ...DEFAULT_AGENCY_PROFILE, name: 'Northside Social', email: 'hi@northside.example', yourName: 'Ada', phone: '' },
    );
    expect(Object.keys(view).sort()).toEqual(['contact', 'content', 'name', 'slug', 'style', 'tagline']);
    expect(view.contact).toEqual({ email: 'hi@northside.example' });
    expect(JSON.stringify(view)).not.toMatch(/org_|Ada/);
  });

  it('slugify makes a DNS label', () => {
    expect(slugify('Bloom & Co. Média!')).toBe('bloom-and-co-media');
    expect(slugify('A')).toBe('a-site');
  });
});
