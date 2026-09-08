import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { registerPublicProposal, type PublicProposalDeps } from '../src/public-proposal.js';

/**
 * The one unauthenticated read in this product.
 *
 * ── What these guard, in order of what would hurt most ────────────────────
 *
 *   1. **Redaction.** The row carries `orgId`, `leadId`, `createdBy`, its own
 *      id and the share token. A prospect must receive none of them, and the
 *      test asserts absence by name so adding a column cannot leak it.
 *   2. **One answer for every failure.** Expired, revoked, unknown, malformed
 *      — all 404. Telling them apart confirms a token was once valid, which is
 *      precisely what somebody holding a stale link wants to learn.
 *   3. **No caching.** The URL *is* the credential, so a shared cache holding
 *      the response is one client's priced offer waiting for the next reader.
 *   4. **Read-only.** There is no accept path here, and there must not be one:
 *      accepting a contract over a forwardable link is not a viewer's job.
 */

const HEX = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

interface Row {
  id: string;
  orgId: string;
  leadId: string;
  title: string;
  currency: string;
  status: string;
  termMonths: number;
  lineItems: Array<{ service: string; unitCents: number; quantity: number; recurrence: string }>;
  monthlyCents: number;
  oneOffCents: number;
  totalContractCents: number;
  notes?: string;
  shareToken?: string;
  shareExpiresAt?: Date;
  shareRevokedAt?: Date;
  sentAt?: Date;
  createdBy: string;
}

const row = (o: Partial<Row> = {}): Row => ({
  id: 'prop_secret_id',
  orgId: 'org_secret',
  leadId: 'lead_secret',
  title: 'Social media retainer',
  currency: 'USD',
  status: 'sent',
  termMonths: 6,
  lineItems: [{ service: 'content_creation', unitCents: 200_000, quantity: 1, recurrence: 'monthly' }],
  monthlyCents: 200_000,
  oneOffCents: 50_000,
  totalContractCents: 1_250_000,
  notes: 'Includes two rounds of revisions.',
  shareToken: HEX,
  shareExpiresAt: new Date(Date.now() + 7 * 86_400_000),
  sentAt: new Date('2026-09-08T10:00:00Z'),
  createdBy: 'user_secret',
  ...o,
});

/** A store with the real repository's own expiry and revocation behaviour. */
function deps(rows: Row[], leadName = 'Sunnyvale Innovations'): PublicProposalDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    db: {
      proposals: {
        async getByShareToken(token: string) {
          calls.push(`getByShareToken:${token.slice(0, 6)}`);
          const p = rows.find((r) => r.shareToken === token);
          if (!p) return undefined;
          if (p.shareRevokedAt) return undefined;
          if (!p.shareExpiresAt || p.shareExpiresAt.getTime() < Date.now()) return undefined;
          return p as never;
        },
      },
      leads: {
        async get({ orgId, id }: { orgId: string; id: string }) {
          calls.push(`leads.get:${orgId}/${id}`);
          return { businessName: leadName } as never;
        },
      },
    } as unknown as PublicProposalDeps['db'],
  };
}

function appFor(d: PublicProposalDeps) {
  const app = new Hono();
  registerPublicProposal(app, d);
  return app;
}

const get = (app: Hono, token: string, ip = '1.2.3.4') =>
  app.request(`/v1/public/proposals/${token}`, { headers: { 'x-forwarded-for': ip } });

/** `Response.json()` is `unknown` under the root config; the shape is asserted, not assumed. */
const body = async (res: Response): Promise<Record<string, unknown>> =>
  (await res.json()) as Record<string, unknown>;

