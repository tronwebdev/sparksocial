/**
 * HOW MANY HASHTAGS A POST GETS, and the mechanical caps behind that number.
 *
 * ── The bug this exists to fix ────────────────────────────────────────────
 *
 * Drafts came out with no hashtags at all, and had since the beginning. The
 * only hashtag code in the product was `platformPolicy`'s check that a caption
 * does not carry *too many* — a ceiling with nothing underneath it. No playbook
 * declared a hashtag beat, no `prompt_ref` asked for one, and the copy writer's
 * system prompt told the model to return the beat text and nothing else. The
 * feature was enforced and never built.
 *
 * ── Why the ceiling lives here and not in guardrails ──────────────────────
 *
 * `LIMITS` was private to `packages/guardrails`. Had the writer kept its own
 * copy of "X allows 2", the number that *blocks* a draft and the number that
 * *writes* one would have been free to drift, and the failure mode is the worst
 * kind: a draft SPARK wrote, that SPARK then refuses to publish. Same reasoning
 * as `campaign.readiness` calling `planCampaign` rather than recomputing it.
 * `platformPolicy` now reads `PLATFORM_LIMITS` from here.
 *
 * ── Two tables, one subordinate to the other ──────────────────────────────
 *
 * `PLATFORM_LIMITS` is mechanical: what the platform's API rejects. It is not a
 * target — Instagram accepts 30 and a post carrying 30 reads as spam. `NORM` is
 * the editorial number, and it covers platforms `PLATFORM_LIMITS` has no
 * profile for (`instagram_story`, `facebook_group`, `youtube_long`) so those
 * playbooks are not silently left without any.
 *
 * They cannot disagree, because `hashtagBudget` clamps the norm by the limit
 * wherever a limit exists. A norm that exceeded a cap would be corrected rather
 * than honoured.
 */

export interface PlatformLimits {
  maxLength: number;
  maxHashtags: number;
}

/**
 * The mechanical caps — engine spec §10. Re-verify at build time; these move.
 *
 * Absent means "no policy profile", which `platformPolicy` reports as a flag
 * rather than guessing. Reddit and Google Business are absent for that reason
 * and not because they are unlimited.
 */
export const PLATFORM_LIMITS: Record<string, PlatformLimits> = {
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

/**
 * How many a post on this platform should actually carry.
 *
 * Zero is a real answer and not a gap. A hashtag does nothing on a Google
 * Business post, and on Reddit it reads as someone who has mistaken it for
 * Instagram — the unit of topic there is the subreddit. Writing them anyway
 * would be output that makes a post worse, which is not a neutral default.
 */
const NORM: Record<string, number> = {
  x: 2,
  threads: 1,
  bluesky: 3,
  linkedin: 4,
  instagram: 6,
  instagram_story: 2,
  tiktok: 5,
  facebook: 3,
  facebook_group: 2,
  youtube_shorts: 4,
  youtube_long: 4,
  pinterest: 5,
  google_business: 0,
  reddit: 0,
};

/**
 * The budget for a post going to `platforms`.
 *
 * The narrowest wins, for the same reason `beatBudget` takes the narrowest
 * caption length: one caption is written and then published to all of them, so
 * a count that suits Instagram gets a post rejected by X. A playbook targeting
 * X and Instagram together gets two.
 *
 * An unknown platform contributes 0 — the same "do not guess rules for a
 * platform we have no profile for" that `platformPolicy` applies, and the safe
 * direction, since the cost of no hashtags is smaller than the cost of a
 * blocked post.
 */
export function hashtagBudget(platforms: readonly string[]): number {
  if (platforms.length === 0) return 0;
  return platforms.reduce((low, platform) => {
    const norm = NORM[platform] ?? 0;
    const cap = PLATFORM_LIMITS[platform]?.maxHashtags;
    return Math.min(low, cap === undefined ? norm : Math.min(norm, cap));
  }, Number.POSITIVE_INFINITY);
}

/** Matches what `platformPolicy` counts, so the writer and the check see the same tags. */
const HASHTAG = /#[\w]+/g;

export function countHashtags(text: string): number {
  return (text.match(HASHTAG) ?? []).length;
}

/**
 * Normalise one model-written tag into something publishable.
 *
 * Returns null for anything that cannot be salvaged. Models return `#Cold Brew`,
 * `"#coldbrew"`, `cold-brew` and `#` on their own; every one of those reaches a
 * caption verbatim if nothing cleans it, and a broken hashtag is more visibly
 * wrong than a missing one.
 */
export function normaliseHashtag(raw: string): string | null {
  const stripped = raw
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/^#+/, '')
    // Spaces, hyphens and punctuation are not hashtag characters anywhere.
    // Camel-casing the words back together is what a person would have typed.
    .split(/[^A-Za-z0-9_]+/)
    .filter(Boolean)
    .join('');
  if (!stripped) return null;
  // A tag that is only digits is not a tag on any platform that has them.
  if (/^\d+$/.test(stripped)) return null;
  return `#${stripped}`;
}

/**
 * Clean, de-duplicate and cap a written list.
 *
 * Case-insensitive de-duplication: `#ColdBrew` and `#coldbrew` are the same tag
 * to every platform, and a caption carrying both looks like a mistake because it
 * is one. The first spelling wins, since that is the one the writer chose.
 */
export function tidyHashtags(raw: readonly string[], budget: number): string[] {
  if (budget <= 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of raw) {
    const tag = normaliseHashtag(candidate);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= budget) break;
  }
  return out;
}
