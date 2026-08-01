import { describe, expect, it } from 'vitest';
import { platformPolicy } from '../src/platformPolicy.js';

describe('platform policy', () => {
  it('passes clean copy within every limit', () => {
    const result = platformPolicy({ platform: 'x', text: 'A short post.', requiresDisclosure: false });
    expect(result.verdict).toBe('pass');
  });

  it('blocks copy over the platform length limit', () => {
    const result = platformPolicy({ platform: 'x', text: 'a'.repeat(281), requiresDisclosure: false });
    expect(result.verdict).toBe('block');
    expect(result.rule).toBe('platform_policy');
  });

  it('passes copy exactly at the length limit', () => {
    const result = platformPolicy({ platform: 'x', text: 'a'.repeat(280), requiresDisclosure: false });
    expect(result.verdict).toBe('pass');
  });

  it('allows the same length on a platform with a higher limit', () => {
    const result = platformPolicy({ platform: 'linkedin', text: 'a'.repeat(281), requiresDisclosure: false });
    expect(result.verdict).toBe('pass');
  });

  it('blocks too many hashtags', () => {
    const result = platformPolicy({ platform: 'x', text: '#a #b #c', requiresDisclosure: false });
    expect(result.verdict).toBe('block');
    expect((result.evidence as { hashtagCount: number }).hashtagCount).toBe(3);
  });

  it('passes at the hashtag limit', () => {
    expect(platformPolicy({ platform: 'x', text: '#a #b', requiresDisclosure: false }).verdict).toBe('pass');
  });

  it('blocks a required disclosure that is missing', () => {
    const result = platformPolicy({ platform: 'instagram', text: 'Check out this review!', requiresDisclosure: true });
    expect(result.verdict).toBe('block');
    expect(result.fixAction).toContain('AI-generated');
  });

  it('passes when the required disclosure is present', () => {
    const result = platformPolicy({
      platform: 'instagram',
      text: 'Check out this review! (AI-generated)',
      requiresDisclosure: true,
    });
    expect(result.verdict).toBe('pass');
  });

  it('accepts a custom disclosure phrase', () => {
    const result = platformPolicy({
      platform: 'instagram',
      text: 'This is a Paid Partnership post.',
      requiresDisclosure: true,
      disclosureText: 'Paid Partnership',
    });
    expect(result.verdict).toBe('pass');
  });

  it('does not require disclosure when the format does not need it', () => {
    const result = platformPolicy({ platform: 'instagram', text: 'A normal post.', requiresDisclosure: false });
    expect(result.verdict).toBe('pass');
  });

  it('flags rather than blocks an unrecognised platform', () => {
    const result = platformPolicy({ platform: 'myspace', text: 'anything', requiresDisclosure: false });
    expect(result.verdict).toBe('flag');
  });

  it('length is checked before hashtags — a caller sees the first violation, not a merged one', () => {
    const result = platformPolicy({ platform: 'x', text: 'a'.repeat(281) + ' #a #b #c', requiresDisclosure: false });
    expect(result.verdict).toBe('block');
    expect(result.evidence).toHaveProperty('length');
  });
});