describe('the happy path', () => {
  it('serves the offer a prospect needs to read it', async () => {
    const res = await get(appFor(deps([row()])), HEX);
    expect(res.status).toBe(200);

    const got = await body(res);
    expect(got).toMatchObject({
      title: 'Social media retainer',
      preparedFor: 'Sunnyvale Innovations',
      currency: 'USD',
      termMonths: 6,
      monthlyCents: 200_000,
      oneOffCents: 50_000,
      totalContractCents: 1_250_000,
      notes: 'Includes two rounds of revisions.',
    });
    expect(got.lineItems).toHaveLength(1);
  });

  it('names who it is for, because an offer that does not is not a proposal', async () => {
    const res = await get(appFor(deps([row()], 'Joe Coffee')), HEX);
    expect((await body(res)).preparedFor).toBe('Joe Coffee');
  });

  it('resolves the lead within the proposal’s own org, never a caller-supplied one', async () => {
    const d = deps([row()]);
    await get(appFor(d), HEX);
    expect(d.calls).toContain('leads.get:org_secret/lead_secret');
  });

  it('still renders when the lead has been deleted', async () => {
    const d = deps([row()]);
    (d.db.leads as unknown as { get: () => Promise<undefined> }).get = async () => undefined;
    const res = await get(appFor(d), HEX);
    expect(res.status).toBe(200);
    expect((await body(res)).preparedFor).toBe('you');
  });
});

describe('redaction', () => {
  it('discloses nothing internal, by name', async () => {
    /**
     * The list is explicit so that adding a column to `proposals` cannot leak
     * it: `publicView` is an allow-list, and this is the test that keeps it one.
     */
    const res = await get(appFor(deps([row()])), HEX);
    const got = await body(res);

    for (const forbidden of ['id', 'orgId', 'leadId', 'createdBy', 'shareToken', 'shareRevokedAt', 'updatedAt']) {
      expect(got).not.toHaveProperty(forbidden);
    }
  });

  it('never echoes the token anywhere in the response', async () => {
    const res = await get(appFor(deps([row()])), HEX);
    expect(JSON.stringify(await body(res))).not.toContain(HEX);
  });

  it('leaks no internal identifier in the serialised body', async () => {
    const res = await get(appFor(deps([row()])), HEX);
    const text = JSON.stringify(await body(res));
    for (const secret of ['org_secret', 'lead_secret', 'user_secret', 'prop_secret_id']) {
      expect(text).not.toContain(secret);
    }
  });

  it('returns exactly the agreed keys and no others', async () => {
    const res = await get(appFor(deps([row()])), HEX);
    expect(Object.keys(await body(res)).sort()).toEqual(
      [
        'currency', 'expiresAt', 'lineItems', 'monthlyCents', 'notes', 'oneOffCents',
        'preparedFor', 'sentAt', 'status', 'termMonths', 'title', 'totalContractCents',
      ].sort(),
    );
  });
});

describe('every failure is the same 404', () => {
  const cases: Array<[string, () => ReturnType<typeof appFor>, string]> = [
    ['a token that never existed', () => appFor(deps([row()])), OTHER],
    ['an expired link', () => appFor(deps([row({ shareExpiresAt: new Date(Date.now() - 1000) })])), HEX],
    ['a revoked link', () => appFor(deps([row({ shareRevokedAt: new Date() })])), HEX],
    ['an accepted proposal', () => appFor(deps([row({ status: 'accepted' })])), HEX],
    ['a declined proposal', () => appFor(deps([row({ status: 'declined' })])), HEX],
    ['a withdrawn proposal', () => appFor(deps([row({ status: 'withdrawn' })])), HEX],
    ['a token of the wrong length', () => appFor(deps([row()])), 'abc'],
    ['a token with non-hex characters', () => appFor(deps([row()])), 'z'.repeat(64)],
    ['uppercase hex, which this never mints', () => appFor(deps([row()])), 'A'.repeat(64)],
    ['a path traversal attempt', () => appFor(deps([row()])), '..%2f..%2fetc%2fpasswd'],
  ];

  it.each(cases)('404s on %s', async (_label, make, token) => {
    const res = await get(make(), token);
    expect(res.status).toBe(404);
  });

  it('gives byte-identical bodies, so the reason cannot be inferred', async () => {
    const unknown = await (await get(appFor(deps([row()])), OTHER)).text();
    const expired = await (await get(appFor(deps([row({ shareExpiresAt: new Date(0) })])), HEX)).text();
    const revoked = await (await get(appFor(deps([row({ shareRevokedAt: new Date() })])), HEX)).text();
    expect(expired).toBe(unknown);
    expect(revoked).toBe(unknown);
  });

  it('does not touch the database for a malformed token', async () => {
    /** The cheap guard: garbage must not become database work. */
    const d = deps([row()]);
    await get(appFor(d), 'not-a-token');
    expect(d.calls).toEqual([]);
  });
});

