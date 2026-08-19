import { describe, expect, it } from 'vitest';
import { claimGrounding } from '../src/claimGrounding.js';

/**
 * The spec's own example (outcomes doc §1.1): "Cut response time from 6 hours
 * to 4 minutes." — a grounded numeric claim — is the test oracle here.
 */

describe('claim grounding', () => {
  it('passes text with no checkable claims at all', () => {
    expect(claimGrounding({ text: 'Software should be delegated to, not operated.', groundingCorpus: '' }).verdict).toBe(
      'pass',
    );
  });

  it('passes a numeric claim that appears in the grounding corpus', () => {
    const result = claimGrounding({
      text: 'Cut response time from 6 hours to 4 minutes.',
      groundingCorpus: 'Case study: response time dropped from 6 hours to 4 minutes after rollout.',
    });
    expect(result.verdict).toBe('pass');
  });

  it('blocks a numeric claim that does not appear anywhere in the corpus', () => {
    const result = claimGrounding({
      text: 'Cut response time from 6 hours to 4 minutes.',
      groundingCorpus: 'We help teams move faster.',
    });
    expect(result.verdict).toBe('block');
    expect(result.rule).toBe('claim_grounding');
    expect((result.evidence as { ungroundedClaims: string[] }).ungroundedClaims.length).toBeGreaterThan(0);
  });

  it('names every ungrounded claim, not just the first', () => {
    const result = claimGrounding({
      text: 'Used by 40000 teams, cutting costs by 30%.',
      groundingCorpus: 'We are a productivity company.',
    });
    expect(result.verdict).toBe('block');
    const claims = (result.evidence as { ungroundedClaims: string[] }).ungroundedClaims;
    expect(claims.length).toBeGreaterThanOrEqual(2);
  });

  it('blocks an ungrounded currency claim', () => {
    const result = claimGrounding({ text: 'Save $500 every month.', groundingCorpus: 'Save money with less effort.' });
    expect(result.verdict).toBe('block');
  });

  it('passes a grounded currency claim', () => {
    const result = claimGrounding({ text: 'Save $500 every month.', groundingCorpus: 'Customers save $500 every month on average.' });
    expect(result.verdict).toBe('pass');
  });

  it('blocks an ungrounded superlative', () => {
    const result = claimGrounding({ text: 'The fastest way to onboard a team.', groundingCorpus: 'We help teams onboard.' });
    expect(result.verdict).toBe('block');
  });

  it('passes a grounded superlative', () => {
    const result = claimGrounding({
      text: 'The fastest way to onboard a team.',
      groundingCorpus: 'Independent review: the fastest onboarding flow we tested.',
    });
    expect(result.verdict).toBe('pass');
  });

  it('is case-insensitive against the corpus', () => {
    const result = claimGrounding({ text: 'The FASTEST onboarding.', groundingCorpus: 'reviewers called it the fastest onboarding flow' });
    expect(result.verdict).toBe('pass');
  });

  it('does not treat a bare small number (a list position, a duration) as a claim needing grounding', () => {
    // "3" alone (e.g. "3 tips") is not the kind of specific, checkable claim
    // that churns a founder who catches it wrong — flagging it would just be
    // noise the guardrail would train people to ignore.
    const result = claimGrounding({ text: 'Here are 3 tips for better onboarding.', groundingCorpus: '' });
    expect(result.verdict).toBe('pass');
  });

  it('is deterministic and does not mutate its input', () => {
    const input = { text: 'Cut costs by 30%.', groundingCorpus: 'no mention here' };
    const snapshot = JSON.stringify(input);
    claimGrounding(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
