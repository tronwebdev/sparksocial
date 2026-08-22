import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { defineTool, register, __resetRegistry } from '@sparksocial/tools';
import { memoryInvokeDeps } from '../src/app.js';
import {
  describeEngageWebhook,
  parseAggregator,
  parseMeta,
  registerEngageWebhook,
  verifyHexSignature,
  verifyMetaSignature,
} from '../src/engage-webhook.js';

/**
 * THE ENGAGEMENT WEBHOOK — the writer `engage.ingest` never had.
 *
 * `engage.ingest` was built against a normalized shape with a note saying the
 * real platform webhooks were "a separate piece behind this seam". Until this
 * route existed the engagement inbox could only be filled by a test.
 *
 * Three things are worth pinning, in descending order of how much damage
 * getting them wrong does:
 *
 *  1. **The signature.** These endpoints are unauthenticated by necessity, and
 *     the inbox drives replies that can be sent automatically under
 *     `engagementAutonomy: 'auto'`. A forged comment is a path to making the
 *     brand say something.
 *  2. **Tenant resolution.** A webhook knows an account, not a genome. When one
 *     account resolves to two genomes, picking one files a customer's private DM
 *     into another customer's inbox.
 *  3. **Parsing.** Meta will change their payload, and they disable webhooks
 *     that keep erroring — so an unrecognised shape has to yield nothing rather
 *     than throw.
 */

const META_SECRET = 'meta-app-secret';
const AGG_SECRET = 'aggregator-secret';

const signMeta = (body: string, secret = META_SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
const signHex = (body: string, secret = AGG_SECRET) =>
  createHmac('sha256', secret).update(body, 'utf8').digest('hex');

/* ── payload builders ────────────────────────────────────────────────────── */

const metaComment = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    entry: [
      {
        id: 'ig_account_1',
        changes: [
          {
            field: 'comments',
            value: {
              id: 'comment_1',
              text: 'how much for the skin fade?',
              from: { id: '99', username: 'ada_o' },
              timestamp: '2026-08-20T10:00:00Z',
              ...over,
            },
          },
        ],
      },
    ],
  });

const metaDm = (message: Record<string, unknown> = {}) =>
  JSON.stringify({
    entry: [
      {
        id: 'ig_account_1',
        messaging: [
          {
            sender: { id: 'sender_7' },
            recipient: { id: 'ig_account_1' },
            timestamp: 1_755_000_000_000,
            message: { mid: 'mid_1', text: 'are you open sunday?', ...message },
          },
        ],
      },
    ],
  });

const aggregatorEvent = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    platform: 'instagram',
    type: 'comment',
    profileKey: 'ig_account_1',
    id: 'agg_comment_1',
    text: 'do you do beard trims',
    username: 'kofi',
    created: '2026-08-20T10:00:00Z',
    ...over,
  });

/* ── the harness ─────────────────────────────────────────────────────────── */

function fakeIngest(opts: { throws?: boolean } = {}) {
  const seen: Array<Record<string, unknown>> = [];
  const tool = defineTool({
    name: 'engage.ingest',
    version: 1,
    summary: 'fake engage.ingest for engage-webhook tests',
    input: z.object({
      genomeId: z.string(),
      platform: z.string(),
      externalId: z.string(),
      kind: z.string(),
      authorHandle: z.string(),
      authorName: z.string().optional(),
      text: z.string(),
      receivedAt: z.string().optional(),
      threadKey: z.string().optional(),
    }),
    output: z.object({ id: z.string(), status: z.string() }),
    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: true,
    async handler(input) {
      if (opts.throws) throw new Error('the inbox is on fire');
      seen.push(input);
      return { id: `msg_${seen.length}`, status: 'new' };
    },
  });
  return { tool, seen };
}

