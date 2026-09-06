import { describe, expect, it } from 'vitest';
import {
  LEAD_TRANSITIONS,
  PROPOSAL_TRANSITIONS,
  canTransitionLead,
  canTransitionProposal,
  isLeadOpen,
  leadDedupeKey,
  proposalTotals,
  Currency,
  ProposalLineItem,
  type LeadStatus,
  type ProposalStatus,
} from '../src/agencyPipeline.js';

/**
 * The agency pipeline's pure rules.
 *
 * These are tested here rather than through the tools because they are the part
 * that must not be re-derived per call site: two places disagreeing about what a
 * contract is worth, or about whether two CSV rows are the same business, is a
 * data-integrity bug rather than a display one.
 */

describe('leadDedupeKey', () => {
  it('prefers email, and normalises case and surrounding space', () => {
    expect(leadDedupeKey({ businessName: 'Joe', email: '  Hello@Example.COM ' })).toBe('email:hello@example.com');
  });

  it('falls back to phone digits when there is no email', () => {
    const a = leadDedupeKey({ businessName: 'Joe', phone: '+1 (555) 010-2030' });
    const b = leadDedupeKey({ businessName: 'Different Name', phone: '15550102030' });
    expect(a).toBe('phone:15550102030');
    expect(a).toBe(b);
  });

  it('ignores a phone too short to be a subscriber number, rather than merging on it', () => {
    /**
     * The failure this prevents: two unrelated businesses whose sheet carries an
     * extension in the phone column collapse into one row, and the second is
     * dropped as a duplicate.
     */
    const key = leadDedupeKey({ businessName: 'Joe Coffee', location: 'Leeds', phone: '4021' });
    expect(key).toBe('name:joe coffee|leeds');
  });

  it('pairs name with location as the last resort, so two same-named businesses stay apart', () => {
    const leeds = leadDedupeKey({ businessName: "Joe's Garage", location: 'Leeds' });
    const lagos = leadDedupeKey({ businessName: "Joe's Garage", location: 'Lagos' });
    expect(leeds).not.toBe(lagos);
  });

  it('collapses whitespace and case in the name+location fallback', () => {
    expect(leadDedupeKey({ businessName: '  Joe   Coffee ', location: ' Leeds  ' })).toBe(
      leadDedupeKey({ businessName: 'joe coffee', location: 'leeds' }),
    );
  });

  it('keys a lead with no email, no phone and no location on the bare name', () => {
    expect(leadDedupeKey({ businessName: 'Solo' })).toBe('name:solo|');
  });

  it('treats an empty-string email or phone as absent, not as a key', () => {
    /** A CSV column that exists but is blank is the common case, not a rare one. */
    expect(leadDedupeKey({ businessName: 'Blank', email: '   ', phone: '', location: 'Hull' })).toBe('name:blank|hull');
  });
});

describe('lead pipeline transitions', () => {
  it('lets a live lead move forward or be lost', () => {
    expect(canTransitionLead('new', 'contacted')).toBe(true);
    expect(canTransitionLead('contacted', 'qualified')).toBe(true);
    expect(canTransitionLead('qualified', 'won')).toBe(true);
    expect(canTransitionLead('new', 'lost')).toBe(true);
  });

  it('permits a no-op transition, so a repeated write is not an error', () => {
    /** `lead.update` sending the status it already has must not 400. */
    for (const s of Object.keys(LEAD_TRANSITIONS) as LeadStatus[]) {
      expect(canTransitionLead(s, s)).toBe(true);
    }
  });

  it('lets a lost lead re-enter the pipeline, because lost usually means "not yet"', () => {
    expect(canTransitionLead('lost', 'contacted')).toBe(true);
    expect(canTransitionLead('lost', 'new')).toBe(true);
  });

  it('never lets a won lead move, because a brand was created for it', () => {
    expect(LEAD_TRANSITIONS.won).toEqual([]);
    for (const to of ['new', 'contacted', 'qualified', 'lost'] as LeadStatus[]) {
      expect(canTransitionLead('won', to)).toBe(false);
    }
  });

  it('cannot be reopened from lost straight to won without being worked', () => {
    expect(canTransitionLead('lost', 'won')).toBe(false);
  });

  it('agrees with isLeadOpen about which states are live', () => {
    expect(isLeadOpen('new')).toBe(true);
    expect(isLeadOpen('contacted')).toBe(true);
    expect(isLeadOpen('qualified')).toBe(true);
    expect(isLeadOpen('won')).toBe(false);
    expect(isLeadOpen('lost')).toBe(false);
  });
});

