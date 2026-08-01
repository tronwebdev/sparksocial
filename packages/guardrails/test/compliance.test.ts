import { describe, expect, it } from 'vitest';
import { complianceProfile } from '../src/compliance.js';

describe('compliance profile', () => {
  it('passes anything for profile "none"', () => {
    expect(complianceProfile({ text: 'This cures everything, guaranteed!', profile: 'none' }).verdict).toBe('pass');
  });

  it('blocks a forbidden phrase for health', () => {
    const result = complianceProfile({
      text: 'This supplement cures your condition.',
      profile: 'health',
      extraRequiredDisclaimers: [],
    });
    expect(result.verdict).toBe('block');
    expect(result.rule).toBe('compliance_profile');
  });

  it('blocks a missing required disclaimer even with no forbidden phrase', () => {
    const result = complianceProfile({ text: 'Feel your best every day.', profile: 'health', extraRequiredDisclaimers: [] });
    expect(result.verdict).toBe('block');
    expect((result.evidence as { missingDisclaimers: string[] }).missingDisclaimers.length).toBeGreaterThan(0);
  });

  it('passes health copy with no forbidden phrase and the required disclaimer present', () => {
    const result = complianceProfile({
      text: 'Feel your best every day. Not intended to diagnose, treat, cure, or prevent any disease.',
      profile: 'health',
      extraRequiredDisclaimers: [],
    });
    expect(result.verdict).toBe('pass');
  });

  it('blocks "guaranteed returns" for finance', () => {
    const result = complianceProfile({
      text: 'Guaranteed returns of 12% annually. Not financial advice.',
      profile: 'finance',
      extraRequiredDisclaimers: [],
    });
    expect(result.verdict).toBe('block');
  });

  it('requires the finance disclaimer', () => {
    const result = complianceProfile({ text: 'A steady approach to investing.', profile: 'finance', extraRequiredDisclaimers: [] });
    expect(result.verdict).toBe('block');
  });

  it('passes clean finance copy with its disclaimer', () => {
    const result = complianceProfile({
      text: 'A steady approach to investing. Not financial advice.',
      profile: 'finance',
      extraRequiredDisclaimers: [],
    });
    expect(result.verdict).toBe('pass');
  });

  it('blocks "we will win" for legal', () => {
    const result = complianceProfile({ text: 'We will win your case.', profile: 'legal', extraRequiredDisclaimers: [] });
    expect(result.verdict).toBe('block');
  });

  it('checks genome-authored extra disclaimers on top of the built-in one', () => {
    const result = complianceProfile({
      text: 'A steady approach to investing. Not financial advice.',
      profile: 'finance',
      extraRequiredDisclaimers: ['results not typical'],
    });
    expect(result.verdict).toBe('block');
    expect((result.evidence as { missingDisclaimers: string[] }).missingDisclaimers).toContain('results not typical');
  });

  it('passes regulated_other copy with no forbidden phrase and its disclaimer', () => {
    const result = complianceProfile({
      text: 'Standard service applies. Terms and conditions apply.',
      profile: 'regulated_other',
      extraRequiredDisclaimers: [],
    });
    expect(result.verdict).toBe('pass');
  });

  it('is case-insensitive on both forbidden phrases and disclaimers', () => {
    const result = complianceProfile({
      text: 'This CURES your condition. NOT INTENDED TO DIAGNOSE, TREAT, CURE, OR PREVENT ANY DISEASE.',
      profile: 'health',
      extraRequiredDisclaimers: [],
    });
    // The forbidden-phrase check runs first and blocks regardless of the disclaimer.
    expect(result.verdict).toBe('block');
    expect(result.fixAction).toContain('cure');
  });
});
