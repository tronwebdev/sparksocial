import { describe, expect, it } from 'vitest';
import { UNNAMED_AGENT, agentIdentity, riskTolerance, voiceWords } from '../src/agentIdentity.js';

/**
 * The agent's identity is one stored field and two derived ones, and the
 * derivation is the part worth testing — because the alternative design, storing
 * all three, fails in a way that is invisible: the screen would say "Formal,
 * Technical" while the drafts came out playful, and people would believe the
 * screen.
 */

describe('voiceWords', () => {
  it('names only the axes that say something', () => {
    // 0.5 is the absence of a preference. Four untouched sliders must not
    // produce four adjectives — that dresses up having configured nothing.
    expect(voiceWords({ formal: 0.5, playful: 0.5, technical: 0.5, bold: 0.5 })).toEqual([]);
  });

  it('reads both ends of each axis', () => {
    expect(voiceWords({ formal: 0.9, playful: 0.1, technical: 0.8, bold: 0.2 })).toEqual([
      'Formal',
      'Serious',
      'Technical',
      'Measured',
    ]);
    expect(voiceWords({ formal: 0.1, playful: 0.9, technical: 0.2, bold: 0.8 })).toEqual([
      'Casual',
      'Playful',
      'Plain-spoken',
      'Bold',
    ]);
  });

  it('ignores a nudge and honours a decision', () => {
    // Just inside the deadband, then just outside it.
    expect(voiceWords({ formal: 0.6, playful: 0.5, technical: 0.5, bold: 0.5 })).toEqual([]);
    expect(voiceWords({ formal: 0.66, playful: 0.5, technical: 0.5, bold: 0.5 })).toEqual(['Formal']);
  });

  it('says nothing when the brand has no tone at all', () => {
    expect(voiceWords(undefined)).toEqual([]);
  });

  it('skips an axis that is not a number', () => {
    // The vector is jsonb, so an older or hand-written row can be partial.
    expect(voiceWords({ formal: 0.9, playful: undefined as never, technical: 0.9, bold: 0.5 })).toEqual([
      'Formal',
      'Technical',
    ]);
  });
});

describe('riskTolerance', () => {
  it('reads the approval mode that is actually enforced', () => {
    expect(riskTolerance('autopublish').level).toBe('High');
    expect(riskTolerance('review_everything').level).toBe('Low');
    expect(riskTolerance('review_first_week').level).toBe('Moderate');
  });

  it('explains itself, because it is a rendering and not a dial', () => {
    // Somebody who wants to change it needs to know what to change.
    expect(riskTolerance('autopublish').because).toMatch(/without waiting/);
    expect(riskTolerance('review_everything').because).toMatch(/waits for your approval/);
  });

  it('falls back to the mode a new brand actually has', () => {
    // `review_first_week` is the column default, so the fallback should agree
    // with it rather than picking the safest-sounding answer.
    expect(riskTolerance(undefined).level).toBe('Moderate');
  });
});

describe('agentIdentity', () => {
  it('uses the name the owner chose', () => {
    const id = agentIdentity({ agentName: 'Kwame', approvalMode: 'autopublish' });
    expect(id.name).toBe('Kwame');
    expect(id.named).toBe(true);
  });

  it('does not pretend an unnamed agent has a name', () => {
    // `named: false` lets a caller style it as a placeholder rather than
    // rendering "Your agent" as though somebody chose it.
    for (const agentName of [undefined, null, '', '   ']) {
      const id = agentIdentity({ agentName });
      expect(id.name).toBe(UNNAMED_AGENT);
      expect(id.named).toBe(false);
    }
  });

  it('trims, so a stray space is not a name', () => {
    expect(agentIdentity({ agentName: '  Ada  ' }).name).toBe('Ada');
  });

  it('assembles all three parts', () => {
    const id = agentIdentity({
      agentName: 'Ada',
      toneVector: { formal: 0.8, playful: 0.2, technical: 0.5, bold: 0.9 },
      approvalMode: 'review_everything',
    });

    expect(id).toMatchObject({
      name: 'Ada',
      named: true,
      voice: ['Formal', 'Serious', 'Bold'],
      riskTolerance: 'Low',
    });
  });
});
