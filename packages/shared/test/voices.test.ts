import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STOCK_VOICE_ID,
  STOCK_VOICES,
  StockVoiceIdSchema,
  stockVoice,
  voiceLabel,
} from '../src/voices.js';

/**
 * The voice catalogue — `M5`'s "Ai Voice" picker.
 *
 * `content.scene.voice` shipped with a `brand | stock` enum and a comment saying
 * a *named* voice could not be built because nothing listed available voices.
 * This closes that the same way `brandFonts` closed the font picker: real vendor
 * ids, curated. The tests exist to keep it real — a made-up id here would be a
 * control that resolves to nothing, which was the original objection.
 */
describe('STOCK_VOICES', () => {
  it('has enough entries to be a choice and few enough to be a decision', () => {
    // One entry is not a control; fifty is a research task. Same reasoning that
    // settled on six fonts.
    expect(STOCK_VOICES.length).toBeGreaterThanOrEqual(3);
    expect(STOCK_VOICES.length).toBeLessThanOrEqual(8);
  });

  it('has no duplicate ids or names', () => {
    expect(new Set(STOCK_VOICES.map((v) => v.id)).size).toBe(STOCK_VOICES.length);
    expect(new Set(STOCK_VOICES.map((v) => v.name)).size).toBe(STOCK_VOICES.length);
  });

  it('describes what each one sounds like, not just what it is called', () => {
    // "Rachel" tells a brand owner nothing. The character line is the part that
    // makes the picker usable, so it must actually be there.
    for (const v of STOCK_VOICES) {
      expect(v.character.length, `${v.name} has no character description`).toBeGreaterThan(10);
    }
  });

  it('defaults to the id the voiceover tool already used', () => {
    /**
     * The assertion that matters. `packages/generate/src/voice.ts` has hard-coded
     * this id since it was written, so adding the catalogue must change the sound
     * of nothing until somebody picks something else.
     */
    expect(DEFAULT_STOCK_VOICE_ID).toBe('21m00Tcm4TlvDq8ikWAM');
    expect(stockVoice(DEFAULT_STOCK_VOICE_ID)).toBeDefined();
  });
});

describe('StockVoiceIdSchema', () => {
  it('accepts every id in the catalogue', () => {
    for (const v of STOCK_VOICES) expect(StockVoiceIdSchema.safeParse(v.id).success).toBe(true);
  });

  it('refuses an id the vendor does not have', () => {
    // Validated rather than accepted as free text: a bad id fails at generation
    // time, hours after the settings screen said "Saved".
    expect(StockVoiceIdSchema.safeParse('not-a-voice').success).toBe(false);
  });
});

describe('voiceLabel', () => {
  it('reads as a name and a description', () => {
    expect(voiceLabel(DEFAULT_STOCK_VOICE_ID)).toMatch(/^Rachel — /);
  });

  it('falls back to something rather than nothing', () => {
    // A stale stored id must still render as text, not as a blank option.
    expect(voiceLabel('gone')).toBe('gone');
    expect(voiceLabel(undefined)).toBe('Default voice');
  });
});
