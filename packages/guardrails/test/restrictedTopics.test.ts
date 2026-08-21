import { describe, expect, it } from 'vitest';
import { restrictedTopics } from '../src/restrictedTopics.js';

/**
 * PRD §9's restricted topics and claims-to-avoid — named in five PRD sections
 * and previously present in no layer of the system.
 *
 * The behaviour that matters is the escalation: §9 says a hit is *"Needs Review
 * (soft) or Blocked (hard) depending on strict mode and rule type"*, and a check
 * that always blocked would make the feature unusable while one that always
 * flagged would make strict mode a lie.
 */

describe('restrictedTopics', () => {
  it('passes when the brand has configured nothing', () => {
    // Every publish declares this guard, so a brand that has set no rules must
    // sail through it rather than being held up by an empty list.
    expect(restrictedTopics({ text: 'Anything at all.', strictMode: false }).verdict).toBe('pass');
  });

  it('flags a restricted topic when strict mode is off', () => {
    const r = restrictedTopics({
      text: 'Our take on the election this week.',
      restrictedTopics: ['election'],
      strictMode: false,
    });
    expect(r.verdict).toBe('flag');
    expect(r.rule).toContain('election');
    // §9 requires a flagged item to say what to do about it.
    expect(r.fixAction).toBeTruthy();
  });

  it('blocks the same topic when strict mode is on', () => {
    const r = restrictedTopics({
      text: 'Our take on the election this week.',
      restrictedTopics: ['election'],
      strictMode: true,
    });
    expect(r.verdict).toBe('block');
  });

  it('reports a claim ahead of a topic when both trip', () => {
    // The fixes differ in size: a claim is usually one word to soften, a topic
    // means the post should not exist. Naming the cheaper one first is what
    // makes the message actionable.
    const r = restrictedTopics({
      text: 'Guaranteed results, and here is our take on the election.',
      restrictedTopics: ['election'],
      claimsToAvoid: ['guaranteed'],
      strictMode: false,
    });
    expect(r.rule).toContain('claim_to_avoid');
    expect(r.evidence).toMatchObject({ kind: 'claim' });
  });

  it('matches whole words, so a restricted topic does not catch an unrelated one', () => {
    // A brand that restricts "arms" must not lose every "pharmacy". This is the
    // difference between a usable guard and one that gets switched off in a week.
    expect(
      restrictedTopics({ text: 'Visit our pharmacy today.', restrictedTopics: ['arms'], strictMode: false })
        .verdict,
    ).toBe('pass');
    expect(
      restrictedTopics({ text: 'We stock arms.', restrictedTopics: ['arms'], strictMode: false }).verdict,
    ).toBe('flag');
  });

  it('is case-insensitive', () => {
    expect(
      restrictedTopics({ text: 'GUARANTEED to work.', claimsToAvoid: ['guaranteed'], strictMode: false })
        .verdict,
    ).toBe('flag');
  });

  it('matches a multi-word phrase across any whitespace', () => {
    // Copy is written with line breaks in it; a phrase check that only matched
    // single spaces would miss exactly the drafts a model produces.
    expect(
      restrictedTopics({
        text: 'This is\n  clinically   proven, we promise.',
        claimsToAvoid: ['clinically proven'],
        strictMode: false,
      }).verdict,
    ).toBe('flag');
  });

  it('treats a regex-special phrase as literal text', () => {
    // A brand restricting "C++" is naming a topic, not writing a pattern. An
    // unescaped phrase here would either throw or match nothing.
    expect(
      restrictedTopics({ text: 'We build in C++ mostly.', restrictedTopics: ['C++'], strictMode: false })
        .verdict,
    ).toBe('flag');
    expect(
      restrictedTopics({ text: 'We build in Rust.', restrictedTopics: ['C++'], strictMode: false }).verdict,
    ).toBe('pass');
  });

  it('ignores blank entries rather than matching everything', () => {
    // An empty string matches every text. A trailing comma in the settings
    // field must not silently block the entire account.
    expect(
      restrictedTopics({ text: 'A perfectly ordinary post.', restrictedTopics: ['', '   '], strictMode: true })
        .verdict,
    ).toBe('pass');
  });
});
