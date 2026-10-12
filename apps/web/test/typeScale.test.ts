import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The type scale is declared in two places and they must agree.
 *
 * `tailwind.config.ts` decides what `text-15` renders as. `lib/utils.ts` tells
 * `tailwind-merge` that `text-15` is a *size* and not a colour — and without
 * that second declaration, `cn('text-15', 'text-ink-muted')` classifies both as
 * colours, the later wins, and **the size is deleted from the class string**.
 * Not overridden: absent. The stylesheet still contains the utility, the source
 * still reads correctly, and the element renders at its inherited size.
 *
 * This is not hypothetical. The scale grew from seven steps to twenty-two, and
 * every one of the fifteen new steps was missing from the merge list on the
 * first pass. Nothing would have failed — not the build, not the typecheck, not
 * any existing test — and about a thousand elements would have quietly lost
 * their size.
 *
 * Parsed as text rather than imported, so the test does not depend on the
 * Tailwind config being loadable in a bare vitest environment.
 */

const config = readFileSync(new URL('../tailwind.config.ts', import.meta.url), 'utf8');
const utils = readFileSync(new URL('../src/lib/utils.ts', import.meta.url), 'utf8');

function scaleFromConfig(): number[] {
  const block = config.match(/fontSize:\s*\{([\s\S]*?)\n {6}\},/);
  if (!block) throw new Error('no fontSize block in tailwind.config.ts');
  return [...block[1]!.matchAll(/^\s*(\d+):\s*\[/gm)].map((m) => Number(m[1])).sort((a, b) => a - b);
}

function scaleFromMerge(): number[] {
  const line = utils.match(/'font-size':\s*\[\{\s*text:\s*\[([^\]]*)\]/);
  if (!line) throw new Error('no font-size class group in lib/utils.ts');
  return [...line[1]!.matchAll(/'(\d+)'/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
}

describe('the type scale', () => {
  it('is declared identically to tailwind-merge, or sizes vanish at runtime', () => {
    expect(scaleFromMerge()).toEqual(scaleFromConfig());
  });

  it('is expressed in rem, so the browser font-size setting does something', () => {
    /*
     * The whole point of the change. In px a reader who has set large type gets
     * the same 11px caption as everyone else, and the setting is inert across
     * the entire product.
     */
    const block = config.match(/fontSize:\s*\{([\s\S]*?)\n {6}\},/)![1]!;
    const sizes = [...block.matchAll(/^\s*\d+:\s*\['([^']+)'/gm)].map((m) => m[1]!);
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toMatch(/rem$/);
  });

  it('gives every step a real line-height', () => {
    // `lineHeight: '100%'` was the previous value on all seven steps: text that
    // wrapped had its lines touching, and 481 call sites used it.
    const block = config.match(/fontSize:\s*\{([\s\S]*?)\n {6}\},/)![1]!;
    const leadings = [...block.matchAll(/lineHeight:\s*'([^']+)'/g)].map((m) => m[1]!);
    expect(leadings.length).toBe(scaleFromConfig().length);
    for (const lh of leadings) {
      expect(lh).not.toBe('100%');
      expect(Number(lh)).toBeGreaterThan(1);
    }
  });

  it('leaves no arbitrary px font size behind in the app', () => {
    /*
     * 1,758 of these existed in 78 distinct sizes, including `13.53px` and
     * `16.915px` — Figma export artefacts rather than decisions. A scale
     * anything can opt out of is a suggestion, so the absence is the assertion.
     */
    const offenders: string[] = [];
    const root = fileURLToPath(new URL('../src', import.meta.url));
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
          const src = readFileSync(full, 'utf8');
          // Skip the prose in `lib/utils.ts`, which names the pattern to
          // explain it rather than using it.
          for (const m of src.matchAll(/className=(?:"|'|\{`)[^"'`]*?(text-\[[\d.]+px\])/g)) {
            offenders.push(`${relative(root, full)}: ${m[1]}`);
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
