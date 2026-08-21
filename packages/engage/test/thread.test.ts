import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { engageThread, deriveThreadKey } from '../src/thread.js';
import { engageIngest } from '../src/ingest.js';

/**
 * `engage.thread` — PRD §8.8 / `ENG-02.4`.
 *
 * Two things matter here and neither is the assembly. The first is that the
 * derivation **cannot merge two people**: a fragmented transcript is confusing
 * and a merged one leaks a stranger's words into somebody else's drawer. The
 * second is that a thread carries *both* halves — a transcript missing the
 * outbound turns shows a customer talking to nobody, which is what the feed
 * looked like before `sentReply` existed.
 */

interface Row {
  id: string;
  genomeId: string;
  platform: string;
  externalId: string;
  kind: string;
  authorHandle: string;
  authorName?: string;
  text: string;
  contentItemId?: string;
  receivedAt: Date;
  status: string;
  category?: string;
  intentScore?: number;
  suggestedReply?: string;
  threadKey?: string;
  sentReply?: string;
  sentAt?: Date;
  resolvedAt?: Date;
  createdAt: Date;
}

const row = (over: Partial<Row> = {}): Row => ({
  id: 'm1',
  genomeId: 'gen_1',
  platform: 'instagram',
  externalId: 'ig_1',
  kind: 'dm',
  authorHandle: '@ada',
  text: 'do you deliver?',
  receivedAt: new Date('2026-08-20T10:00:00Z'),
  status: 'new',
  createdAt: new Date('2026-08-20T10:00:00Z'),
  ...over,
});

function ctx(rows: Row[], over: Partial<ToolCtx> = {}): ToolCtx {
  const store = {
    async get(id: string, genomeId: string, orgId: string) {
      return rows.find((r) => r.id === id && r.genomeId === genomeId && orgId === 'org_1');
    },
    async thread(genomeId: string, orgId: string, args: { threadKey: string; limit: number }) {
      return rows
        .filter((r) => r.genomeId === genomeId && orgId === 'org_1' && r.threadKey === args.threadKey)
        .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
        .slice(0, args.limit);
    },
    async ingest(args: Record<string, unknown>) {
      const created = row({ ...args, id: `m${rows.length + 1}` } as Partial<Row>);
      rows.push(created);
      return created;
    },
  };
  return {
    orgId: 'org_1',
    genomeId: 'gen_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: { engagement: store },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    ...over,
  } as unknown as ToolCtx;
}

describe('deriveThreadKey', () => {
  it('never merges two people, whatever else it groups by', () => {
    // The safety property the whole derivation exists to hold.
    const ada = deriveThreadKey({ platform: 'instagram', kind: 'dm', authorHandle: '@ada' });
    const grace = deriveThreadKey({ platform: 'instagram', kind: 'dm', authorHandle: '@grace' });
    expect(ada).not.toBe(grace);
  });

  it('treats a DM conversation as the pair, regardless of post', () => {
    // A DM is not about a post, so including one would split a single
    // conversation the moment the subject changed.
    const a = deriveThreadKey({ platform: 'instagram', kind: 'dm', authorHandle: '@ada' });
    const b = deriveThreadKey({ platform: 'instagram', kind: 'dm', authorHandle: '@ada', contentItemId: 'ci_1' });
    expect(a).toBe(b);
  });

  it('splits comments by post — the same person on two posts is two conversations', () => {
    const one = deriveThreadKey({ platform: 'instagram', kind: 'comment', authorHandle: '@ada', contentItemId: 'ci_1' });
    const two = deriveThreadKey({ platform: 'instagram', kind: 'comment', authorHandle: '@ada', contentItemId: 'ci_2' });
    expect(one).not.toBe(two);
  });

  it('separates the same handle on different platforms', () => {
    const ig = deriveThreadKey({ platform: 'instagram', kind: 'dm', authorHandle: '@ada' });
    const x = deriveThreadKey({ platform: 'x', kind: 'dm', authorHandle: '@ada' });
    expect(ig).not.toBe(x);
  });

  it('normalises the handle, so @Ada and ada are one person', () => {
    // Platforms are inconsistent about the leading @ and about case between
    // webhook shapes; two keys for one person would silently halve a thread.
    const a = deriveThreadKey({ platform: 'instagram', kind: 'dm', authorHandle: '@Ada' });
    const b = deriveThreadKey({ platform: 'instagram', kind: 'dm', authorHandle: ' ada ' });
    expect(a).toBe(b);
  });
});

describe('engage.ingest — threading', () => {
  it('derives a key when the platform gives none', async () => {
    const rows: Row[] = [];
    await engageIngest.handler(
      { genomeId: 'gen_1', platform: 'instagram', externalId: 'ig_9', kind: 'dm', authorHandle: '@ada', text: 'hi' },
      ctx(rows),
    );
    expect(rows[0]!.threadKey).toBe('dm:instagram:ada');
  });

  it("prefers the platform's own conversation id over the derived one", async () => {
    // It knows what a conversation is; the derivation only guesses.
    const rows: Row[] = [];
    await engageIngest.handler(
      {
        genomeId: 'gen_1',
        platform: 'instagram',
        externalId: 'ig_9',
        kind: 'dm',
        authorHandle: '@ada',
        text: 'hi',
        threadKey: 'ig-convo-4471',
      },
      ctx(rows),
    );
    expect(rows[0]!.threadKey).toBe('ig-convo-4471');
  });
});