describe('proposal transitions', () => {
  it('walks draft to sent to decided', () => {
    expect(canTransitionProposal('draft', 'sent')).toBe(true);
    expect(canTransitionProposal('sent', 'accepted')).toBe(true);
    expect(canTransitionProposal('sent', 'declined')).toBe(true);
  });

  it('cannot skip sending — a proposal nobody saw cannot be accepted', () => {
    expect(canTransitionProposal('draft', 'accepted')).toBe(false);
    expect(canTransitionProposal('draft', 'declined')).toBe(false);
  });

  it('lets the agency withdraw from either live state', () => {
    expect(canTransitionProposal('draft', 'withdrawn')).toBe(true);
    expect(canTransitionProposal('sent', 'withdrawn')).toBe(true);
  });

  it('freezes every decided state, so the record of what was offered survives', () => {
    for (const s of ['accepted', 'declined', 'withdrawn'] as ProposalStatus[]) {
      expect(PROPOSAL_TRANSITIONS[s]).toEqual([]);
      expect(canTransitionProposal(s, 'sent')).toBe(false);
    }
  });

  it('permits a no-op transition', () => {
    for (const s of Object.keys(PROPOSAL_TRANSITIONS) as ProposalStatus[]) {
      expect(canTransitionProposal(s, s)).toBe(true);
    }
  });
});

describe('proposalTotals', () => {
  const line = (o: Partial<ProposalLineItem> = {}): ProposalLineItem =>
    ProposalLineItem.parse({ service: 'content_creation', unitCents: 100_000, recurrence: 'monthly', ...o });

  it('separates recurring from one-off, and multiplies the recurring by the term', () => {
    const t = proposalTotals([line({ unitCents: 200_000, recurrence: 'monthly' }), line({ unitCents: 50_000, recurrence: 'one_off' })], 12);
    expect(t.monthlyCents).toBe(200_000);
    expect(t.oneOffCents).toBe(50_000);
    expect(t.totalContractCents).toBe(200_000 * 12 + 50_000);
  });

  it('does not multiply a one-off by the term — the bug this function exists to prevent', () => {
    const t = proposalTotals([line({ unitCents: 200_000, recurrence: 'one_off' })], 12);
    expect(t.totalContractCents).toBe(200_000);
  });

  it('respects quantity on both kinds of line', () => {
    const t = proposalTotals(
      [line({ unitCents: 10_000, quantity: 4, recurrence: 'monthly' }), line({ unitCents: 25_000, quantity: 2, recurrence: 'one_off' })],
      6,
    );
    expect(t.monthlyCents).toBe(40_000);
    expect(t.oneOffCents).toBe(50_000);
    expect(t.totalContractCents).toBe(40_000 * 6 + 50_000);
  });

  it('is zero for an empty proposal rather than throwing', () => {
    expect(proposalTotals([], 12)).toEqual({ monthlyCents: 0, oneOffCents: 0, totalContractCents: 0 });
  });

  it('handles a one-month term without treating monthly as one-off', () => {
    const t = proposalTotals([line({ unitCents: 100_000, recurrence: 'monthly' })], 1);
    expect(t).toEqual({ monthlyCents: 100_000, oneOffCents: 0, totalContractCents: 100_000 });
  });

  it('stays in integers, so no rounding error reaches a contract value', () => {
    const t = proposalTotals([line({ unitCents: 33_333, quantity: 3, recurrence: 'monthly' })], 7);
    expect(Number.isInteger(t.totalContractCents)).toBe(true);
    expect(t.totalContractCents).toBe(33_333 * 3 * 7);
  });
});

describe('ProposalLineItem', () => {
  it('defaults quantity to one', () => {
    expect(ProposalLineItem.parse({ service: 'paid_ads', unitCents: 1, recurrence: 'monthly' }).quantity).toBe(1);
  });

  it('refuses a fractional price, so nobody passes 19.99', () => {
    expect(() => ProposalLineItem.parse({ service: 'paid_ads', unitCents: 19.99, recurrence: 'monthly' })).toThrow();
  });

  it('refuses a negative price', () => {
    expect(() => ProposalLineItem.parse({ service: 'paid_ads', unitCents: -1, recurrence: 'monthly' })).toThrow();
  });

  it('allows a zero-cost line, which is how a bonus or an included service is quoted', () => {
    expect(ProposalLineItem.parse({ service: 'strategy_consulting', unitCents: 0, recurrence: 'monthly' }).unitCents).toBe(0);
  });
});

describe('Currency', () => {
  it('accepts any three-letter ISO code, not just the ones we thought of', () => {
    for (const c of ['USD', 'NGN', 'GBP', 'INR', 'ZAR']) expect(Currency.parse(c)).toBe(c);
  });

  it('rejects lowercase and the wrong length, which are what break formatting', () => {
    for (const bad of ['usd', 'US', 'USDD', '', 'US1']) expect(() => Currency.parse(bad)).toThrow();
  });
});
