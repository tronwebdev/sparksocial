/**
 * Markdown → PDF, for the docs that leave the repo.
 *
 *   node scripts/doc-pdf/build.mjs docs/VENDOR_SETUP.md
 *
 * Writes alongside the source: `docs/VENDOR_SETUP.md` → `docs/VENDOR_SETUP.pdf`.
 *
 * ── Why pandoc + Chrome and not one tool ──────────────────────────────────
 *
 * `pandoc --pdf-engine` needs a LaTeX distribution, and none is installed here
 * (pdflatex, xelatex, lualatex, tectonic, typst and context all absent). The
 * alternatives that render CSS directly — WeasyPrint, wkhtmltopdf — are not
 * installed either. Chrome is, on every machine that runs this product's own
 * browser tooling, and its print engine is a first-class CSS implementation.
 *
 * So: pandoc does the markdown, which it is the best in the world at, and
 * Chrome does the typesetting, which it is very good at. Neither is asked to do
 * the other's job.
 *
 * ── Why the HTML is assembled here rather than by --standalone ────────────
 *
 * Pandoc's standalone template injects an `<h1>` from the metadata title, which
 * duplicates the document's own, and a default stylesheet whose
 * `pre > code.sourceCode { white-space: pre }` makes every code block run off
 * the side of an A4 page instead of wrapping. Taking the body fragment and
 * wrapping it here avoids fighting either.
 *
 * ── One Chrome limitation worth knowing ───────────────────────────────────
 *
 * Chrome does not implement CSS Paged Media margin boxes, so `@bottom-center {
 * content: counter(page) }` does nothing — there are no page numbers. The
 * stylesheet says so rather than carrying a rule that looks like it works.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Chrome, wherever this platform keeps it. */
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    // Edge is the same engine and prints identically; a reasonable last resort
    // on a Windows machine with no Chrome.
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      'No Chrome or Edge found. Set CHROME_PATH to a Chromium-based browser — it is what does the typesetting.',
    );
  }
  return found;
}

function main() {
  const source = process.argv[2];
  if (!source) {
    console.error('usage: node scripts/doc-pdf/build.mjs <file.md>');
    process.exit(1);
  }
  if (!existsSync(source)) {
    console.error(`No such file: ${source}`);
    process.exit(1);
  }

  const out = resolve(dirname(source), `${basename(source).replace(/\.md$/i, '')}.pdf`);

  // `gfm`, not `markdown`: the docs use GitHub tables, and pandoc's own dialect
  // parses them differently.
  const fragment = execFileSync('pandoc', [source, '-f', 'gfm', '-t', 'html5'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  const css = readFileSync(join(HERE, 'print.css'), 'utf8')
    // Chrome ignores it; carrying it would imply page numbers that never appear.
    .replace(/\n {2}@bottom-center \{[^}]*\}\n/, '\n');

  const title = (/<h1[^>]*>(.*?)<\/h1>/s.exec(fragment)?.[1] ?? basename(source)).replace(/<[^>]+>/g, '');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
${css}
</style>
</head>
<body>
${fragment}
</body>
</html>
`;

  const work = mkdtempSync(join(tmpdir(), 'doc-pdf-'));
  try {
    const htmlPath = join(work, 'page.html');
    writeFileSync(htmlPath, html, 'utf8');

    execFileSync(
      findChrome(),
      [
        '--headless=new',
        '--disable-gpu',
        // Chrome's default footer stamps the file:// URL and today's date onto
        // every page, which is noise in a document meant to be shared.
        '--no-pdf-header-footer',
        `--print-to-pdf=${out}`,
        pathToFileURL(htmlPath).href,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const bytes = readFileSync(out).length;
  console.log(`${source} → ${out} (${(bytes / 1024).toFixed(0)} KB)`);
}

main();
