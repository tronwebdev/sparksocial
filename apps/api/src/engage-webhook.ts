import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Hono } from 'hono';
import { invokeTool } from '@sparksocial/tools';
import type { InvokeDeps, ToolCtx } from '@sparksocial/tools';

/**
 * THE ENGAGEMENT WEBHOOK — the inbox's missing writer (PRD §8.8).
 *
 * `engage.ingest` was built against a deliberately normalized shape so the
 * ingest → classify → feed path could run end to end under test, with a note
 * saying the real platform webhooks were "a separate piece behind this seam".
 * This is that piece. Until it existed the engagement inbox could only ever be
 * filled by a test.
 *
 * ── Two sources, one pipeline ─────────────────────────────────────────────
 *
 * Publishing already has this shape: an aggregator adapter carries the alpha
 * while native adapters land behind it as approvals clear (CLAUDE.md § Scope).
 * Inbound is the same problem and gets the same answer.
 *
 *  - `POST /v1/webhooks/engage/meta` — Instagram comments and DMs, signed with
 *    `X-Hub-Signature-256` exactly as `whatsapp-webhook.ts` describes.
 *  - `POST /v1/webhooks/engage/aggregator` — the Ayrshare-class relay, which
 *    signs with its own shared secret over the raw body.
 *
 * Both normalize to the same internal shape and both end in one `engage.ingest`
 * call per message, so the classifier, the feed and the reply path cannot tell
 * which route a message arrived on. That is the point of the seam: a native
 * adapter replacing the aggregator changes this file and nothing downstream.
 *
 * ── Signature verification is most of this file, and has to be ────────────
 *
 * These endpoints are unauthenticated by necessity — the platform calls them and
 * has no Clerk session. The signature is the only thing between "a customer
 * commented on your post" and "anyone on the internet wrote a row in your
 * inbox", and the inbox drives replies that can be sent automatically under
 * `engagementAutonomy: 'auto'`. A forged comment is therefore a path to making
 * the brand say something.
 *
 * The two rules `whatsapp-webhook.ts` sets out apply unchanged and are the easy
 * ones to get wrong: HMAC over the **raw** bytes (parsing and re-serialising
 * changes key order and breaks the digest), and constant-time comparison.
 *
 * With no secret configured a route is **not registered at all** rather than
 * registered and permissive. A missing endpoint fails visibly during setup; a
 * permissive one does not fail until it matters.
 *
 * ── Why tenant resolution is a refusal, not a guess ───────────────────────
 *
 * A webhook arrives knowing only which *account* an event happened on, so the
 * genome comes from `AccountLookup` — the one read in the system that runs
 * before a tenant is known. When it returns more than one match there is no
 * defensible choice, and choosing wrong files one customer's private DM into
 * another customer's inbox. The event is dropped with a warning instead. Losing
 * a comment is recoverable; leaking one is not.
 */

export interface AccountLookupFn {
  (args: { provider: string; accountId: string }): Promise<Array<{ orgId: string; genomeId: string }>>;
}

export interface EngageWebhookDeps {
  invokeDeps: InvokeDeps;
  /** Builds the ctx the tool runs under. A platform is not a Clerk user. */
  systemCtx: (args: { orgId: string; brandId: string; genomeId: string }) => Promise<ToolCtx>;
  loadBrandGovernance: (orgId: string, brandId?: string) => Promise<Parameters<typeof invokeTool>[0]['brand']>;
  /** Account id → tenant. The trust boundary for everything after it. */
  lookupAccount: AccountLookupFn;
  /** Which brand a genome belongs to, for governance. */
  brandForGenome: (genomeId: string, orgId: string) => Promise<string | undefined>;
  /** Meta's app secret. Absent leaves the Meta route unregistered. */
  metaAppSecret?: string;
  /** Echoed back on Meta's GET subscription handshake. */
  metaVerifyToken?: string;
  /** The aggregator's signing secret. Absent leaves that route unregistered. */
  aggregatorSecret?: string;
}

/** The normalized shape both sources collapse to — `engage.ingest`'s input, minus the genome. */
export interface InboundEngagement {
  /** The account the event happened on, for tenant resolution. */
  accountId: string;
  platform: 'instagram' | 'tiktok' | 'linkedin' | 'x' | 'youtube_shorts';
  externalId: string;
  kind: 'comment' | 'dm' | 'story_reply';
  authorHandle: string;
  authorName?: string;
  text: string;
  receivedAt?: string;
  threadKey?: string;
}