function harness(over: Partial<Parameters<typeof registerEngageWebhook>[1]> = {}) {
  const app = new Hono();
  const invoke = memoryInvokeDeps();

  registerEngageWebhook(app, {
    metaAppSecret: META_SECRET,
    metaVerifyToken: 'verify-me',
    aggregatorSecret: AGG_SECRET,
    invokeDeps: invoke,
    loadBrandGovernance: async () => ({
      createdAt: new Date('2026-01-01T00:00:00Z'),
      approvalMode: 'autopublish' as const,
      agentPaused: false,
    }),
    lookupAccount: async () => [{ orgId: 'org_1', genomeId: 'gen_1' }],
    brandForGenome: async () => 'brand_1',
    systemCtx: async ({ orgId, genomeId }) =>
      ({
        orgId,
        genomeId,
        role: 'admin',
        approvalMode: 'autopublish',
        budget: { remainingCents: 10_000, monthlyCapCents: 10_000 },
        db: {} as never,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
      }) as never,
    ...over,
  });

  return { app, invoke };
}

const post = (app: Hono, path: string, body: string, headers: Record<string, string>) =>
  app.request(path, { method: 'POST', body, headers });

/* ── 1. the signature ────────────────────────────────────────────────────── */

describe('signature verification', () => {
  it('accepts a correctly signed Meta body', () => {
    const body = metaComment();
    expect(verifyMetaSignature(body, signMeta(body), META_SECRET)).toBe(true);
  });

  it('rejects a body signed with the wrong secret', () => {
    const body = metaComment();
    expect(verifyMetaSignature(body, signMeta(body, 'not-the-secret'), META_SECRET)).toBe(false);
  });

  it('rejects a missing or unprefixed Meta signature', () => {
    const body = metaComment();
    expect(verifyMetaSignature(body, undefined, META_SECRET)).toBe(false);
    expect(verifyMetaSignature(body, signMeta(body).slice('sha256='.length), META_SECRET)).toBe(false);
  });

  it('rejects a body that changed by one character', () => {
    // The point of signing the raw bytes: this is what a tampered comment looks
    // like, and it must not be a near-miss that leaks how close it was.
    const body = metaComment();
    expect(verifyMetaSignature(`${body} `, signMeta(body), META_SECRET)).toBe(false);
  });

  it('accepts the aggregator’s bare hex signature, with or without the prefix', () => {
    // The relays in this class disagree about the prefix; refusing one spelling
    // gives a silently dead inbox that looks exactly like a quiet one.
    const body = aggregatorEvent();
    expect(verifyHexSignature(body, signHex(body), AGG_SECRET)).toBe(true);
    expect(verifyHexSignature(body, `sha256=${signHex(body)}`, AGG_SECRET)).toBe(true);
    expect(verifyHexSignature(body, 'deadbeef', AGG_SECRET)).toBe(false);
  });
});

