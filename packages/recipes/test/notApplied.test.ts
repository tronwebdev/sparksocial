import { describe, expect, it } from 'vitest';
import { withGoal } from '../src/runners.js';
import { recipeValidate } from '../src/tool.js';

/**
 * THREE RECIPE CONFIG FIELDS THAT NOTHING READ.
 *
 * `goal`, `ctaUrl` and `targetPlatforms` were declared on `RecipeCommonConfig`,
 * validated, persisted and offered by the wizard design — and a grep for readers
 * outside the file that declares them returned nothing. A recipe with a goal
 * produced posts written toward no goal; one with a CTA URL appended no CTA; one
 * with target accounts posted wherever the approval path happened to send it.
 *
 * All three are applied now — `goal` since August, the other two since 30
 * October — and these tests pin that `recipe.validate` stops naming them, so
 * "stored" and "working" stay told apart.
 */

describe('withGoal — the one that is now applied', () => {
  it('folds the goal into the intent that reaches content.draft', () => {
    expect(withGoal('New from the feed: "Pricing pages"', 'book more demos')).toBe(
      'New from the feed: "Pricing pages" — written toward: book more demos',
    );
  });

  it('puts the source material first and the goal second', () => {
    // The material is what the post is about; the goal is what it is for.
    // Leading with the goal makes every output from one recipe open the same way.
    const out = withGoal('From the imported sheet: "Row one"', 'sign-ups');
    expect(out.indexOf('Row one')).toBeLessThan(out.indexOf('sign-ups'));
  });

  it('leaves the intent untouched when there is no goal', () => {
    // What every recipe produced before this was read — the change must be a
    // no-op for a recipe nobody has set a goal on.
    expect(withGoal('An intent')).toBe('An intent');
    expect(withGoal('An intent', '   ')).toBe('An intent');
  });
});

describe('recipe.validate — reports what it does not act on', () => {
  it('says nothing is unapplied for a config that only sets honoured fields', async () => {
    const res = await recipeValidate.handler(
      { kind: 'rss', config: { feedUrl: 'https://example.com/feed.xml', goal: 'book more demos' } },
      {} as never,
    );
    expect(res.valid).toBe(true);
    // `goal` must NOT appear — it is applied now, and listing it would tell the
    // next person to go and wire something that already works.
    expect(res.notApplied).toEqual([]);
  });

  it('no longer lists ctaUrl or targetPlatforms — both are applied now', async () => {
    // Every post a recipe schedules carries the CTA as `link_url` and goes to
    // the chosen accounts, so naming either here would send the next person to
    // wire something that already works.
    const res = await recipeValidate.handler(
      {
        kind: 'rss',
        config: { feedUrl: 'https://example.com/feed.xml', ctaUrl: 'https://example.com/book', targetPlatforms: ['instagram'] },
      },
      {} as never,
    );
    expect(res.valid).toBe(true);
    expect(res.notApplied).toEqual([]);
  });

  it('refuses an account that is not a platform', async () => {
    const res = await recipeValidate.handler(
      { kind: 'rss', config: { feedUrl: 'https://example.com/feed.xml', targetPlatforms: ['myspace'] } },
      {} as never,
    );
    expect(res.valid).toBe(false);
  });

  it('still reports an invalid config as invalid', async () => {
    const bad = await recipeValidate.handler({ kind: 'rss', config: { feedUrl: 'not-a-url' } }, {} as never);
    expect(bad.valid).toBe(false);
    expect(bad.notApplied).toEqual([]);
  });
});
