/**
 * Every `invoke('tool.name', { … })` in `apps/web`, checked against that tool's
 * real input schema.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * `invoke` is declared `(name: string, input: unknown)`. The output side is
 * typed — `invoke<ToolOutput<'brand.governance.get'>>(…)` — but the *input* is
 * `unknown`, so nothing has ever checked that the object a component sends
 * matches the schema `invoke.ts` will parse it against. Three call sites were
 * wrong, and each failed in a different way:
 *
 *   - `integration.connect` was sent `{ platform }` from Settings and from the
 *     campaign wizard. The schema is `{ genomeId, provider }`, so Zod threw and
 *     the Connect button reported an error instead of opening the consent
 *     screen. Connecting a social account was impossible from either screen.
 *   - `calendar.recommend_slot` was sent `{ campaignId, day }` instead of
 *     `{ campaignId, date }`. That one failed *silently*: the modal renders
 *     'none' on any non-success, so a failed read and a day with nothing to
 *     suggest looked identical.
 *   - Three more passed a `genomeId` to tools that take none. Zod strips an
 *     unknown key rather than rejecting it, so those did nothing at all while
 *     reading, at the call site, as though they did.
 *
 * The real fix is a typed `invoke<N extends ToolName>(name: N, input:
 * ToolInput<N>)`, which would make all of the above compile errors. That is a
 * large migration across ~320 call sites; this check is the cheap guard that
 * holds the line until then, and it costs one CI step.
 *
 * ── What it can and cannot see ───────────────────────────────────────────
 *
 * It reads `toolTypes.generated.ts` (so it is only as current as
 * `npm run generate:tool-types`) and checks call sites whose input is an object
 * literal it can parse. A call whose input is a variable, or built by a spread,
 * cannot be checked statically — those are counted and reported, never assumed
 * correct. A spread also suppresses the missing-key check for that one call,
 * since the spread may supply anything; unknown keys are still reported, because
 * an unknown key is wrong whatever else the object contains.
 */
import fs from 'node:fs';
import path from 'node:path';

const GENERATED = 'apps/web/src/lib/toolTypes.generated.ts';
const ROOT = 'apps/web/src';
const BACKSLASH = String.fromCharCode(92);

/* ── The registry's own answer: which input keys each tool has ───────────── */

function readSchemas() {
  const gen = fs.readFileSync(GENERATED, 'utf8');
  const required = new Map();
  const known = new Map();

  for (const m of gen.matchAll(/^ {2}"([^"]+)": \{\n(?: {4}input: (\{.*?\});\n)?/gm)) {
    const [, tool, input] = m;
    const req = new Set();
    const all = new Set();
    if (input) {
      for (const field of splitTopLevel(input.slice(1, -1), ';')) {
        const f = /^\s*([A-Za-z_]\w*)(\?)?:/.exec(field);
        if (!f) continue;
        all.add(f[1]);
        if (!f[2]) req.add(f[1]);
      }
    }
    required.set(tool, req);
    known.set(tool, all);
  }

  if (required.size === 0) {
    throw new Error(`Parsed no tools out of ${GENERATED} — its shape changed and this checker is now blind.`);
  }
  return { required, known };
}

/* ── Just enough parsing to read an object literal ───────────────────────── */

/** Split `body` on `sep` at nesting depth 0, respecting string literals. */
function splitTopLevel(body, sep) {
  const out = [];
  let depth = 0;
  let inStr = null;
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    const escaped = body[i - 1] === BACKSLASH;
    if (inStr) {
      cur += c;
      if (c === inStr && !escaped) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; cur += c; continue; }
    if ('{(['.includes(c)) depth++;
    if ('})]'.includes(c)) depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** The balanced `{…}` starting at `i`, which must point at the `{`. */
function readObject(src, i) {
  let depth = 0;
  let inStr = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    const escaped = src[j - 1] === BACKSLASH;
    if (inStr) { if (c === inStr && !escaped) inStr = null; continue; }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if ('{(['.includes(c)) depth++;
    else if ('})]'.includes(c)) { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  return null;
}

/**
 * Top-level keys of an object literal, shorthand included.
 * `spreads` marks a `...` element; null means it could not be parsed at all.
 */
function topLevelKeys(obj) {
  const keys = new Set();
  let spreads = false;
  for (const part of splitTopLevel(obj.slice(1, -1), ',')) {
    const t = part.trim();
    if (!t) continue;
    if (t.startsWith('...')) { spreads = true; continue; }
    const m = /^([A-Za-z_]\w*)\s*(?::|$)/.exec(t);
    if (!m) return null;
    keys.add(m[1]);
  }
  return { keys, spreads };
}

/* ── Walk apps/web and check every call site ─────────────────────────────── */

function sourceFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(e.name) && !p.endsWith(path.normalize(GENERATED))) out.push(p);
  }
  return out;
}

function main() {
  const { required, known } = readSchemas();
  const problems = [];
  let checked = 0;
  let unanalysable = 0;

  for (const file of sourceFiles(ROOT)) {
    const src = fs.readFileSync(file, 'utf8');
    const call = /\binvoke(?:OrThrow)?\s*(?:<[\s\S]*?>)?\s*\(\s*'([^']+)'\s*,\s*/g;
    let m;
    while ((m = call.exec(src))) {
      const tool = m[1];
      const at = `${file}:${src.slice(0, m.index).split('\n').length}`;

      if (!required.has(tool)) {
        problems.push({ at, tool, detail: 'not a registered tool name' });
        continue;
      }

      const objStart = m.index + m[0].length;
      if (src[objStart] !== '{') { unanalysable++; continue; }
      const obj = readObject(src, objStart);
      if (!obj) { unanalysable++; continue; }
      const parsed = topLevelKeys(obj);
      if (!parsed) { unanalysable++; continue; }

      checked++;
      const missing = parsed.spreads ? [] : [...required.get(tool)].filter((k) => !parsed.keys.has(k));
      const extra = [...parsed.keys].filter((k) => !known.get(tool).has(k));
      if (missing.length || extra.length) {
        problems.push({
          at,
          tool,
          detail: [
            missing.length ? `missing required: ${missing.join(', ')}` : '',
            extra.length ? `not in the schema (Zod will strip it): ${extra.join(', ')}` : '',
          ].filter(Boolean).join('  |  '),
        });
      }
    }
  }

  for (const p of problems) console.error(`${p.tool}\n   ${p.at}\n   ${p.detail}\n`);
  const summary = `${checked} call sites checked, ${unanalysable} not statically analysable`;

  if (problems.length) {
    console.error(
      `${problems.length} tool call(s) do not match the registry — ${summary}.\n` +
        'If a schema changed, run `npm run generate:tool-types` first; this checker reads that file.',
    );
    process.exit(1);
  }
  console.log(`Tool call inputs match the registry — ${summary}.`);
}

main();