describe('the routes refuse unsigned writes', () => {
  beforeEach(() => __resetRegistry());

  it('403s a Meta request with a bad signature, and ingests nothing', async () => {
    const ingest = fakeIngest();
    register(ingest.tool);
    const { app } = harness();
    const body = metaComment();

    const res = await post(app, '/v1/webhooks/engage/meta', body, {
      'x-hub-signature-256': signMeta(body, 'wrong'),
      'content-type': 'application/json',
    });

    expect(res.status).toBe(403);
    expect(ingest.seen).toHaveLength(0);
  });

  it('says nothing useful in the 403 body', async () => {
    // A body distinguishing "missing" from "wrong" is a free oracle for anyone
    // probing the endpoint.
    const { app } = harness();
    const missing = await post(app, '/v1/webhooks/engage/meta', metaComment(), {});
    const wrong = await post(app, '/v1/webhooks/engage/meta', metaComment(), {
      'x-hub-signature-256': signMeta('something else'),
    });

    expect(await missing.text()).toBe(await wrong.text());
  });

  it('403s an aggregator request with a bad signature', async () => {
    const ingest = fakeIngest();
    register(ingest.tool);
    const { app } = harness();

    const res = await post(app, '/v1/webhooks/engage/aggregator', aggregatorEvent(), {
      'x-ayrshare-signature': 'nope',
    });

    expect(res.status).toBe(403);
    expect(ingest.seen).toHaveLength(0);
  });

  it('accepts either header spelling the relays use', async () => {
    const ingest = fakeIngest();
    register(ingest.tool);
    const { app } = harness();

    // Distinct ids per request. The same body twice is correctly *replayed* by
    // the idempotency key, which would hide whether the second header worked.
    for (const [i, header] of ['x-ayrshare-signature', 'x-webhook-signature'].entries()) {
      const body = aggregatorEvent({ id: `agg_comment_${i}` });
      const res = await post(app, '/v1/webhooks/engage/aggregator', body, { [header]: signHex(body) });
      expect(res.status).toBe(200);
    }
    expect(ingest.seen.map((m) => m.externalId)).toEqual(['agg_comment_0', 'agg_comment_1']);
  });

  it('does not register a route whose secret is absent', async () => {
    // An endpoint that accepts unsigned writes is worse than a missing one: the
    // missing one fails visibly during setup.
    const app = new Hono();
    registerEngageWebhook(app, {
      aggregatorSecret: AGG_SECRET,
      invokeDeps: memoryInvokeDeps(),
      loadBrandGovernance: async () => ({ createdAt: new Date(0), approvalMode: 'autopublish', agentPaused: false }),
      lookupAccount: async () => [],
      brandForGenome: async () => 'brand_1',
      systemCtx: async () => ({}) as never,
    });

    const res = await post(app, '/v1/webhooks/engage/meta', metaComment(), {});
    expect(res.status).toBe(404);
  });

  it('reports which routes are live, so a silent inbox is visible at boot', () => {
    expect(describeEngageWebhook({ metaAppSecret: 'x', aggregatorSecret: 'y' })).toBe('meta, aggregator');
    expect(describeEngageWebhook({ aggregatorSecret: 'y' })).toBe('aggregator');
    expect(describeEngageWebhook({})).toMatch(/no writer/);
  });
});

