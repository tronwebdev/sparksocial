import { PASS, type CheckResult } from './types.js';

/**
 * BRAND VOICE — engine spec §10: "Banned phrases from genome; tone vector
 * distance check against approved samples."
 *
 * Only the banned-phrase half is implemented as a real check. Tone-vector
 * distance needs a corpus of the brand's approved writing and an embedding
 * comparison — there is no such corpus yet (it would come from `past_post`
 * assets, §4.2), so this module does not fake that half with a proxy metric
 * that would just be noise dressed as signal. When approved samples exist,
 * add a second check here behind the same `CheckResult` contract; do not
 * invent a tone score from word counts in the meantime.
 */

export interface BrandVoiceInput {
  text: string;
  /** genome.voice.banned_phrases (§3.2). */
  bannedPhrases: string[];
}

export function brandVoice(input: BrandVoiceInput): CheckResult {
  const lower = input.text.toLowerCase();
  const hit = input.bannedPhrases.find((p) => p.trim().length > 0 && lower.includes(p.toLowerCase()));

  if (!hit) return PASS;

  return {
    verdict: 'flag',
    rule: 'brand_voice',
    evidence: { bannedPhrase: hit },
    fixAction: `Rephrase to avoid "${hit}" — this brand has banned it explicitly.`,
  };
}
