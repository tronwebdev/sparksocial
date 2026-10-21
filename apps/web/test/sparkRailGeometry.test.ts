import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RAIL = readFileSync(
  join(process.cwd(), 'apps/web/src/components/command-center/SparkRail.tsx'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, ' ');

/**
 * The Command Center rail, against the prototype it was measured from.
 *
 * Two defects, both shipped in the commit that wrote the comments describing
 * the correct values, and both visible on the deployed `/agents`:
 *
 *   * The white panel and the identity card were each 100px below the offsets
 *     their own comments name, while the traits stack and the buttons stayed
 *     put. The card ran 322-445 against traits starting at 366 — a **79px
 *     overlap**, with "No voice set" and "Risk Tolerance" printed across the
 *     agent's name.
 *   * The second button was anchored `right-[25px]` where the design puts it at
 *     `left:202`. Those agree only at exactly 396px of content width; the rail
 *     is 388 with a ~330 content box, so the two **overlapped by 58px**.
 *
 * Harness-measured after, at the design's 396: card 353 wide, 21px to the
 * traits, buttons 169 each with an 8px gap — every figure the prototype's own
 * stage coordinates give (card 541..664, voice row 685, buttons at 25 and 202).
 */
describe('the rail matches the geometry its comments claim', () => {
  it('puts the panel and the card where the design does', () => {
    // 192 + 468 is exactly the 660 the rail is tall; 222 + 123 leaves the 21px
    // before the traits at 366. The wrong numbers satisfied neither.
    expect(RAIL).toContain('top-[192px] h-[468px]');
    expect(RAIL).toContain('top-[222px] h-[123px]');
    expect(RAIL).not.toContain('top-[292px]');
    expect(RAIL).not.toContain('top-[322px]');
  });

  it('leaves the traits stack clear of the card', () => {
    // The arithmetic the overlap broke, asserted rather than trusted.
    const card = /top-\[(\d+)px\] h-\[123px\]/.exec(RAIL);
    const traits = /top-\[(\d+)px\]">/.exec(RAIL.slice(RAIL.indexOf('h-[123px]')));
    expect(card).not.toBeNull();
    expect(Number(card![1]) + 123).toBeLessThanOrEqual(Number(traits![1]));
  });

  it('lays the two buttons out as a row rather than two anchors', () => {
    // `left-[25px]` + `right-[25px]` is the design's position only at exactly
    // 396px of content, and a collision at every width below it.
    expect(RAIL).toContain('absolute left-[25px] right-[25px] top-[598px] flex items-center gap-[8px]');
    expect(RAIL).not.toMatch(/absolute right-\[25px\] top-\[598px\]/);
    // basis-0 so they are equal halves rather than sized by labels that differ
    // by five characters.
    expect([...RAIL.matchAll(/shrink grow basis-0/g)]).toHaveLength(2);
  });
});