export function registerEngageWebhook(app: Hono, deps: EngageWebhookDeps): void {
  if (deps.metaAppSecret) registerMeta(app, deps, deps.metaAppSecret);
  if (deps.aggregatorSecret) registerAggregator(app, deps, deps.aggregatorSecret);
}

/** Which routes are live, for the startup banner — a silent inbox looks identical to an empty one. */
export function describeEngageWebhook(deps: Pick<EngageWebhookDeps, 'metaAppSecret' | 'aggregatorSecret'>): string {
  const live = [deps.metaAppSecret ? 'meta' : undefined, deps.aggregatorSecret ? 'aggregator' : undefined].filter(
    Boolean,
  );
  return live.length ? live.join(', ') : 'none — the engagement inbox has no writer';
}

/* ── Meta ────────────────────────────────────────────────────────────────── */

function registerMeta(app: Hono, deps: EngageWebhookDeps, appSecret: string): void {
  /**
   * Subscription handshake. Meta calls this once when the webhook is configured
   * and expects `hub.challenge` echoed back verbatim as plain text.
   */
  app.get('/v1/webhooks/engage/meta', (c) => {
    const token = c.req.query('hub.verify_token');
    if (c.req.query('hub.mode') === 'subscribe' && token && deps.metaVerifyToken && safeEqual(token, deps.metaVerifyToken)) {
      return c.text(c.req.query('hub.challenge') ?? '', 200);
    }
    return c.text('Forbidden', 403);
  });

  app.post('/v1/webhooks/engage/meta', async (c) => {
    // Raw first — a re-serialised body will not match the digest.
    const raw = await c.req.text();

    if (!verifyMetaSignature(raw, c.req.header('x-hub-signature-256'), appSecret)) {
      // No detail in the body. Distinguishing "missing" from "wrong" is a free
      // oracle for anyone probing the endpoint.
      return c.json({ error: { code: 'FORBIDDEN', message: 'Bad signature.' } }, 403);
    }

    return c.json({ received: await ingestAll(deps, parseMeta(raw)) });
  });
}

/* ── the aggregator ──────────────────────────────────────────────────────── */

function registerAggregator(app: Hono, deps: EngageWebhookDeps, secret: string): void {
  app.post('/v1/webhooks/engage/aggregator', async (c) => {
    const raw = await c.req.text();

    /**
     * Two header spellings accepted because the relays in this class disagree
     * about which to send, and the alternative to accepting both is a silently
     * dead inbox that looks exactly like a quiet one. Both are the same HMAC
     * over the same raw bytes, so accepting either weakens nothing.
     */
    const signature = c.req.header('x-ayrshare-signature') ?? c.req.header('x-webhook-signature');
    if (!verifyHexSignature(raw, signature, secret)) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Bad signature.' } }, 403);
    }

    return c.json({ received: await ingestAll(deps, parseAggregator(raw)) });
  });
}

/* ── the shared pipeline ─────────────────────────────────────────────────── */

/**
 * 200 regardless of what happens below.
 *
 * Platforms retry any non-2xx with backoff and eventually disable a webhook that
 * keeps failing. A message that cannot be routed — an unknown account, an event
 * type with no text — is not a delivery failure, and reporting it as one
 * eventually costs the whole integration. The acknowledgement is about
 * transport, not about business outcome; failures are logged.
 */
