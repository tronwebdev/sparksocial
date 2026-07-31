import { describe, expect, it } from 'vitest';
import { validateBrief } from '../src/validate.js';
import type { DraftCaptureBrief } from '../src/schema.js';

/**
 * §6.2's own worked example is the test oracle. Both fixtures are structured
 * decompositions of the spec's prose — the "good" one is the exact JSON example
 * from the spec text; the "bad" one is what a brief-writer would produce if it
 * emitted the spec's bad-example sentence field-by-field instead of refusing.
 */

const GOOD: DraftCaptureBrief = {
  playbook_id: 'pb_craft_capture',
  subject: 'the final fade blend',
  framing: 'behind subject, chest height',
  orientation: 'vertical',
  duration_sec: 20,
  motion: 'slow push in or static',
  audio: 'ambient only, no speech',
  lighting: 'face a window, avoid overhead only',
  do_not: ['do not talk to camera', 'no filters'],
  estimated_effort_sec: 45,
};

const BAD: DraftCaptureBrief = {
  playbook_id: 'pb_craft_capture',
  subject: 'your work',
  framing: 'whatever looks good',
  orientation: 'vertical',
  duration_sec: 20,
  motion: 'showcase it',
  audio: 'anything',
  lighting: 'good',
  do_not: [],
  estimated_effort_sec: 30,
};

describe('the spec\'s own worked example', () => {
  it('passes the good brief', () => {
    expect(validateBrief(GOOD)).toEqual({ verdict: 'pass', reasons: [] });
  });

  it('rejects "post a video of your work today" decomposed into fields, and names every reason', () => {
    const result = validateBrief(BAD);
    expect(result.verdict).toBe('reject');
    // Every vague field should be caught, not just the first — a retry needs
    // the whole list to fix in one pass.
    expect(result.reasons).toHaveLength(5); // subject, framing, motion, lighting, do_not
    expect(result.reasons.some((r) => r.includes('subject'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('do_not'))).toBe(true);
  });
});

describe('field-level vagueness', () => {
  it.each([
    ['your work', true],
    ['something good', true],
    ['a video', true],
    ['post something', true],
    ['looks good', true],
    ['whatever you like', true],
    ['showcase the product', true],
    ['highlights of the day', true],
    ['short', true], // under the length floor, no vague phrase needed
    ['the final fade blend', false],
    ['behind subject, chest height', false],
    ['ambient only, no speech', false],
  ])('treats %j as vague=%s', (value, expectVague) => {
    const draft = { ...GOOD, subject: value };
    const result = validateBrief(draft);
    const flaggedSubject = result.reasons.some((r) => r.startsWith('subject'));
    expect(flaggedSubject).toBe(expectVague);
  });

  it('a concrete but short instruction still passes — concreteness is not a word-count minimum', () => {
    // "no filters" is 10 chars and completely unambiguous; padding it out would
    // not make it more filmable.
    const draft = { ...GOOD, do_not: ['no filters'] };
    expect(validateBrief(draft).verdict).toBe('pass');
  });
});

describe('do_not', () => {
  it('rejects an empty list', () => {
    const result = validateBrief({ ...GOOD, do_not: [] });
    expect(result.reasons).toContain('do_not list has no concrete constraints');
  });

  it('rejects a list of only whitespace/near-empty entries', () => {
    const result = validateBrief({ ...GOOD, do_not: ['  ', 'ok'] });
    expect(result.verdict).toBe('reject');
  });
});

describe('duration bounds', () => {
  it('passes when no bounds are supplied', () => {
    expect(validateBrief(GOOD).verdict).toBe('pass');
  });

  it('rejects a brief outside the playbook\'s declared duration range', () => {
    const result = validateBrief(GOOD, { durationBoundsSec: [30, 60] });
    expect(result.verdict).toBe('reject');
    expect(result.reasons[0]).toContain('outside the playbook\'s 30-60s range');
  });

  it('passes at the exact boundary', () => {
    expect(validateBrief(GOOD, { durationBoundsSec: [20, 60] }).verdict).toBe('pass');
    expect(validateBrief(GOOD, { durationBoundsSec: [5, 20] }).verdict).toBe('pass');
  });
});

describe('effort plausibility', () => {
  it('rejects effort shorter than the clip itself', () => {
    const result = validateBrief({ ...GOOD, duration_sec: 60, estimated_effort_sec: 30 });
    expect(result.reasons).toContain('estimated_effort_sec is shorter than the clip itself');
  });

  it('allows effort equal to duration — a single perfect take', () => {
    const result = validateBrief({ ...GOOD, duration_sec: 20, estimated_effort_sec: 20 });
    expect(result.verdict).toBe('pass');
  });
});

describe('purity', () => {
  it('is deterministic and does not mutate its input', () => {
    const snapshot = JSON.stringify(GOOD);
    const a = validateBrief(GOOD);
    const b = validateBrief(GOOD);
    expect(a).toEqual(b);
    expect(JSON.stringify(GOOD)).toBe(snapshot);
  });
});
