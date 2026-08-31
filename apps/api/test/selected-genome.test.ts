import { describe, expect, it } from 'vitest';
import {
  claimFromCookieHeader,
  forwardableGenomeId,
  parseGenomeCookie,
} from '../../web/src/lib/selectedGenome.js';

/**
 * The `spark_genome` cookie's org binding.
 *
 * ── The bug these guard ───────────────────────────────────────────────────
 *
 * The cookie held a bare genome id with a one-year lifetime and nothing cleared
 * it on sign-out. A second person signing up in the same browser sent the first
 * person's genome id on every request, `clerk-auth.ts` refused it — correctly —
 * and onboarding could not get past its first step.
 *
 * The fix records the org in the cookie and has the proxy forward the claim only
 * when it matches the org Clerk verified for that request. So the assertions
 * that matter are the *negative* ones: a cookie from another org, and a cookie
 * from before this format existed, must both produce no claim at all.
 *
 * ── Why this test lives under `apps/api` ──────────────────────────────────
 *
 * `apps/web` has no test directory, by the decision recorded in
 * `vitest.config.ts`: a Next shell with no logic gains nothing from jsdom. This
 * module is the exception that decision did not anticipate — it is pure logic,
 * it is the tenancy boundary's browser half, and `npm run build:web` cannot
 * check what it *decides*. Importing it across the app boundary is deliberate
 * and confined to this file.
 */

const ORG = 'org_2abcDEF';
const OTHER = 'org_9zzzXYZ';
const GEN = 'gen_01HQ';

describe('parseGenomeCookie', () => {
  it('reads the org and the genome out of the current format', () => {
    expect(parseGenomeCookie(encodeURIComponent(`${ORG}~${GEN}`))).toEqual({ orgId: ORG, genomeId: GEN });
  });

  it('reads a legacy value as a genome with no org', () => {
    // Every cookie written before this change. It must parse — so the proxy can
    // recognise it and drop it — rather than being mistaken for corruption.
    expect(parseGenomeCookie(GEN)).toEqual({ genomeId: GEN });
  });

  it('is undefined for nothing, and for a value that is only a separator', () => {
    expect(parseGenomeCookie(undefined)).toBeUndefined();
    expect(parseGenomeCookie('')).toBeUndefined();
    expect(parseGenomeCookie(encodeURIComponent(`${ORG}~`))).toBeUndefined();
  });

  it('does not throw on a malformed encoding', () => {
    // A stray `%` reaches `decodeURIComponent` as a URIError. Thrown from a proxy
    // route, that would 500 every request carrying the bad cookie — a browser
    // wedged with no way out.
    expect(parseGenomeCookie('%E0%A4%A')).toBeUndefined();
  });
});

describe('claimFromCookieHeader', () => {
  it('finds the cookie among others', () => {
    const header = `__session=abc; ${'spark_genome'}=${encodeURIComponent(`${ORG}~${GEN}`)}; theme=dark`;
    expect(claimFromCookieHeader(header)).toEqual({ orgId: ORG, genomeId: GEN });
  });

  it('is undefined when it is absent', () => {
    expect(claimFromCookieHeader('__session=abc; theme=dark')).toBeUndefined();
    expect(claimFromCookieHeader(null)).toBeUndefined();
  });

  it('does not match a cookie whose name merely ends with it', () => {
    // `not_spark_genome=…` must not be read as the real one.
    expect(claimFromCookieHeader(`not_spark_genome=${ORG}~${GEN}`)).toBeUndefined();
  });
});

describe('forwardableGenomeId', () => {
  const cookie = (org: string, gen: string) => `spark_genome=${encodeURIComponent(`${org}~${gen}`)}`;

  it('forwards a claim recorded against this org', () => {
    expect(forwardableGenomeId(cookie(ORG, GEN), ORG)).toBe(GEN);
  });

  it('drops a claim recorded against another org', () => {
    /**
     * The whole point. This is the second-account case: the browser holds org A's
     * genome and the session is org B's. Forwarding it produced
     * `ISOLATION_VIOLATION` on every call in the new session.
     */
    expect(forwardableGenomeId(cookie(OTHER, GEN), ORG)).toBeUndefined();
  });

  it('drops a legacy claim with no org', () => {
    // Honouring it would be the bug: a bare id is exactly what the old cookie
    // held, and it is unknowable which org it came from.
    expect(forwardableGenomeId(`spark_genome=${GEN}`, ORG)).toBeUndefined();
  });

  it('drops everything when the session has no org', () => {
    // A session mid-org-selection. There is nothing to compare against, and
    // guessing would reintroduce the bug for exactly the sessions least able to
    // recover from it.
    expect(forwardableGenomeId(cookie(ORG, GEN), null)).toBeUndefined();
    expect(forwardableGenomeId(cookie(ORG, GEN), undefined)).toBeUndefined();
  });
});
