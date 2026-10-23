import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const code = (rel: string) =>
  readFileSync(join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

const RUNNER = code('apps/api/src/satori-runner.ts');
const TIMELINE = code('packages/compose/src/timeline.ts');

/**
 * Four of six slides rendered as empty blue rectangles.
 *
 * `zipTimeline` blanks a still's copy when the beat has a backdrop, for a good
 * reason it states itself: the platform prints the caption under the image, so
 * burning the same sentence across the photograph shows it twice and ruins the
 * picture. That hands the renderer `text: ''` plus a `backdrop`.
 *
 * `satori-runner.ts` never read `backdrop`. So the words were dropped because
 * the picture would carry them, and the picture was never drawn. Measured on
 * the first carousel rendered in production: beats 1-4 carry backdrops and
 * came back blank, beats 5-6 do not and rendered their words. Satori lays out
 * all six strings correctly in isolation — it was never a text problem.
 */
describe('a slide whose words moved into the picture draws the picture', () => {
  it('reads the backdrop the timeline attaches', () => {
    expect(RUNNER).toContain("'backdrop' in beat ? beat.backdrop : undefined");
    expect(RUNNER).toContain("backdrop?.kind === 'image' && backdrop.urls[0]");
  });

  /*
   * The fallback matters as much as the fix. An empty frame is the one output
   * that is wrong under every interpretation — if the picture cannot be drawn,
   * the words are a better slide than nothing.
   */
  it('falls back to the words it was told to drop', () => {
    expect(TIMELINE).toContain('originalText');
    expect(TIMELINE).toContain('{ originalText: beat.text }');
    expect(RUNNER).toContain("'originalText' in beat");
  });

  it('still prefers the live text when there is any', () => {
    // `beat.text ||` first: the happy path is unchanged, and `text` stays the
    // single source of what is on screen.
    expect(RUNNER).toMatch(/beat\.text \|\| \('originalText' in beat/);
  });
});
