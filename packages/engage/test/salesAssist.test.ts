import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@sparksocial/tools';
import { makeEngageClassify } from '../src/classify.js';
import { engageOpportunityCreate } from '../src/opportunity.js';
import { matchEscalationKeyword } from '../src/escalation.js';
import type { EngagementClassifier } from '../src/classifier.js';

/**
 * SALES ASSIST (`Settings WS EI Sales`) — the settings screen that had nowhere
 * to store anything and nothing that obeyed it.
 *
 * Two behaviours make the screen mean something, and both were sentences on a
 * mockup before this:
 *
 *  - "Messages containing these will always be escalated" — a deterministic
 *    override of the classifier, not a line in its prompt.
 *  - "Hot → Send to CRM + notify me" — applied when a lead is raised, rather
 *    than waiting for somebody to call `.route` by hand.
 */

const MESSAGE = {
  id: 'msg_1',
  genomeId: 'gen_1',
  platform: 'instagram',
  externalId: 'ext_1',
  kind: 'dm',
  authorHandle: '@a_follower',
  text: 'I want a refund for last week',
  intentScore: 0.8,
  category: 'sales_opportunity',
  receivedAt: new Date('2026-01-01T00:00:00Z'),
  status: 'classified',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const GENOME = { identity: { business_name: 'Emeka Cuts', category: 'barbershop', one_liner: 'fades done right' } };

interface Brand {
  salesEscalationKeywords?: string[];
  salesHandoff?: Record<string, string>;
  salesDestination?: string;
}

function ctx(
  over: { brand?: Brand; noBrandId?: boolean; message?: Partial<typeof MESSAGE>; routed?: string[]; classified?: unknown[] } = {},
): ToolCtx {
  const message = { ...MESSAGE, ...over.message };
  return {
    orgId: 'org_1',
    genomeId: 'gen_1',
    ...(over.noBrandId ? {} : { brandId: 'brand_1' }),
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      brands: { get: async () => over.brand ?? {} },
      genomes: { get: async () => GENOME },
      engagement: {
        get: async () => message,
        classify: async (args: { category: string; intentScore: number; suggestedReply?: string }) => {
          over.classified?.push(args);
          return { ...message, ...args };
        },
      },
      opportunities: {
        create: async () => ({ id: 'opp_1', inboxItemId: message.id }),
        route: async (args: { routedTo: string }) => {
          over.routed?.push(args.routedTo);
          return { id: 'opp_1', routedTo: args.routedTo };
        },
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
}

function stubClassifier(over: Partial<{ category: string; suggestedReply: string }> = {}) {
  return {
    classify: vi.fn(async () => ({
      category: (over.category ?? 'auto_handled') as 'auto_handled',
      intentScore: 0.8,
      suggestedReply: over.suggestedReply ?? 'Happy to help!',
      reason: 'Sounds routine.',
    })),
  } as unknown as EngagementClassifier;
}

/* ── the escalation matcher ──────────────────────────────────────────────── */

describe('matchEscalationKeyword', () => {
  const list = ['refund', 'lawsuit', 'charge back'];

  it('finds a keyword regardless of case', () => {
    expect(matchEscalationKeyword('I want a REFUND now', list)).toBe('refund');
  });

  it('matches a multi-word entry as a phrase', () => {
    // "charge back" is a thing an owner will reasonably want on the list.
    expect(matchEscalationKeyword('I will charge back the payment', list)).toBe('charge back');
  });

  it('matches next to punctuation', () => {
    expect(matchEscalationKeyword('refund!', list)).toBe('refund');
    expect(matchEscalationKeyword('(lawsuit)', list)).toBe('lawsuit');
  });

  it('does not fire on a word that merely contains a keyword', () => {
    // The trap that makes substring matching unusable here: a rule that fires on
    // unrelated words teaches the owner to shorten the list, which costs the
    // real matches.
    expect(matchEscalationKeyword('the kids scampered off', ['scam'])).toBeUndefined();
    expect(matchEscalationKeyword('refundable deposit', list)).toBeUndefined();
  });

  it('still matches a plural, which is the same complaint', () => {
    expect(matchEscalationKeyword('do you do refunds', ['refunds'])).toBe('refunds');
  });

  it('is a no-op for a brand that has configured nothing', () => {
    expect(matchEscalationKeyword('I want a refund', undefined)).toBeUndefined();
    expect(matchEscalationKeyword('I want a refund', [])).toBeUndefined();
  });

  it('survives a keyword containing regex punctuation', () => {
    // An owner may well type this. It must not throw.
    expect(matchEscalationKeyword('is this a scam?', ['scam?'])).toBe('scam?');
    expect(() => matchEscalationKeyword('anything', ['('])).not.toThrow();
  });

  it('names the first match, so the why can say which word did it', () => {
    // "This was escalated" is not actionable. "It says refund" tells the owner
    // what happened and how to change it.
    expect(matchEscalationKeyword('refund or lawsuit', list)).toBe('refund');
  });
});

/* ── the classifier override ─────────────────────────────────────────────── */

describe('engage.classify honours the escalation list', () => {
  it('forces needs_review whatever the classifier said', async () => {
    const classified: Array<{ category: string }> = [];
    const tool = makeEngageClassify({ classifier: stubClassifier({ category: 'auto_handled' }) });

    const out = await tool.handler(
      { genomeId: 'gen_1', messageId: 'msg_1' },
      ctx({ brand: { salesEscalationKeywords: ['refund'] }, classified }),
    );

    expect(out.category).toBe('needs_review');
    // Written, not just returned: the feed reads the stored row.
    expect(classified[0]!.category).toBe('needs_review');
  });

  it('withholds the suggested reply on an escalated message', async () => {
    // Offering one next to "a person must handle this" invites exactly the
    // one-click send the escalation exists to prevent.
    const classified: Array<{ suggestedReply?: string }> = [];
    const tool = makeEngageClassify({ classifier: stubClassifier({ suggestedReply: 'No refunds, sorry!' }) });

    const out = await tool.handler(
      { genomeId: 'gen_1', messageId: 'msg_1' },
      ctx({ brand: { salesEscalationKeywords: ['refund'] }, classified }),
    );

    expect(out.suggestedReply).toBeUndefined();
    expect(classified[0]!.suggestedReply).toBeUndefined();
  });

  it('still runs the classifier, so the triage view keeps its reasoning', async () => {
    // Short-circuiting before the model would save a call and lose the intent
    // score and the reason, both of which the person triaging still wants.
    const classifier = stubClassifier({ category: 'auto_handled' });
    const tool = makeEngageClassify({ classifier });

    const out = await tool.handler(
      { genomeId: 'gen_1', messageId: 'msg_1' },
      ctx({ brand: { salesEscalationKeywords: ['refund'] } }),
    );

    expect((classifier as unknown as { classify: { mock: unknown } }).classify).toHaveBeenCalledOnce();
    expect(out.intentScore).toBe(0.8);
    expect(out.why.summary).toMatch(/refund/);
    expect(out.why.summary).toMatch(/Sounds routine/);
    // The overridden category is named as the alternative, so the decision is legible.
    expect(out.why.alternatives[0]!.option).toBe('auto_handled');
  });

  it('leaves a message alone when no keyword matches', async () => {
    const tool = makeEngageClassify({ classifier: stubClassifier({ category: 'auto_handled' }) });

    const out = await tool.handler(
      { genomeId: 'gen_1', messageId: 'msg_1' },
      ctx({ brand: { salesEscalationKeywords: ['lawsuit'] }, message: { text: 'love your work' } }),
    );

    expect(out.category).toBe('auto_handled');
    expect(out.why.alternatives).toEqual([]);
  });

  it('leaves a brand with no list configured entirely unaffected', async () => {
    const tool = makeEngageClassify({ classifier: stubClassifier({ category: 'auto_handled' }) });

    const out = await tool.handler({ genomeId: 'gen_1', messageId: 'msg_1' }, ctx({ brand: {} }));

    expect(out.category).toBe('auto_handled');
  });
});

/* ── the handoff rule ────────────────────────────────────────────────────── */

describe('engage.opportunity.create honours the handoff rule', () => {
  const input = { genomeId: 'gen_1', messageId: 'msg_1', temperature: 'hot' as const, recommendedAction: 'Call them' };

  it('sends a hot lead to the configured destination', async () => {
    // "Hot → Send to CRM + notify me" was a sentence on a settings screen and
    // nothing else: a raised opportunity always sat unrouted until somebody
    // called `.route` by hand.
    const routed: string[] = [];
    const out = await engageOpportunityCreate.handler(
      input,
      ctx({ brand: { salesDestination: 'sales@clientforce.ai' }, routed }),
    );

    expect(routed).toEqual(['sales@clientforce.ai']);
    expect(out.routedTo).toBe('sales@clientforce.ai');
    expect(out.handoff).toBe('crm_notify');
  });

  it('does not route when the brand keeps that temperature in the tab', async () => {
    const routed: string[] = [];
    const out = await engageOpportunityCreate.handler(input, {
      ...ctx({
        brand: {
          salesHandoff: { hot: 'save_notify', warm: 'save_notify', cold: 'nurture_only' },
          salesDestination: 'sales@clientforce.ai',
        },
        routed,
      }),
    });

    expect(routed).toEqual([]);
    expect(out.routedTo).toBeUndefined();
    expect(out.handoff).toBe('save_notify');
  });

  it('does not route a crm_notify lead with no destination set', async () => {
    // Writing "crm_notify" into `routed_to` would look like a real destination
    // in the Sales Opportunities tab while meaning nothing.
    const routed: string[] = [];
    const out = await engageOpportunityCreate.handler(input, ctx({ brand: {}, routed }));

    expect(routed).toEqual([]);
    expect(out.routedTo).toBeUndefined();
    expect(out.handoff).toBe('crm_notify');
  });

  it('applies the defaults, and says it did', async () => {
    const out = await engageOpportunityCreate.handler(
      { ...input, temperature: 'cold' },
      ctx({ brand: { salesDestination: 'sales@clientforce.ai' } }),
    );

    expect(out.handoff).toBe('nurture_only');
    expect(out.why.factors.some((f) => f.detail?.includes('has not set its own handoff rules'))).toBe(true);
  });

  it('names the rule that applied in the why', async () => {
    // Invariant 4: routing a lead is a decision a user sees SPARK make.
    const out = await engageOpportunityCreate.handler(
      input,
      ctx({ brand: { salesDestination: 'sales@clientforce.ai' } }),
    );

    expect(out.why.summary).toMatch(/sales@clientforce\.ai/);
    expect(out.why.factors.some((f) => f.label === 'Handoff rule: crm_notify')).toBe(true);
  });

  it('works without a brand in context at all', async () => {
    // The agent can raise an opportunity in a ctx with no brand resolved. It
    // must fall back rather than throw.
    const out = await engageOpportunityCreate.handler(input, ctx({ noBrandId: true }));

    expect(out.handoff).toBe('crm_notify');
    expect(out.routedTo).toBeUndefined();
  });
});