describe('Meta’s subscription handshake', () => {
  it('echoes the challenge when the verify token matches', async () => {
    const { app } = harness();
    const res = await app.request(
      '/v1/webhooks/engage/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345',
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('12345');
  });

  it('refuses a wrong verify token', async () => {
    const { app } = harness();
    const res = await app.request(
      '/v1/webhooks/engage/meta?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=12345',
    );

    expect(res.status).toBe(403);
  });
});

/* ── 2. tenant resolution ────────────────────────────────────────────────── */

describe('tenant resolution', () => {
  beforeEach(() => __resetRegistry());

  const send = (app: Hono, body = metaComment()) =>
    post(app, '/v1/webhooks/engage/meta', body, { 'x-hub-signature-256': signMeta(body) });

  it('files the message against the genome the account resolves to', async () => {
    const ingest = fakeIngest();
    register(ingest.tool);
    const { app, invoke } = harness();

    await send(app);

    expect(ingest.seen[0]!.genomeId).toBe('gen_1');
    expect(invoke.rows[0]!.orgId).toBe('org_1');
  });

  it('looks the account up by the platform it came from', async () => {
    const ingest = fakeIngest();
    register(ingest.tool);
    const asked: unknown[] = [];
    const { app } = harness({
      lookupAccount: async (args) => {
        asked.push(args);
        return [{ orgId: 'org_1', genomeId: 'gen_1' }];
      },
    });

    await send(app);

    expect(asked[0]).toEqual({ provider: 'instagram', accountId: 'ig_account_1' });
  });

  it('drops an event for an account nobody has connected', async () => {
    // Filing it against a guessed genome would be worse than losing it.
    const ingest = fakeIngest();
    register(ingest.tool);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app } = harness({ lookupAccount: async () => [] });

    const res = await send(app);
    warn.mockRestore();

    expect(res.status).toBe(200);
    expect(ingest.seen).toHaveLength(0);
  });

  it('refuses to choose when one account maps to two genomes', async () => {
    // THE test in this file. An agency can connect the same client's Instagram
    // twice; picking one files a customer's private message into another
    // customer's inbox. Losing a comment is recoverable, leaking one is not.
    const ingest = fakeIngest();
    register(ingest.tool);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app } = harness({
      lookupAccount: async () => [
        { orgId: 'org_1', genomeId: 'gen_1' },
        { orgId: 'org_2', genomeId: 'gen_2' },
      ],
    });

    const res = await send(app);
    const logged = error.mock.calls.map((c) => String(c[0])).join(' ');
    error.mockRestore();

    expect(res.status).toBe(200);
    expect(ingest.seen).toHaveLength(0);
    // Silently dropping would be indistinguishable from a quiet week.
    expect(logged).toMatch(/several genomes/i);
  });

  it('drops a message whose genome has no brand', async () => {
    const ingest = fakeIngest();
    register(ingest.tool);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app } = harness({ brandForGenome: async () => undefined });

    await send(app);
    warn.mockRestore();

    expect(ingest.seen).toHaveLength(0);
  });

  it('keys on the platform’s own message id, so a redelivery is a replay', async () => {
    const ingest = fakeIngest();
    register(ingest.tool);
    const { app, invoke } = harness();

    await send(app);

    expect(invoke.rows[0]!.idempotencyKey).toBe('engage:instagram:comment_1');
  });

  it('records the ingest as the system’s action, not the commenter’s', async () => {
    // Unlike `whatsapp.receive`, where the words are the owner's, these words
    // belong to a member of the public. Declaring `user` would claim somebody
    // on this account did it.
    const ingest = fakeIngest();
    register(ingest.tool);
    const { app, invoke } = harness();

    await send(app);

    expect(invoke.rows[0]!.caller).toBe('agent');
  });

  it('acknowledges even when the ingest throws', async () => {
    // Platforms retry non-2xx and eventually disable a webhook that keeps
    // failing. Losing the integration costs more than losing one message.
    const ingest = fakeIngest({ throws: true });
    register(ingest.tool);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app } = harness();

    const res = await send(app);
    warn.mockRestore();

    expect(res.status).toBe(200);
  });
});

/* ── 3. parsing ──────────────────────────────────────────────────────────── */

describe('parseMeta', () => {
  it('reads a comment, preferring the username a person would recognise', () => {
    const [message] = parseMeta(metaComment());

    expect(message).toMatchObject({
      accountId: 'ig_account_1',
      platform: 'instagram',
      externalId: 'comment_1',
      kind: 'comment',
      authorHandle: 'ada_o',
      text: 'how much for the skin fade?',
    });
  });

  it('falls back to the author id rather than leaving the author blank', () => {
    const [message] = parseMeta(metaComment({ from: { id: '99' } }));
    expect(message!.authorHandle).toBe('99');
  });

  it('reads a DM, taking the brand from the recipient and the author from the sender', () => {
    // Getting this backwards looks up a genome by the *commenter's* id, finds
    // nothing, and drops every DM silently.
    const [message] = parseMeta(metaDm());

    expect(message).toMatchObject({
      accountId: 'ig_account_1',
      kind: 'dm',
      authorHandle: 'sender_7',
      text: 'are you open sunday?',
      threadKey: 'dm:sender_7',
    });
  });

  it('marks a story reply as one', () => {
    const [message] = parseMeta(metaDm({ reply_to: { story: { id: 's1' } } }));
    expect(message!.kind).toBe('story_reply');
  });

  it('skips the brand’s own outbound message coming back', () => {
    // An echo ingested would put our own replies in the inbox as if a customer
    // had sent them — and the classifier would then score them.
    expect(parseMeta(metaDm({ is_echo: true }))).toHaveLength(0);
  });

  it('yields nothing rather than throwing on anything unrecognised', () => {
    // Meta will change this payload, and they disable webhooks that keep
    // erroring — so a new shape must not be able to take the endpoint down.
    for (const body of ['', 'not json', '{}', '{"entry":"nope"}', '{"entry":[{}]}']) {
      expect(parseMeta(body)).toEqual([]);
    }
  });

  it('skips an event with no text — a like has nothing to reply to', () => {
    expect(parseMeta(metaComment({ text: undefined }))).toHaveLength(0);
  });

  it('normalises Meta’s millisecond timestamp', () => {
    const [message] = parseMeta(metaDm());
    expect(message!.receivedAt).toBe(new Date(1_755_000_000_000).toISOString());
  });
});

