import { describe, expect, it } from 'vitest';
import { siteForHost } from '../src/lib/siteHost';

/**
 * Which requests are an agency website. The failure that matters is the app
 * being mistaken for a site — every page would 404 — so each app-shaped host
 * is asserted to stay the app.
 */
describe('siteForHost', () => {
  it('leaves the app’s own hosts alone', () => {
    for (const host of [
      'app.sparkai.social',
      'APP.sparkai.social:443',
      'sparkai.social',
      'www.sparkai.social',
      'api.sparkai.social',
      'staging.sparkai.social',
      'sparksocial-web.onrender.com',
      'sparksocial-web-pr-12.onrender.com',
      'localhost',
      'localhost:3000',
      '10.0.4.17:10000',
      'sparksocial-web',
      '',
      null,
    ]) {
      expect(siteForHost(host), String(host)).toBeNull();
    }
  });

  it('reads an agency subdomain, in production and in development', () => {
    expect(siteForHost('northside.sparkai.social')).toEqual({ slug: 'northside' });
    expect(siteForHost('northside-social.localhost:3000')).toEqual({ slug: 'northside-social' });
  });

  it('does not treat a deeper or malformed subdomain as an agency', () => {
    expect(siteForHost('a.b.sparkai.social')).toBeNull();
    expect(siteForHost('-bad.sparkai.social')).toBeNull();
  });

  it('treats any other host as a custom domain', () => {
    expect(siteForHost('NorthsideSocial.com.')).toEqual({ domain: 'northsidesocial.com' });
    expect(siteForHost('social.northside.co.uk')).toEqual({ domain: 'social.northside.co.uk' });
  });
});
