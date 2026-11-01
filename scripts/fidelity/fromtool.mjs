/**
 * Moves a dump that arrived as a saved tool result into `dumps/`.
 *
 *   node scripts/fidelity/fromtool.mjs <saved-result-file>
 *
 * For a browser that will not let the live page reach the collector on
 * localhost at all — no fetch, no iframe, no popup (the desktop app's browser
 * pane). The page returns `FXDUMP<json>FXEND` padded past the tool's inline
 * limit, so the result is written to a file instead of read; this pulls the
 * dump back out of that file and saves it under the name the dump carries.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/fidelity/fromtool.mjs <saved-result-file>');
  process.exit(1);
}

let text = readFileSync(file, 'utf8');
try {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) text = parsed.map((p) => p.text ?? '').join('');
} catch {
  /* not the wrapped form — read it as it is */
}
// The value may arrive JSON-encoded once more, as a string literal.
if (text.trim().startsWith('"')) {
  try {
    text = JSON.parse(text.trim());
  } catch {
    /* leave as is */
  }
}

const start = text.indexOf('FXDUMP');
const end = text.indexOf('FXEND');
if (start < 0 || end < 0) {
  console.error('no FXDUMP…FXEND block in that file');
  process.exit(1);
}
let json = text.slice(start + 'FXDUMP'.length, end);
// Still escaped (`{\"name\":…`) when the wrapper encoded it twice: undo one level.
if (json.startsWith('{\\"')) json = JSON.parse(`"${json}"`);
let dump;
try {
  dump = JSON.parse(json);
} catch (e) {
  // Short: the input is a whole page's measurements.
  console.error(`not JSON: ${e instanceof Error ? e.message : e} — starts ${json.slice(0, 60)}`);
  process.exit(1);
}
const name = String(dump.name).replace(/[^a-z0-9._-]/gi, '_');
writeFileSync(join(process.cwd(), 'scripts', 'fidelity', 'dumps', `${name}.json`), json);
console.log(`saved ${name}.json — ${dump.texts.length} texts, ${dump.boxes.length} boxes, ${dump.icons?.length ?? 0} icons, from ${dump.url}`);
