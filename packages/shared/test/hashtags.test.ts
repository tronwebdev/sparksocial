import { describe, expect, it } from 'vitest';
import { PLATFORM_LIMITS, countHashtags, hashtagBudget, normaliseHashtag, tidyHashtags } from '../src/hashtags.js';

/**
 * How many hashtags a post gets, and what a hashtag is.
 *
 * The bug behind this file is that drafts had none at all: `platformPolicy`
 * counted them and blocked a caption carrying too many, and nothing anywhere
 * ever wrote one. The ceiling existed with nothing underneath it.
 *
 * The cases worth pinning are the ones where being wrong is expensive — a count
 * the guardrail then blocks, and a tag that reaches a caption malformed.
 */

describe('hashtagBudget', () => {
  it('never exceeds the cap platformPolicy enforces', () => {
    /*
     * The failure this whole arrangement exists to make impossible: a draft
     * SPARK wrote and SPARK then refuses to publish. Worse than no hashtags,
     * because the post is stuck rather than merely plainer.
     */
    for (const [platform, limits] of Object.entries(PLATFORM_LIMITS)) {
      expect(hashtagBudget([platform])).toBeLessThanOrEqual(limits.maxHashtags);
    }
  });

  it('takes the narrowest platform when a playbook targets several', () => {
    // One caption is written and published to all of them, so a count that
    // suits Instagram gets the X post rejected.
    expect(hashtagBudget(['instagram', 'x'])).toBe(hashtagBudget(['x']));
    expect(hashtagBudget(['instagram', 'threads'])).toBe(1);
  });

  it('gives none to platforms where a hashtag is a mistake', () => {
    // Not a gap. On Reddit the unit of topic is the subreddit, and on a Google
    // Business post a hashtag does nothing at all.
    expect(hashtagBudget(['reddit'])).toBe(0);
    expect(hashtagBudget(['google_business'])).toBe(0);
  });

  it('gives none for a platform it has never heard of', () => {
    // Same rule platformPolicy applies: do not guess rules for a platform with
    // no profile. The cost of no hashtags is smaller than a blocked post.
    expect(hashtagBudget(['orkut'])).toBe(0);
    expect(hashtagBudget([])).toBe(0);
  });

  it('covers the derived platforms PLATFORM_LIMITS has no profile for', () => {
    // instagram_story / facebook_group / youtube_long publish real posts. A
    // budget table keyed only on the mechanical caps would silently leave every
    // playbook targeting them without tags.
    expect(hashtagBudget(['instagram_story'])).toBeGreaterThan(0);
    expect(hashtagBudget(['facebook_group'])).toBeGreaterThan(0);
    expect(hashtagBudget(['youtube_long'])).toBeGreaterThan(0);
  });
});

describe('normaliseHashtag', () => {
  it('rejoins the words of a multi-word tag', () => {
    // Models return "#Cold Brew" routinely, and a space ends a hashtag on every
    // platform — "#Cold" would publish and "Brew" would be loose text.
    expect(normaliseHashtag('#Cold Brew')).toBe('#ColdBrew');
    expect(normaliseHashtag('cold-brew')).toBe('#coldbrew');
  });

  it('strips the packaging a model puts around it', () => {
    expect(normaliseHashtag('"#huila"')).toBe('#huila');
    expect(normaliseHashtag('  ##coffee  ')).toBe('#coffee');
  });

  it('refuses what cannot be salvaged', () => {
    // A broken hashtag in a caption is more visibly wrong than a missing one.
    expect(normaliseHashtag('#')).toBeNull();
    expect(normaliseHashtag('   ')).toBeNull();
    expect(normaliseHashtag('#2024')).toBeNull();
  });
});

describe('tidyHashtags', () => {
  it('caps at the budget however many the writer returned', () => {
    // The model is asked for exactly N and does not always give exactly N. The
    // cap is enforced here so no writer has to be trusted with it.
    expect(tidyHashtags(['a', 'b', 'c', 'd'], 2)).toEqual(['#a', '#b']);
  });

  it('de-duplicates case-insensitively, keeping the writer\'s spelling', () => {
    // Every platform treats #ColdBrew and #coldbrew as one tag; a caption
    // carrying both reads as a mistake because it is one.
    expect(tidyHashtags(['ColdBrew', 'coldbrew', 'huila'], 5)).toEqual(['#ColdBrew', '#huila']);
  });

  it('returns nothing at all on a zero budget', () => {
    expect(tidyHashtags(['coffee', 'roastery'], 0)).toEqual([]);
  });

  it('does not let a dropped tag cost the post a slot', () => {
    // An unsalvageable entry is skipped, not counted — otherwise one "#" from
    // the model silently costs a caption one real hashtag.
    expect(tidyHashtags(['#', 'huila', 'pinkbourbon'], 2)).toEqual(['#huila', '#pinkbourbon']);
  });
});

describe('countHashtags', () => {
  it('counts what platformPolicy counts', () => {
    // The writer and the check have to be looking at the same thing, or the
    // budget is a number about a different quantity.
    expect(countHashtags('Roasted Tuesday. #coldbrew #huila')).toBe(2);
    expect(countHashtags('no tags here')).toBe(0);
  });
});
