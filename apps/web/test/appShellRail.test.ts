import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), 'apps/web', rel), 'utf8');

/**
 * Source with the comments taken out.
 *
 * Written the obvious way first, and both negative assertions failed on this
 * file's own subject matter: the comment explaining that `mt-auto` is gone
 * contains `mt-auto`, and the one explaining that "Pro Plan" was fiction
 * contains "Pro Plan". A test that reads prose is testing the documentation.
 */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

const SHELL = code('src/components/shell/AppShell.tsx');
const PLAN = code('src/components/shell/PlanCard.tsx');

/**
 * The rail stays where it is while the page scrolls under it.
 *
 * It did not. The grid is `min-h-screen` with nothing scrolling inside it, so
 * the document scrolled and the rail went with it: measured on the deployed
 * `/home` at 1440x900, document 1465 tall against a 900 viewport, `aside` 1465
 * tall and `position: static`. The plan card sat at the bottom of that 1465px
 * column — 565px past the fold, reachable only by scrolling to the end of
 * whatever page you were on.
 *
 * Harness-measured after: scrolled 1200px down a 2436px document, the rail is
 * still at y=0 and the plan card still at 799-876 on a 900px viewport, both
 * identical to before the scroll. At a 480px window the nav is what scrolls
 * (440 into 320) and the card is still pinned at 379-456.
 */
describe('the app rail is sticky, not scrolled', () => {
  it('parks a viewport-height column at the top', () => {
    // `sticky`, not `fixed`: the grid column already reserves the rail's width,
    // and a fixed rail leaves that column empty and overlays the canvas.
    expect(SHELL).toContain('<aside className="sticky top-0 flex h-screen flex-col max-md:hidden">');
    expect(SHELL).not.toMatch(/<aside className="flex flex-col/);
  });

  it('makes the nav the part that gives on a short window', () => {
    // `min-h-0` is what allows a flex child to be shorter than its content;
    // without it the nav refuses to shrink and pushes the card off instead.
    expect(SHELL).toContain('<div className="min-h-0 flex-1 overflow-y-auto">');
  });

  it('no longer pushes the card down with a spacer', () => {
    // `mt-auto` meant "the bottom of the page" while the page was the scroller.
    expect(SHELL).not.toContain('mt-auto');
    expect(SHELL.indexOf('<PlanCard />')).toBeGreaterThan(SHELL.indexOf('overflow-y-auto'));
  });
});

/**
 * And the numbers on it are read rather than written down.
 *
 * The card carried `Pro Plan` and `1,200 credits` as literals, under a comment
 * explaining that the ledger did not exist yet. The ledger exists —
 * `/settings/credits` reports real spend against it — so the card had stopped
 * declining to invent a number and started showing one, in the single place a
 * person glances to see what is left. "Pro" is not even one of the three tiers
 * the schema has.
 */
describe('the plan card reads its own numbers', () => {
  it('has no hardcoded plan or balance', () => {
    expect(PLAN).not.toContain('Pro Plan');
    expect(PLAN).not.toContain('1,200 credits');
  });

  it('asks the two tools that own those facts', () => {
    // `org.create` with no argument is the documented read for "what plan is
    // this org on" — there is no separate `org.settings.get`.
    expect(PLAN).toContain("invoke<{ plan: string }>('org.create', {})");
    expect(PLAN).toContain("invoke<{ remainingCredits: number }>('org.usage.get', {})");
  });

  it('shows nothing rather than a fallback when the read is refused', () => {
    // Both tools are owner/admin only, deliberately: spend is commercial
    // information about the org. The rail renders for every role, so an editor
    // gets the avatar and no numbers — an empty slot says "not yours to see",
    // where a fallback number would say something false to exactly the people
    // who cannot check it.
    expect(PLAN).toContain('{credits === null ? null : (');
  });
});
