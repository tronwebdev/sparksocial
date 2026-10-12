import type { Context, Hono } from 'hono';
import type { ScopedDb } from '@sparksocial/tools/defineTool';

/**
 * `GET /v1/public/proposals/:token` — the client-facing view of a proposal.
 *
 * ── Why this is not a tool ────────────────────────────────────────────────
 *
 * Every capability in this product is a tool (CLAUDE.md invariant 1), reached
 * through `POST /v1/tools/:name`, and every one of them needs a `ToolCtx`: an
 * org, a role, a budget. A prospect opening a proposal has none of those — the
 * **token is the entire credential**, which is the same posture
 * `whitelabel.link.create` describes for review links and the same reason
 * `/v1/agent/runs` sits outside the registry.
 *
 * Making this a tool would be actively dangerous, not merely awkward: the tool
 * proxy attaches a Clerk token, so a registry that contained one unauthenticated
 * tool would have its whole scope model resting on nobody ever making that proxy
 * public. So this is a third non-tool surface, deliberately, and it is the
 * narrowest one that can exist: one route, one verb, one parameter, read-only.
 *
 * ── What it discloses, and what it must never ─────────────────────────────
 *
 * The projection at {@link publicView} is an explicit allow-list, never a
 * spread. A `proposals` row carries `orgId`, `leadId`, `createdBy`, its own id
 * and the share token; none of that is any of the reader's business, and a
 * spread would leak all five the first time somebody added a column.
 *
 * The lead's business name *is* disclosed, as "prepared for" — the reader is
 * that business, and a priced offer that does not say who it is for is not a
 * proposal. The sending organisation's *name* is disclosed too, for the same
 * reason in reverse: an offer with no sender is not one either. Its `orgId`
 * never is — that is the tenancy key every scoped query filters on, and see
 * {@link Agency} for the logo that had to be dropped because Clerk's image URL
 * carries that id in base64.
 *
 * ── Why every failure is the same 404 ────────────────────────────────────
 *
 * Expired, revoked, never existed, malformed: one answer. A response that
 * distinguished them would confirm that a token had once been valid, which is
 * exactly the fact an attacker holding a leaked-but-expired link would want.
 *
 * ── What it deliberately cannot do ───────────────────────────────────────
 *
 * Accept. A prospect accepting a contract over an unauthenticated link that
 * survives being forwarded is a decision with real legal weight, and it is not
 * something to acquire as a side effect of building a viewer. The agency records
 * the answer with `proposal.decide`, which is authenticated and audited.
 */

/**
 * What the reader is told about the sender: its name, and nothing else.
 *
 * ── Why there is no logo here ─────────────────────────────────────────────
 *
 * There was one, briefly, taken from Clerk's `imageUrl`. Decoding one revealed
 * why it cannot ship:
 *
 *     {"type":"default","iid":"ins_3Hbiud…","rid":"org_3ImTARRW…","initials":"J"}
 *
 * Clerk's generated avatar URL base64-embeds the **organisation id** and the
 * **Clerk instance id** in its path. Serving it on an unauthenticated page
 * publishes both — and a grep for `org_` does not catch it, which is how it got
 * as far as being served at all.
 *
 * Two further reasons it stays out even for an uploaded image, which might not
 * embed ids: it makes every prospect opening a proposal fetch from a third-party
 * CDN, which both tells that CDN somebody is reading this document and defeats
 * the point of `no-referrer` on a page whose URL is a credential; and the
 * default avatar is a letter in a circle, so almost nothing is lost.
 *
 * If the agency's real mark matters on the letterhead, the way to do it is to
 * serve the bytes ourselves rather than to link somebody else's URL.
 */
export interface Agency {
  name: string;
}

export interface PublicProposalDeps {
  db: Pick<ScopedDb, 'proposals' | 'leads'>;
  /**
   * Who the proposal is from, by org id.
   *
   * A narrow function rather than the `ClerkClient` itself, deliberately: this
   * is the one unauthenticated route in the product, and handing it the whole
   * Clerk API so it can read one string would give it the authority to
   * enumerate members and mint invitations. It gets a lookup, not a client.
   *
   * Optional. Without it — Clerk unconfigured, as in dev — the page renders
   * with no sender named rather than not rendering.
   */
  resolveAgency?: (orgId: string) => Promise<Agency | undefined>;
  /**
   * Requests per window per client, before the route starts refusing.
   *
   * The token is 256 random bits, so guessing is not the threat this addresses
   * — cost is. Without a ceiling, an unauthenticated route that touches Postgres
   * is a free way to make this instance do database work.
   */
  rateLimit?: { max: number; windowMs: number };
}

/** 64 lowercase hex — `randomBytes(32).toString('hex')`, and nothing else. */
const TOKEN_RE = /^[0-9a-f]{64}$/;

const DEFAULTS = { max: 60, windowMs: 60_000 };

/**
 * A fixed-window counter, per process.
 *
 * Per-instance and therefore approximate behind more than one replica — Redis
 * is in this stack and would make it exact, and that is the change to make if
 * this route ever matters enough to be attacked properly. Said plainly rather
 * than implied, because a limiter that quietly does less than it looks like it
 * does is worse than none.
 */
function createLimiter({ max, windowMs }: { max: number; windowMs: number }) {
  const hits = new Map<string, { n: number; resetAt: number }>();

  return function take(key: string): boolean {
    const now = Date.now();
    const cur = hits.get(key);

    if (!cur || cur.resetAt <= now) {
      hits.set(key, { n: 1, resetAt: now + windowMs });
      /* Opportunistic sweep, so a long-lived process does not accumulate a
         bucket per IP it has ever seen. */
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      }
      return true;
    }

    if (cur.n >= max) return false;
    cur.n += 1;
    return true;
  };
}