describe('parseAggregator', () => {
  it('reads a single event', () => {
    const [message] = parseAggregator(aggregatorEvent());

    expect(message).toMatchObject({
      accountId: 'ig_account_1',
      platform: 'instagram',
      externalId: 'agg_comment_1',
      kind: 'comment',
      authorHandle: 'kofi',
    });
  });

  it('reads a batch under data', () => {
    const body = JSON.stringify({
      data: [JSON.parse(aggregatorEvent()), JSON.parse(aggregatorEvent({ id: 'agg_comment_2' }))],
    });

    expect(parseAggregator(body).map((m) => m.externalId)).toEqual(['agg_comment_1', 'agg_comment_2']);
  });

  it('accepts the spellings these relays use for the same three kinds', () => {
    expect(parseAggregator(aggregatorEvent({ type: 'message' }))[0]!.kind).toBe('dm');
    expect(parseAggregator(aggregatorEvent({ type: 'direct_message' }))[0]!.kind).toBe('dm');
    expect(parseAggregator(aggregatorEvent({ type: 'story_mention' }))[0]!.kind).toBe('story_reply');
    expect(parseAggregator(aggregatorEvent({ type: 'dm' }))[0]!.kind).toBe('dm');
  });

  it('skips an event whose kind it does not model, rather than guessing', () => {
    // Coercing an unknown type into `comment` would show a person a message
    // labelled as something it is not.
    expect(parseAggregator(aggregatorEvent({ type: 'like' }))).toHaveLength(0);
  });

  it('skips a platform the inbox does not model', () => {
    expect(parseAggregator(aggregatorEvent({ platform: 'pinterest' }))).toHaveLength(0);
  });

  it('accepts the several names these relays give the same fields', () => {
    const [message] = parseAggregator(
      JSON.stringify({
        platform: 'tiktok',
        kind: 'comment',
        socialId: 'tt_1',
        commentId: 'c_9',
        comment: 'where is this',
        from: 'someone',
      }),
    );

    expect(message).toMatchObject({
      accountId: 'tt_1',
      platform: 'tiktok',
      externalId: 'c_9',
      text: 'where is this',
      authorHandle: 'someone',
    });
  });

  it('drops an unparseable timestamp instead of the whole message', () => {
    // `engage.ingest` validates `receivedAt` as a datetime and would refuse the
    // message over a malformed one. Absent just means "now".
    const [message] = parseAggregator(aggregatorEvent({ created: 'last tuesday' }));

    expect(message!.receivedAt).toBeUndefined();
    expect(message!.text).toBe('do you do beard trims');
  });

  it('reads a seconds-since-epoch timestamp as seconds', () => {
    const [message] = parseAggregator(aggregatorEvent({ created: 1_755_000_000 }));
    expect(message!.receivedAt).toBe(new Date(1_755_000_000_000).toISOString());
  });

  it('yields nothing rather than throwing on rubbish', () => {
    for (const body of ['', 'not json', '{}', '{"data":[]}']) {
      expect(parseAggregator(body)).toEqual([]);
    }
  });
});
