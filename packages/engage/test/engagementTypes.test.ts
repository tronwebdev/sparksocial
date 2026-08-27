import { describe, expect, it } from 'vitest';
import { engagementTypeAllows } from '../src/eligibility.js';

/**
 * `brands.engagement_types` — a stored setting that nothing read.
 *
 * It was validated by `brand.governance.set`, persisted, hydrated and rendered as
 * three checkboxes, and no runtime path consulted it: not `ingest`, not
 * `classify`, not `autohandle`, not `reply.send`, not `policy.ts`. Unchecking
 * "Direct messages" changed a value in a row and SPARK carried on auto-replying
 * to DMs. These tests exist so that cannot silently come back.
 */
describe('engagementTypeAllows', () => {
  it('permits everything when the brand has never chosen', () => {
    // Every brand's state until today. The fix must not change behaviour for
    // anyone who has not touched the control.
    expect(engagementTypeAllows(undefined, 'dm')).toBe(true);
  });

  it('treats an empty list the same as no list', () => {
    // The panel converts an empty selection to `null`, so the two are the same
    // visible state. Making them behave differently would mean one screen with
    // two meanings.
    expect(engagementTypeAllows([], 'dm')).toBe(true);
  });

  it('permits a kind that is on the list', () => {
    expect(engagementTypeAllows(['comment', 'dm'], 'dm')).toBe(true);
  });

  it('refuses a kind that is not', () => {
    // The whole point. This is what "uncheck Direct messages" has to mean.
    expect(engagementTypeAllows(['comment'], 'dm')).toBe(false);
    expect(engagementTypeAllows(['comment'], 'story_reply')).toBe(false);
  });

  it('covers all three kinds independently', () => {
    for (const kind of ['comment', 'dm', 'story_reply']) {
      expect(engagementTypeAllows([kind], kind)).toBe(true);
      const others = ['comment', 'dm', 'story_reply'].filter((k) => k !== kind);
      for (const other of others) expect(engagementTypeAllows([kind], other)).toBe(false);
    }
  });

  it('permits when the message kind is unknown rather than blocking a real reply', () => {
    // A message with no kind is a data problem, not a policy one. Refusing here
    // would stop a reply for a reason the brand never configured; the eligibility
    // gate and the campaign rung still apply.
    expect(engagementTypeAllows(['comment'], undefined)).toBe(true);
  });
});