/**
 * Org names, cached in process.
 *
 * Without this, every view of a public URL is a Clerk API call, which makes an
 * unauthenticated route an amplifier: somebody refreshing a link they already
 * hold would spend our Clerk quota rather than their own patience. The rate
 * limiter caps the requests; this caps the *upstream* calls, which is a
 * different ceiling and the one that costs money.
 *
 * A miss is cached too, and for less time. An org that genuinely has no name
 * must not be looked up on every request, but a lookup that failed because
 * Clerk was briefly unreachable should be retried sooner than one that
 * succeeded.
 */
const AGENCY_TTL_MS = 10 * 60_000;
const AGENCY_MISS_TTL_MS = 60_000;

function createAgencyCache(resolve: (orgId: string) => Promise<Agency | undefined>) {
  const cache = new Map<string, { at: number; ttl: number; value: Agency | undefined }>();

  return async function get(orgId: string): Promise<Agency | undefined> {
    const now = Date.now();
    const hit = cache.get(orgId);
    if (hit && now - hit.at < hit.ttl) return hit.value;

    let value: Agency | undefined;
    try {
      value = await resolve(orgId);
    } catch {
      /**
       * A sender we cannot name is not a reason to withhold the offer. The
       * proposal is the document; the letterhead is decoration, and a Clerk
       * outage must not 500 a client-facing page.
       */
      value = undefined;
    }

    cache.set(orgId, { at: now, ttl: value ? AGENCY_TTL_MS : AGENCY_MISS_TTL_MS, value });

    if (cache.size > 5_000) {
      for (const [k, v] of cache) if (now - v.at >= v.ttl) cache.delete(k);
    }

    return value;
  };
}

/** The allow-list. Adding a column to `proposals` must not change this. */
function publicView(
  p: {
    title: string;
    currency: string;
    status: string;
    termMonths: number;
    lineItems: unknown;
    monthlyCents: number;
    oneOffCents: number;
    totalContractCents: number;
    notes?: string;
    shareExpiresAt?: Date;
    sentAt?: Date;
  },
  preparedFor: string,
  from: Agency | undefined,
) {
  return {
    title: p.title,
    preparedFor,
    /**
     * The org's *name*, never its id — and explicitly reconstructed rather
     * than passed through, so a resolver that starts returning more cannot
     * widen what this route discloses. `orgId` is the tenancy key every scoped
     * query in the product filters on.
     */
    ...(from ? { from: { name: from.name } } : {}),
    currency: p.currency,
    status: p.status,
    termMonths: p.termMonths,
    lineItems: p.lineItems,
    monthlyCents: p.monthlyCents,
    oneOffCents: p.oneOffCents,
    totalContractCents: p.totalContractCents,
    ...(p.notes ? { notes: p.notes } : {}),
    ...(p.sentAt ? { sentAt: p.sentAt.toISOString() } : {}),
    ...(p.shareExpiresAt ? { expiresAt: p.shareExpiresAt.toISOString() } : {}),
  };
}

export function registerPublicProposal(app: Hono, deps: PublicProposalDeps): void {
  const limits = { ...DEFAULTS, ...deps.rateLimit };
  const take = createLimiter(limits);
  const agency = deps.resolveAgency ? createAgencyCache(deps.resolveAgency) : undefined;

  app.get('/v1/public/proposals/:token', async (c) => {
    /**
     * `x-forwarded-for`'s first hop, since Front Door terminates the
     * connection. Falls back to a single shared bucket rather than to no limit
     * at all — a missing header must not be the way around the ceiling.
     */
    const ip = (c.req.header('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'unknown';
    if (!take(ip)) {
      return c.json({ error: 'Too many requests.' }, 429, { 'retry-after': String(Math.ceil(limits.windowMs / 1000)) });
    }

    const token = c.req.param('token');

    /* Shape-checked before Postgres is touched: garbage costs nothing. */
    if (!TOKEN_RE.test(token)) return notFound(c);

    const proposal = await deps.db.proposals.getByShareToken(token);
    /* Undefined covers unknown, expired and revoked — the store checks all three. */
    if (!proposal) return notFound(c);

    /**
     * A decided proposal should already be unreachable: `proposal.decide`
     * revokes the link, so the store would have returned nothing. Checked
     * anyway, because "the offer is settled" must never depend on one writer
     * having remembered to revoke.
     */
    if (proposal.status !== 'draft' && proposal.status !== 'sent') return notFound(c);

    /**
     * In parallel: neither depends on the other, and the sender lookup can be
     * a network call. Serialising them would put Clerk's latency in front of a
     * page the reader is waiting on.
     */
    const [lead, from] = await Promise.all([
      deps.db.leads.get({ orgId: proposal.orgId, id: proposal.leadId }),
      agency ? agency(proposal.orgId) : Promise.resolve(undefined),
    ]);

    return c.json(publicView(proposal, lead?.businessName ?? 'you', from), 200, {
      /**
       * Never stored by anything in front of this. The URL is the credential,
       * so a shared cache holding the response is one prospect's priced offer
       * waiting to be served to the next.
       */
      'cache-control': 'no-store, no-cache, must-revalidate, private',
      /* The token is in the path; nothing here should be indexed or followed. */
      'x-robots-tag': 'noindex, nofollow, noarchive',
      'referrer-policy': 'no-referrer',
    });
  });
}

function notFound(c: Context) {
  return c.json({ error: 'This proposal link is not valid.' }, 404, {
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
  });
}
