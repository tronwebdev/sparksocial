import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const code = (rel: string) =>
  readFileSync(join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

const DRAWER = code('apps/web/src/components/command-center/ChatDrawer.tsx');
const OFFERS = code('apps/web/src/components/settings/OffersSection.tsx');
const TREE = code('apps/web/src/components/settings/settingsTree.tsx');
const LOOP = code('packages/spark/src/loop.ts');

/**
 * The chat panel grew instead of scrolling.
 *
 * It is `fixed` with a top and no height, so it was exactly as tall as its
 * contents: every reply made it taller until it ran off the bottom of the
 * screen, and the thread's `overflow-y-auto` did nothing because its parent had
 * no height to overflow. Two more things stopped the thread scrolling on its
 * own account: a flex child will not shrink below its content without
 * `min-h-0`, and `justify-end` on a scroll container pushes overflow past the
 * top edge, where there is no scrollback to reach it.
 */
describe('the chat panel is bounded and scrolls', () => {
  it('stops at the viewport', () => {
    expect(DRAWER).toContain('max-h-[calc(100vh-102px)]');
  });

  it('lets its scrolling children shrink', () => {
    // Both panes: the thread and the conversations list.
    expect(DRAWER.match(/min-h-0 flex-1|flex min-h-0 flex-1/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('anchors messages to the bottom without owning the scroll', () => {
    expect(DRAWER).toContain('mt-auto flex flex-col gap-[18px]');
    expect(DRAWER).not.toMatch(/flex-1 flex-col justify-end gap-\[18px\] overflow-y-auto/);
  });
});

/**
 * A history of questions with no answers.
 *
 * The run recorded the goal, the steps and the cost, and not what SPARK said —
 * the panel had to print "Replies are not stored per run" where the answer
 * should be. The success path also closed the run *before* resolving the reply
 * text, which is why there was nothing to store even if there had been a
 * column.
 */
describe('a conversation can be read back', () => {
  it('resolves the reply before finishing the run', () => {
    const textAt = LOOP.indexOf('const text = finalText || fallbackText');
    const finishAt = LOOP.indexOf("finishRun(runId, { status: 'succeeded'");
    expect(textAt).toBeGreaterThan(-1);
    expect(finishAt).toBeGreaterThan(textAt);
  });

  it('stores the same text the caller receives', () => {
    expect(LOOP).toContain("finishRun(runId, { status: 'succeeded', endedAt: now(), reply: text })");
  });

  it('shows it, and says so plainly for runs that predate it', () => {
    expect(DRAWER).toContain('openRun.reply');
    expect(DRAWER).toContain('predates');
  });
});

/**
 * `GenomeOffer.products` has been an array since the schema was written, and
 * nothing in the product could write one entry, let alone four.
 */
describe('a brand can describe more than one offer', () => {
  it('has a section of its own', () => {
    expect(TREE).toContain("href: '/settings/offers'");
  });

  it('adds and removes rows', () => {
    expect(OFFERS).toContain('+ Add an offer');
    expect(OFFERS).toContain('list.filter((_, n) => n !== i)');
  });

  it('writes the whole array', () => {
    expect(OFFERS).toContain("'genome.offer.set'");
    expect(OFFERS).toContain('products: cleaned');
  });

  /*
   * An empty row at the bottom is how people leave an editor they have
   * finished with. Dropping it beats refusing the save.
   */
  it('drops nameless rows rather than refusing to save', () => {
    expect(OFFERS).toContain('.filter((p) => p.name.length > 0)');
  });

  /* The same lesson as the rename: show what was stored, not what was typed. */
  it('reflects what was stored', () => {
    expect(OFFERS).toContain('setProducts(cleaned)');
  });
});
