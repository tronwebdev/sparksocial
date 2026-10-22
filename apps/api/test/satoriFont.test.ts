import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
/*
 * Comments stripped. Written the obvious way first and it failed on its own
 * subject matter: the comment explaining that `../../web/` is gone contains
 * `../../web/`. A test that reads prose is testing the documentation.
 */
const RUNNER = readFileSync(join(root, 'apps/api/src/satori-runner.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');
const DOCKERFILE = readFileSync(join(root, 'apps/api/Dockerfile'), 'utf8');

/**
 * The font Satori needs has to be in the image, not just in the checkout.
 *
 * `FONT_PATH` was `../../web/src/fonts/AsgardTrial-FitBold.ttf`. That file is
 * real in a clone and absent from the deployed container: `apps/api/Dockerfile`
 * copies `packages` and `apps/api` and nothing else. So every `compose.static`
 * call in production failed with
 *
 *   ENOENT: no such file or directory, open
 *   '/app/apps/web/src/fonts/AsgardTrial-FitBold.ttf'
 *
 * and no image or carousel was ever rendered there. It was invisible from the
 * UI because the read side swallows it — `content.get` wraps `listRenders` in
 * `.catch(() => [])` and `content.list` falls back to a beat's own generated
 * image, so "nothing has been rendered" and "the renderer is broken" look the
 * same on screen.
 *
 * Unit tests could not catch it because they run in the checkout, where the
 * old path resolved. These assert the two things that differ between a
 * checkout and the image: where the file is, and whether the image copies it.
 */
describe('the static renderer can find its font where it actually runs', () => {
  it('reads from inside apps/api, which the image copies wholesale', () => {
    expect(RUNNER).toContain("join(__dirname, '../assets/fonts/AsgardTrial-FitBold.ttf')");
  });

  it('does not reach into another app for an asset', () => {
    // A path the Dockerfile has no reason to satisfy and no way to advertise.
    expect(RUNNER).not.toMatch(/\.\.\/\.\.\/web\//);
    expect(RUNNER).not.toMatch(/FONT_PATH = join\(__dirname, '\.\.\/\.\.\//);
  });

  it('has the file there', () => {
    expect(existsSync(join(root, 'apps/api/assets/fonts/AsgardTrial-FitBold.ttf'))).toBe(true);
  });

  /*
   * The assertion that would have caught the original. `COPY apps/api
   * ./apps/api` is what puts the font in the image; if someone narrows that
   * line to `apps/api/src`, the font stops shipping and this fails.
   */
  it('ships the whole of apps/api, which is what carries the asset', () => {
    expect(DOCKERFILE).toMatch(/^COPY apps\/api \.\/apps\/api$/m);
  });
});
