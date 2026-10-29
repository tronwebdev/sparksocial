import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { ScopedDb } from '@sparksocial/tools/defineTool';
import { registerPublicSites } from '../src/public-site.js';
import { createDevStore } from '../src/dev-store.js';

/**
 * The agency websites' public surface.
 *
 * What these guard: nothing is served before it is published; the response
 * carries no org id; the logo is bytes, never Clerk's URL; and the contact
 * form can only add an `inbound` lead to the site's own org — never reveal
 * whether somebody was already in the pipeline.
 */

const COPY = {
  headline: 'Posts that bring people in',
  subheadline: 'Social media for local businesses.',
  services: [{ title: 'Content', description: 'Made weekly.' }],
  about: 'A small team.',
  ctaLabel: 'Book a call',
  contactHeading: 'Tell us about you',
};

async function setup(opts: { published?: boolean; logo?: boolean } = {}) {
  const db = createDevStore() as unknown as ScopedDb;
  await db.agencyProfiles.set('org_secret_1', { name: 'Northside Social', email: 'hi@northside.example', tone: 'Friendly', colors: ['#3157D6'] });
  await db.agencySites.save({ orgId: 'org_secret_1', slug: 'northside', content: COPY, publishedAt: opts.published === false ? null : new Date() });
  await db.agencySites.setDomain('org_secret_1', 'northside.example');
  const app = new Hono();
  registerPublicSites(app, {
    db,
    ...(opts.logo
      ? { resolveLogo: async () => ({ contentType: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]).buffer }) }
      : {}),
  });
  const post = (body: unknown, ip = '1.1.1.1') =>
    app.request('/v1/public/sites/northside/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    });
  return { db, app, post };
}

describe('GET /v1/public/sites', () => {
  it('serves a published site by slug and by domain, with no org id anywhere', async () => {
    const { app } = await setup();
    for (const path of ['/v1/public/sites/northside', '/v1/public/sites/by-domain/northside.example']) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain('org_secret_1');
      expect(JSON.parse(text)).toMatchObject({ name: 'Northside Social', content: COPY, hasLogo: false });
    }
  });

  it('serves nothing for an unpublished site, an unknown one, or a malformed slug', async () => {
    const { app } = await setup({ published: false });
    expect((await app.request('/v1/public/sites/northside')).status).toBe(404);
    expect((await app.request('/v1/public/sites/nobody-here')).status).toBe(404);
    expect((await app.request('/v1/public/sites/..%2Fetc')).status).toBe(404);
  });

  it('returns the logo as bytes', async () => {
    const { app } = await setup({ logo: true });
    const res = await app.request('/v1/public/sites/northside/logo');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer())[1]).toBe(80);
  });
});

describe('POST /v1/public/sites/:slug/leads', () => {
  it('adds the visitor to the site’s own pipeline as an inbound lead', async () => {
    const { db, post } = await setup();
    const res = await post({ name: 'Ada Obi', email: 'ADA@bakery.example', company: 'Acme Bakery', message: 'Need posts' });
    expect(res.status).toBe(200);
    const { rows: leads } = await db.leads.list({ orgId: 'org_secret_1', limit: 50, offset: 0 } as Parameters<ScopedDb['leads']['list']>[0]);
    expect(leads).toEqual([
      expect.objectContaining({ businessName: 'Acme Bakery', contactName: 'Ada Obi', email: 'ada@bakery.example', source: 'inbound', interest: 'Need posts' }),
    ]);
  });

  it('answers a repeat exactly like a first submission, and stores one lead', async () => {
    const { db, post } = await setup();
    const a = await post({ name: 'Ada', email: 'ada@x.example' }, '2.2.2.2');
    const b = await post({ name: 'Ada', email: 'ada@x.example' }, '3.3.3.3');
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await a.json()).toEqual(await b.json());
    const { rows: leads } = await db.leads.list({ orgId: 'org_secret_1', limit: 50, offset: 0 } as Parameters<ScopedDb['leads']['list']>[0]);
    expect(leads).toHaveLength(1);
  });

  it('drops a submission that fills the honeypot, answering as if it worked', async () => {
    const { db, post } = await setup();
    expect((await post({ name: 'Bot', email: 'bot@x.example', website: 'http://spam.example' })).status).toBe(200);
    const { rows: leads } = await db.leads.list({ orgId: 'org_secret_1', limit: 50, offset: 0 } as Parameters<ScopedDb['leads']['list']>[0]);
    expect(leads).toHaveLength(0);
  });

  it('refuses a bad email and limits one visitor to five sends', async () => {
    const { post } = await setup();
    expect((await post({ name: 'Ada', email: 'nope' }, '9.9.9.9')).status).toBe(400);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await post({ name: `P${i}`, email: `p${i}@x.example` }, '8.8.8.8')).status);
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});
