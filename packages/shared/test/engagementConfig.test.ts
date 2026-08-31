import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMOJI_LEVEL,
  DEFAULT_ESCALATION_BEHAVIOR,
  EMOJI_INSTRUCTION,
  HARD_RULE_INSTRUCTION,
  applyPlatformOverride,
  resolvePlatformEngagement,
  toneInstructions,
  tripsComplaintRule,
} from '../src/engagementConfig.js';

/**
 * The Engagement Intelligence vocabulary lives in `shared` for the same reason
 * Sales Assist's does: two packages on opposite sides of the build order must
 * reach the *same* answer. `agency` writes the configuration and renders it on
 * the settings screen; `engage` obeys it when a reply is drafted or sent. A
 * screen that resolves a setting differently from the gate is worse than no
 * setting, because it tells the owner something untrue about their own account.
 */

describe('tripsComplaintRule', () => {
  it('is inert when the rule is not selected', () => {
    // The markers are deliberately blunt, so they must never fire for a brand
    // that has not asked for them.
    expect(tripsComplaintRule([], 'this is terrible, I want a refund')).toBe(false);
    expect(tripsComplaintRule(undefined, 'this is terrible, I want a refund')).toBe(false);
  });

  it('catches a complaint once the rule is selected', () => {
    const rules = ['never_auto_reply_to_complaints' as const];
    expect(tripsComplaintRule(rules, 'This is terrible. I want a REFUND.')).toBe(true);
    expect(tripsComplaintRule(rules, 'still waiting for my order')).toBe(true);
  });

  it('leaves ordinary messages alone', () => {
    const rules = ['never_auto_reply_to_complaints' as const];
    expect(tripsComplaintRule(rules, 'Love this! Do you ship to Lagos?')).toBe(false);
  });

  it('does not fire for the other four rules', () => {
    // Each hard rule has exactly one enforcement point. Sharing one would make
    // "never discuss pricing" silently gate autonomy as well.
    expect(tripsComplaintRule(['never_discuss_pricing'], 'refund please')).toBe(false);
  });
});

describe('HARD_RULE_INSTRUCTION', () => {
  it('has no instruction for the complaints rule', () => {
    /**
     * Deliberate, and the load-bearing part of the design: by the time a prompt
     * runs, the decision to reply unattended has already been taken. The rule is
     * enforced in the policy subject instead. An instruction here would make it
     * look enforced twice while actually being enforced once, in the weaker
     * place — so its absence is asserted rather than left to a comment.
     */
    expect(HARD_RULE_INSTRUCTION.never_auto_reply_to_complaints).toBeUndefined();
  });

  it('has one for each of the other four', () => {
    for (const rule of [
      'never_discuss_pricing',
      'never_promise_results',
      'never_argue',
      'never_discuss_legal_or_medical',
    ] as const) {
      expect(HARD_RULE_INSTRUCTION[rule]).toBeTruthy();
    }
  });
});

describe('toneInstructions', () => {
  it('says nothing when the brand did not override its voice', () => {
    // Absent means "use my brand voice", which is already in the prompt. Adding
    // lines here would quietly compete with the tone vector.
    expect(toneInstructions(undefined)).toEqual([]);
  });

  it('is silent about an axis left in the middle', () => {
    // 0.5 is not a preference. Instructing on it would make every slider
    // meaningful the moment the screen is opened, whether or not it was moved.
    expect(toneInstructions({ casual: 0.5, friendly: 0.5, warm: 0.5 })).toEqual([]);
  });

  it('speaks for an axis pushed to either end', () => {
    const low = toneInstructions({ casual: 0, friendly: 0.5, warm: 0.5 });
    const high = toneInstructions({ casual: 1, friendly: 0.5, warm: 0.5 });
    expect(low).toHaveLength(1);
    expect(high).toHaveLength(1);
    expect(low[0]).not.toEqual(high[0]);
  });
});

describe('emoji', () => {
  it('defaults to none and states it', () => {
    /**
     * A model given no instruction about emoji uses them some of the time, so
     * silence and `none` are different outcomes. The default has to produce a
     * line, not an empty string.
     */
    expect(DEFAULT_EMOJI_LEVEL).toBe('none');
    expect(EMOJI_INSTRUCTION.none).toBeTruthy();
  });

  it('has a distinct instruction per level', () => {
    const lines = new Set(Object.values(EMOJI_INSTRUCTION));
    expect(lines.size).toBe(3);
  });
});

describe('escalation', () => {
  it('defaults to the one behaviour that cannot interrupt anybody', () => {
    expect(DEFAULT_ESCALATION_BEHAVIOR).toBe('hold');
  });
});

describe('resolvePlatformEngagement', () => {
  const brand = { brandAutonomy: 'auto' as const, brandTypes: ['comment' as const] };

  it('inherits the brand when there is no row', () => {
    const eff = resolvePlatformEngagement({ platform: 'x', ...brand, row: undefined });
    expect(eff).toEqual({ autonomy: 'auto', types: ['comment'], enabled: true, inherited: true });
  });

  it('takes each overridden field and inherits the rest', () => {
    const eff = resolvePlatformEngagement({
      platform: 'x',
      ...brand,
      row: { platform: 'x', autonomy: 'suggest', enabled: true },
    });
    expect(eff.autonomy).toBe('suggest');
    // Not overridden, so still the brand's list — the screen must show that.
    expect(eff.types).toEqual(['comment']);
    expect(eff.inherited).toBe(false);
  });

  it('never reports a disabled platform as inheriting', () => {
    // `enabled: false` is itself a choice. Labelling it "following the brand"
    // would make a muted platform look like one nobody had touched.
    const eff = resolvePlatformEngagement({
      platform: 'x',
      ...brand,
      row: { platform: 'x', enabled: false },
    });
    expect(eff.enabled).toBe(false);
    expect(eff.inherited).toBe(false);
  });
});

describe('applyPlatformOverride', () => {
  it('leaves the rung alone when there is no row', () => {
    /**
     * The case every existing brand is in. This is why the reply gate does not
     * use `resolvePlatformEngagement`: that function falls back to the brand's
     * `engagementAutonomy`, whose default is `off`, which would silence every
     * brand that has never opened the screen.
     */
    expect(applyPlatformOverride({ granted: 'auto', row: undefined })).toBe('auto');
  });

  it('leaves the rung alone when the row overrides only the types', () => {
    expect(
      applyPlatformOverride({
        granted: 'auto',
        row: { platform: 'x', engagementTypes: ['dm'], enabled: true },
      }),
    ).toBe('auto');
  });

  it('narrows to off for a disabled platform', () => {
    expect(applyPlatformOverride({ granted: 'auto', row: { platform: 'x', enabled: false } })).toBe('off');
  });

  it('narrows when the override is lower than the rung', () => {
    expect(
      applyPlatformOverride({ granted: 'auto', row: { platform: 'x', autonomy: 'suggest', enabled: true } }),
    ).toBe('suggest');
  });

  it('cannot widen past the rung', () => {
    /**
     * The load-bearing asymmetry. A platform setting that could raise a campaign
     * above its own engagement rung would make the rung advisory, and the rung is
     * the thing the approval ladder is expressed in.
     */
    expect(
      applyPlatformOverride({ granted: 'suggest', row: { platform: 'x', autonomy: 'auto', enabled: true } }),
    ).toBe('suggest');
    expect(
      applyPlatformOverride({ granted: 'off', row: { platform: 'x', autonomy: 'auto', enabled: true } }),
    ).toBe('off');
  });
});
