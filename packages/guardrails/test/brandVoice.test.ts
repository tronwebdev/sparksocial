import { describe, expect, it } from 'vitest';
import { brandVoice } from '../src/brandVoice.js';

describe('brand voice', () => {
  it('passes when the text uses none of the banned phrases', () => {
    expect(brandVoice({ text: 'Software should be delegated to, not operated.', bannedPhrases: ['game-changer'] }).verdict).toBe('pass');
  });

  it('flags (not blocks) a banned phrase — this is advisory, not a hard stop', () => {
    const result = brandVoice({ text: 'This is a total game-changer for your team.', bannedPhrases: ['game-changer'] });
    expect(result.verdict).toBe('flag');
    expect(result.rule).toBe('brand_voice');
    expect(result.fixAction).toContain('game-changer');
  });

  it('is case-insensitive', () => {
    expect(brandVoice({ text: 'A total GAME-CHANGER.', bannedPhrases: ['game-changer'] }).verdict).toBe('flag');
  });

  it('ignores empty-string entries in the banned list rather than matching everything', () => {
    expect(brandVoice({ text: 'Anything at all.', bannedPhrases: ['', '  '] }).verdict).toBe('pass');
  });

  it('passes when there are no banned phrases configured', () => {
    expect(brandVoice({ text: 'Anything at all.', bannedPhrases: [] }).verdict).toBe('pass');
  });
});
