import { PASS, type CheckResult } from './types.js';

/**
 * PLATFORM POLICY — engine spec §10: "Per-platform length, hashtag, link, and
 * disclosure rules. AI-generated media disclosure where the platform requires it."
 *
 * Limits below are the mechanical ones platforms publish and that reject a post
 * outright if violated — not engagement-optimisation advice (e.g. "hashtags
 * hurt reach on X" is a strategy call, not a policy one, and does not belong
 * here). Re-verify at build time per master plan's closing note: these move.
 */

interface PlatformLimits {
  maxLength: number;
  maxHashtags: number;
}

const LIMITS: Record<string, PlatformLimits> = {
  x: { maxLength: 280, maxHashtags: 2 },
  instagram: { maxLength: 2200, maxHashtags: 30 },
  tiktok: { maxLength: 2200, maxHashtags: 30 },
  linkedin: { maxLength: 3000, maxHashtags: 5 },
  facebook: { maxLength: 63_206, maxHashtags: 30 },
  youtube_shorts: { maxLength: 5000, maxHashtags: 15 },
  threads: { maxLength: 500, maxHashtags: 1 },
  pinterest: { maxLength: 500, maxHashtags: 20 },
  bluesky: { maxLength: 300, maxHashtags: 10 },
};

const HASHTAG = /#[\w]+/g;

export interface PlatformPolicyInput {
  platform: string;
  text: string;
  /** Playbook's `requires_disclosure` (§5.1) — e.g. ai_ugc_testimonial. */
  requiresDisclosure: boolean;
  /** Phrase the draft must contain to satisfy disclosure, e.g. "AI-generated". */
  disclosureText?: string;
}

export function platformPolicy(input: PlatformPolicyInput): CheckResult {
  const limits = LIMITS[input.platform];
  if (!limits) {
    // An unrecognised platform is not something to guess rules for.
    return { verdict: 'flag', rule: 'platform_policy', fixAction: `No policy profile for "${input.platform}" — verify limits manually before scheduling.` };
  }

  if (input.text.length > limits.maxLength) {
    return {
      verdict: 'block',
      rule: 'platform_policy',
      evidence: { platform: input.platform, length: input.text.length, maxLength: limits.maxLength },
      fixAction: `Trim by ${input.text.length - limits.maxLength} characters — ${input.platform}'s cap is ${limits.maxLength}.`,
    };
  }

  const hashtagCount = (input.text.match(HASHTAG) ?? []).length;
  if (hashtagCount > limits.maxHashtags) {
    return {
      verdict: 'block',
      rule: 'platform_policy',
      evidence: { platform: input.platform, hashtagCount, maxHashtags: limits.maxHashtags },
      fixAction: `Remove ${hashtagCount - limits.maxHashtags} hashtag(s) — ${input.platform} allows at most ${limits.maxHashtags}.`,
    };
  }

  if (input.requiresDisclosure) {
    const disclosure = input.disclosureText ?? 'AI-generated';
    if (!input.text.toLowerCase().includes(disclosure.toLowerCase())) {
      return {
        verdict: 'block',
        rule: 'platform_policy',
        evidence: { platform: input.platform, missingDisclosure: disclosure },
        fixAction: `Add the disclosure "${disclosure}" — this format requires it and the platform mandates it be visible.`,
      };
    }
  }

  return PASS;
}
