/**
 * Pull the visible copy out of a `.dc.html` prototype.
 *
 * The prototype is a self-contained page with inline `<script>`/`<style>`, and
 * its text nodes are the design's own words — which CLAUDE.md makes the source
 * of truth for copy as much as for spacing. Extracted here rather than in a
 * browser because 61 files is a lot of navigations, and the live side is the
 * only half that genuinely needs a rendering engine.
 *
 * Template holes (`{{ x }}`) are dropped: they are data the mock fills in, not
 * copy, and keeping them would report every one as a difference.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'ui build';

export function copyOf(file) {
  const html = readFileSync(join(DIR, file), 'utf8');
  return [
    ...new Set(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, '\n')
        .split('\n')
        .map((s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim())
        // A `{{ binding }}` is data, not copy.
        .filter((s) => s && !/^\{\{.*\}\}$/.test(s) && !/^[{}\[\]();,.]+$/.test(s)),
    ),
  ];
}

if (process.argv[2]) {
  console.log(JSON.stringify(copyOf(process.argv[2]), null, 1));
} else {
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.dc.html'))) {
    console.log(`${copyOf(f).length}\t${f}`);
  }
}