describe('engage.thread', () => {
  const conversation = (): Row[] => [
    row({ id: 'm1', externalId: 'ig_1', threadKey: 'dm:instagram:ada', text: 'is this available?', receivedAt: new Date('2026-08-20T10:00:00Z'), status: 'replied', sentReply: 'It is — which size?', sentAt: new Date('2026-08-20T10:05:00Z') }),
    row({ id: 'm2', externalId: 'ig_2', threadKey: 'dm:instagram:ada', text: 'large please', receivedAt: new Date('2026-08-20T10:10:00Z'), status: 'classified', category: 'sales_opportunity', intentScore: 0.82 }),
  ];

  it('returns both halves of the exchange, oldest first', async () => {
    // The gap this closes: the outbound half lived only in `tool_calls.input`,
    // which never returns inputs — so a transcript built from the feed showed a
    // customer talking to nobody.
    const out = await engageThread.handler({ genomeId: 'gen_1', messageId: 'm2', limit: 50 }, ctx(conversation()));
    expect(out.turns.map((t) => t.direction)).toEqual(['inbound', 'outbound', 'inbound']);
    expect(out.turns.map((t) => t.text)).toEqual(['is this available?', 'It is — which size?', 'large please']);
  });

  it('finds the conversation from any message in it, not just the first', async () => {
    const fromFirst = await engageThread.handler({ genomeId: 'gen_1', messageId: 'm1', limit: 50 }, ctx(conversation()));
    const fromLast = await engageThread.handler({ genomeId: 'gen_1', messageId: 'm2', limit: 50 }, ctx(conversation()));
    expect(fromFirst.turns.length).toBe(fromLast.turns.length);
  });

  it('counts messages, not turns — they are different numbers', async () => {
    const out = await engageThread.handler({ genomeId: 'gen_1', messageId: 'm1', limit: 50 }, ctx(conversation()));
    expect(out.messageCount).toBe(2);
    expect(out.turns).toHaveLength(3);
  });

  it('places an older reply by resolvedAt when sentAt predates the column', async () => {
    // Otherwise a reply recorded before `sentAt` existed sorts to the epoch and
    // appears above the message it answers.
    const rows = [
      row({
        id: 'm1',
        threadKey: 'dm:instagram:ada',
        receivedAt: new Date('2026-08-20T10:00:00Z'),
        status: 'replied',
        sentReply: 'answered',
        resolvedAt: new Date('2026-08-20T11:00:00Z'),
      }),
    ];
    const out = await engageThread.handler({ genomeId: 'gen_1', messageId: 'm1', limit: 50 }, ctx(rows));
    expect(out.turns[1]!.at).toBe('2026-08-20T11:00:00.000Z');
  });

  it('reports a keyless row as its own conversation rather than guessing one', async () => {
    // Deriving on the fly would return a thread the *store* does not agree this
    // message is in — the read filters on the stored key.
    const out = await engageThread.handler({ genomeId: 'gen_1', messageId: 'm1', limit: 50 }, ctx([row({ id: 'm1' })]));
    expect(out.single).toBe(true);
    expect(out.turns).toHaveLength(1);
    expect(out.why.summary).toMatch(/stands alone/i);
  });

  it('carries the triage verdict on inbound turns only', async () => {
    const out = await engageThread.handler({ genomeId: 'gen_1', messageId: 'm2', limit: 50 }, ctx(conversation()));
    const outbound = out.turns.find((t) => t.direction === 'outbound')!;
    expect(outbound.category).toBeUndefined();
    expect(outbound.intentScore).toBeUndefined();
    expect(out.turns.find((t) => t.text === 'large please')!.intentScore).toBeCloseTo(0.82);
  });

  it('says when it truncated rather than silently dropping the oldest turns', async () => {
    const out = await engageThread.handler({ genomeId: 'gen_1', messageId: 'm1', limit: 1 }, ctx(conversation()));
    expect(out.truncated).toBe(true);
  });

  it('carries a why, because grouping is a rule and not a fact', async () => {
    // §7.3. A merged or fragmented thread looks like data and is a judgement.
    const out = await engageThread.handler({ genomeId: 'gen_1', messageId: 'm1', limit: 50 }, ctx(conversation()));
    expect(out.why.summary).toBeTruthy();
    expect(out.why.factors?.[0]?.label).toBe('grouped by');
  });

  it('404s for a message that is not in this genome', async () => {
    await expect(
      engageThread.handler({ genomeId: 'gen_1', messageId: 'nope', limit: 50 }, ctx(conversation())),
    ).rejects.toThrow(ToolError);
  });

  it('refuses a genome that is not the one selected', async () => {
    await expect(
      engageThread.handler({ genomeId: 'gen_other', messageId: 'm1', limit: 50 }, ctx(conversation())),
    ).rejects.toThrow(ToolError);
  });

  it('is readable by every role the feed is, including client', () => {
    // A thread is the feed's own rows assembled; gating it tighter than the rows
    // it is built from would be theatre.
    expect(engageThread.scopes).toContain('client');
    expect(engageThread.effect).toBe('read');
  });
});