describe('caching and indexing', () => {
  it('forbids storing the response, because the URL is the credential', async () => {
    const res = await get(appFor(deps([row()])), HEX);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('cache-control')).toContain('private');
  });

  it('forbids indexing and referrer leakage of a token-bearing URL', async () => {
    const res = await get(appFor(deps([row()])), HEX);
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('keeps the 404 uncacheable too', async () => {
    const res = await get(appFor(deps([row()])), OTHER);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
});

describe('rate limiting', () => {
  it('refuses once a client is over the ceiling', async () => {
    const app = appFor({ ...deps([row()]), rateLimit: { max: 3, windowMs: 60_000 } });
    for (let i = 0; i < 3; i++) expect((await get(app, HEX)).status).toBe(200);

    const over = await get(app, HEX);
    expect(over.status).toBe(429);
    expect(over.headers.get('retry-after')).toBe('60');
  });

  it('counts per client, so one caller cannot lock everyone out', async () => {
    const app = appFor({ ...deps([row()]), rateLimit: { max: 2, windowMs: 60_000 } });
    await get(app, HEX, '9.9.9.9');
    await get(app, HEX, '9.9.9.9');
    expect((await get(app, HEX, '9.9.9.9')).status).toBe(429);
    expect((await get(app, HEX, '5.5.5.5')).status).toBe(200);
  });

  it('counts a request with no forwarded-for rather than exempting it', async () => {
    /** A missing header must not be the way around the ceiling. */
    const app = appFor({ ...deps([row()]), rateLimit: { max: 1, windowMs: 60_000 } });
    expect((await app.request(`/v1/public/proposals/${HEX}`)).status).toBe(200);
    expect((await app.request(`/v1/public/proposals/${HEX}`)).status).toBe(429);
  });

  it('lets a client through again once the window has passed', async () => {
    const app = appFor({ ...deps([row()]), rateLimit: { max: 1, windowMs: 1 } });
    expect((await get(app, HEX)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    expect((await get(app, HEX)).status).toBe(200);
  });

  it('limits a malformed token too, so the cheap path is not a free hammer', async () => {
    const app = appFor({ ...deps([row()]), rateLimit: { max: 2, windowMs: 60_000 } });
    await get(app, 'junk');
    await get(app, 'junk');
    expect((await get(app, 'junk')).status).toBe(429);
  });
});

describe('the surface is exactly one read', () => {
  it('answers no other verb on the route', async () => {
    const app = appFor(deps([row()]));
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await app.request(`/v1/public/proposals/${HEX}`, { method });
      expect(res.status).toBe(404);
    }
  });

  it('exposes nothing else under /v1/public', async () => {
    const app = appFor(deps([row()]));
    for (const path of ['/v1/public', '/v1/public/proposals', '/v1/public/leads/x', '/v1/public/proposals']) {
      expect((await app.request(path)).status).toBe(404);
    }
  });

  it('registers one route and no more', () => {
    /**
     * A count rather than a name: the point is that this module cannot grow a
     * second surface without somebody changing this number and being asked why.
     */
    const app = new Hono();
    registerPublicProposal(app, deps([row()]));
    expect(app.routes.filter((r) => r.path.startsWith('/v1/public'))).toHaveLength(1);
    expect(app.routes[0]?.method).toBe('GET');
  });
});