async function ingestAll(deps: EngageWebhookDeps, messages: InboundEngagement[]): Promise<number> {
  let accepted = 0;
  for (const message of messages) {
    try {
      if (await ingestOne(deps, message)) accepted++;
    } catch (e) {
      console.error('[error] engage webhook: ingest failed', {
        platform: message.platform,
        externalId: message.externalId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return accepted;
}

async function ingestOne(deps: EngageWebhookDeps, message: InboundEngagement): Promise<boolean> {
  const matches = await deps.lookupAccount({ provider: message.platform, accountId: message.accountId });

  if (matches.length === 0) {
    // An event for an account nobody has connected. Filing it against a guessed
    // genome would be worse than dropping it.
    console.warn('[warn] engage webhook: event for an unconnected account', {
      platform: message.platform,
      accountId: message.accountId,
    });
    return false;
  }

  if (matches.length > 1) {
    // See the header: there is no defensible choice here, and the wrong one is
    // a cross-tenant leak of somebody's private message.
    console.error('[error] engage webhook: account maps to several genomes — dropping the event', {
      platform: message.platform,
      accountId: message.accountId,
      genomes: matches.length,
    });
    return false;
  }

  const { orgId, genomeId } = matches[0]!;
  const brandId = await deps.brandForGenome(genomeId, orgId);
  if (!brandId) {
    console.warn('[warn] engage webhook: genome has no brand', { genomeId });
    return false;
  }

  const ctx = await deps.systemCtx({ orgId, brandId, genomeId });

  const result = await invokeTool(
    {
      tool: 'engage.ingest',
      input: {
        genomeId,
        platform: message.platform,
        externalId: message.externalId,
        kind: message.kind,
        authorHandle: message.authorHandle,
        ...(message.authorName ? { authorName: message.authorName } : {}),
        text: message.text,
        ...(message.receivedAt ? { receivedAt: message.receivedAt } : {}),
        ...(message.threadKey ? { threadKey: message.threadKey } : {}),
      },
      /**
       * `agent`, not `user`. Unlike `whatsapp.receive` — where the words are the
       * *owner's* and the tool is `human_only` — the words here belong to a
       * member of the public, and recording them is the system's action, not
       * theirs. Declaring `user` would claim a person on this account did it.
       */
      caller: 'agent',
      ctx,
      brand: await deps.loadBrandGovernance(orgId, brandId),
      /**
       * The platform's own id for the message. Redelivery is normal — Meta
       * retries, and the aggregator replays — so this is what makes a repeat a
       * replay rather than a second row in somebody's inbox.
       */
      idempotencyKey: `engage:${message.platform}:${message.externalId}`,
    },
    deps.invokeDeps,
  );

  if (result.status === 'failed') {
    console.warn('[warn] engage webhook: engage.ingest refused a message', {
      platform: message.platform,
      externalId: message.externalId,
      code: result.error.code,
    });
    return false;
  }

  return true;
}

/* ── parsers ─────────────────────────────────────────────────────────────── */

/**
 * Meta's envelope → the normalized shape.
 *
 * Deliberately total: anything unrecognised yields nothing rather than throwing.
 * The payload shape is Meta's to change, and since they disable webhooks that
 * keep erroring, a new field appearing must not be able to take the endpoint
 * down — that would mean losing inbound messages entirely.
 */
export function parseMeta(raw: string): InboundEngagement[] {
  const payload = parseJson(raw);
  const out: InboundEngagement[] = [];

  for (const entry of asArray((payload as { entry?: unknown[] })?.entry)) {
    // `entry.id` is the ig-user-id the subscription belongs to — the account the
    // event happened on, and the join key back to a genome.
    const accountId = str((entry as { id?: unknown })?.id);

    /* Comments and mentions arrive as `changes`. */
    for (const change of asArray((entry as { changes?: unknown[] })?.changes)) {
      const c = change as { field?: string; value?: Record<string, unknown> };
      const v = c.value ?? {};
      const id = str(v['id']);
      const text = str(v['text']);
      if (!id || !text) continue;

      const from = v['from'] as { id?: string; username?: string } | undefined;
      out.push({
        accountId: accountId || str((v['media'] as { id?: string } | undefined)?.id),
        platform: 'instagram',
        externalId: id,
        kind: 'comment',
        // A username is what a person recognises in the inbox; the numeric id is
        // the fallback so an author is never blank.
        authorHandle: from?.username ?? from?.id ?? 'unknown',
        ...(from?.username ? { authorName: from.username } : {}),
        text,
        ...(str(v['timestamp']) ? { receivedAt: isoOrUndefined(v['timestamp']) } : {}),
        // Instagram threads comment replies under the parent; absent means
        // `deriveThreadKey` decides, which always includes the author.
        ...(str((v['parent_id'] as unknown)) ? { threadKey: str(v['parent_id']) } : {}),
      });
    }

    /* DMs and story replies arrive as `messaging`. */
    for (const event of asArray((entry as { messaging?: unknown[] })?.messaging)) {
      const e = event as {
        sender?: { id?: string };
        recipient?: { id?: string };
        timestamp?: number;
        message?: { mid?: string; text?: string; is_echo?: boolean; reply_to?: { story?: unknown } };
      };
      const mid = str(e.message?.mid);
      const text = str(e.message?.text);
      if (!mid || !text) continue;
      // An echo is the brand's own outbound message coming back. Ingesting it
      // would put our own replies in the inbox as if a customer sent them.
      if (e.message?.is_echo) continue;

      out.push({
        // The *recipient* is the brand here — the sender is the member of the
        // public. Getting this backwards would look up a genome by the
        // commenter's id and find nothing, silently.
        accountId: str(e.recipient?.id) || accountId,
        platform: 'instagram',
        externalId: mid,
        kind: e.message?.reply_to?.story ? 'story_reply' : 'dm',
        authorHandle: str(e.sender?.id) || 'unknown',
        text,
        ...(typeof e.timestamp === 'number' ? { receivedAt: new Date(e.timestamp).toISOString() } : {}),
        // A DM conversation is genuinely per-participant, so the sender id is a
        // sound thread key and better than deriving one.
        ...(str(e.sender?.id) ? { threadKey: `dm:${str(e.sender?.id)}` } : {}),
      });
    }
  }

  return out.filter((m) => m.accountId);
}

const PLATFORMS = new Set(['instagram', 'tiktok', 'linkedin', 'x', 'youtube_shorts']);
const KINDS = new Set(['comment', 'dm', 'story_reply']);

/**
 * The aggregator's envelope → the normalized shape.
 *
 * Relays in this class send one event per request or a batch under `data`, and
 * name the platform in the body rather than in the route. Both are accepted;
 * anything whose platform or kind is not one of the five the inbox models is
 * skipped rather than coerced — an unrecognised value guessed into `comment`
 * would show a person a message that says something it does not.
 */
export function parseAggregator(raw: string): InboundEngagement[] {
  const payload = parseJson(raw);
  const events = Array.isArray((payload as { data?: unknown[] })?.data)
    ? ((payload as { data: unknown[] }).data)
    : [payload];

  const out: InboundEngagement[] = [];
  for (const event of events) {
    const e = (event ?? {}) as Record<string, unknown>;

    const platform = str(e['platform']).toLowerCase();
    const kind = normaliseKind(str(e['type']) || str(e['kind']));
    const accountId = str(e['profileKey']) || str(e['accountId']) || str(e['socialId']);
    const externalId = str(e['id']) || str(e['commentId']) || str(e['messageId']);
    const text = str(e['text']) || str(e['comment']) || str(e['message']);

    if (!PLATFORMS.has(platform) || !kind || !accountId || !externalId || !text) continue;

    const handle = str(e['authorHandle']) || str(e['username']) || str(e['from']);
    out.push({
      accountId,
      platform: platform as InboundEngagement['platform'],
      externalId,
      kind,
      authorHandle: handle || 'unknown',
      ...(str(e['authorName']) ? { authorName: str(e['authorName']) } : {}),
      text,
      ...(isoOrUndefined(e['created']) ? { receivedAt: isoOrUndefined(e['created']) } : {}),
      ...(str(e['threadId']) ? { threadKey: str(e['threadId']) } : {}),
    });
  }
  return out;
}

function normaliseKind(raw: string): InboundEngagement['kind'] | undefined {
  const v = raw.toLowerCase();
  if (KINDS.has(v)) return v as InboundEngagement['kind'];
  // The spellings these relays actually use for the same three things.
  if (v === 'message' || v === 'direct_message') return 'dm';
  if (v === 'story' || v === 'story_mention') return 'story_reply';
  return undefined;
}

/* ── signatures ──────────────────────────────────────────────────────────── */

/** Meta's `sha256=<hex>` HMAC over the raw body. */
export function verifyMetaSignature(raw: string, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  return safeEqual(header.slice('sha256='.length), createHmac('sha256', appSecret).update(raw, 'utf8').digest('hex'));
}

/**
 * A bare hex HMAC over the raw body, with the `sha256=` prefix tolerated.
 *
 * The relays disagree about the prefix. Stripping it costs nothing and the
 * alternative is an inbox that silently accepts nothing.
 */
export function verifyHexSignature(raw: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const offered = header.startsWith('sha256=') ? header.slice('sha256='.length) : header;
  return safeEqual(offered, createHmac('sha256', secret).update(raw, 'utf8').digest('hex'));
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // `timingSafeEqual` throws on a length mismatch, which would itself leak the
  // length — so lengths are compared first and the answer is `false` either way.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/* ── small helpers ───────────────────────────────────────────────────────── */

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/**
 * A timestamp in whatever the source sent — ISO string, or seconds/milliseconds
 * since the epoch. Returns undefined rather than an invalid date, because
 * `engage.ingest` validates `receivedAt` as a datetime and would reject the
 * whole message over a malformed one; absent just means "now".
 */
function isoOrUndefined(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const parsed = new Date(v);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  if (typeof v === 'number') {
    // Seconds vs milliseconds: anything below ~1e12 is seconds, which covers
    // every plausible date until the year 33658.
    const ms = v < 1e12 ? v * 1000 : v;
    const parsed = new Date(ms);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  return undefined;
}
