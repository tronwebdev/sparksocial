/**
 * GENERATES THE FRONTEND'S TOOL TYPES FROM THE REGISTRY.
 *
 *     npm run generate:tool-types
 *
 * ── The bug class this closes ─────────────────────────────────────────────
 *
 * `invoke<T>(name, input)` let the caller name its own output type. Four bugs
 * in this repo came from that, each one a hand-written shape that did not match
 * what the tool returns and therefore type-checked perfectly:
 *
 *   - `team.group.list` returns `id`; the caller asserted `groupId`
 *   - `brand.governance.get` returns `agentIdentity.name`; onboarding asserted
 *     a top-level `agentName`, so the field never prefilled
 *   - the same read, asserted without `named`, so the campaign wizard styled
 *     the "Your agent" placeholder as if it were a chosen name
 *   - a `Date` asserted as `Date` after crossing JSON, where it is a string
 *
 * None of these were visible to the compiler, because the assertion *was* the
 * type. This emits the real shapes so the caller cannot supply one.
 *
 * ── Why the output is self-contained ─────────────────────────────────────
 *
 * `apps/web` may import `@sparksocial/shared` and nothing else from
 * `packages/` (CLAUDE.md § Frontend rules), and `packages/db`'s isolation test
 * enforces it against *any* module specifier — `import type` included, since it
 * matches on the specifier rather than the import kind. So this writes literal
 * types with no imports at all rather than re-exporting the registry's, and the
 * invariant needs no exception.
 *
 * ── Why it is committed ──────────────────────────────────────────────────
 *
 * Generated and checked in, not generated at build time. The web app type-checks
 * in CI without the API's dependency graph, editors resolve it with no build
 * step, and a schema change shows up as a reviewable diff — which is the point:
 * a tool whose output shape changed should be visible in the pull request that
 * changed it. `npm run generate:tool-types -- --check` fails when the committed
 * file is stale, which is what CI runs.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { print } from './zod-to-ts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'apps', 'web', 'src', 'lib', 'toolTypes.generated.ts');

const CHECK = process.argv.includes('--check');

/* ── find every module that might define a tool ─────────────────────── */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const packagesDir = join(ROOT, 'packages');
const candidates = readdirSync(packagesDir)
  .filter((p) => statSync(join(packagesDir, p)).isDirectory())
  .flatMap((p) => {
    const src = join(packagesDir, p, 'src');
    try {
      return statSync(src).isDirectory() ? walk(src) : [];
    } catch {
      return [];
    }
  })
  /* Only files that mention `defineTool` can define one. */
  .filter((f) => readFileSync(f, 'utf8').includes('defineTool'));

/* ── collect the tools ──────────────────────────────────────────────── */

interface Tool {
  name: string;
  input: unknown;
  output: unknown;
  from: string;
}

const isTool = (v: unknown): v is Tool =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { name?: unknown }).name === 'string' &&
  typeof (v as { handler?: unknown }).handler === 'function' &&
  Boolean((v as { input?: { _def?: unknown } }).input?._def) &&
  Boolean((v as { output?: { _def?: unknown } }).output?._def);

const tools = new Map<string, Tool>();
const skipped: string[] = [];

for (const file of candidates) {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  } catch (e) {
    skipped.push(`${relative(ROOT, file)} — import failed: ${(e as Error).message.split('\n')[0]}`);
    continue;
  }

  for (const [exportName, value] of Object.entries(mod)) {
    if (isTool(value)) {
      tools.set(value.name, { ...value, from: relative(ROOT, file) });
      continue;
    }

    /**
     * A factory — `makeTeamInvite(deps)` and its 64 siblings. `deps` is only
     * touched inside the handler, so calling with an empty object yields the
     * tool and its schemas without needing Clerk, a model client or a database.
     * Anything that reads `deps` eagerly throws here and is reported rather
     * than silently missing.
     */
    if (typeof value === 'function' && /^make[A-Z]/.test(exportName)) {
      try {
        const made = (value as (d: unknown) => unknown)({});
        if (isTool(made)) tools.set(made.name, { ...made, from: relative(ROOT, file) });
      } catch (e) {
        skipped.push(`${exportName} in ${relative(ROOT, file)} — ${(e as Error).message.split('\n')[0]}`);
      }
    }
  }
}

/* ── print ──────────────────────────────────────────────────────────── */

const names = [...tools.keys()].sort();
const partial: string[] = [];
const entries: string[] = [];

for (const name of names) {
  const tool = tools.get(name)!;
  const inCtx = { unknowns: [] as string[], path: [] as string[] };
  const outCtx = { unknowns: [] as string[], path: [] as string[] };

  const input = print(tool.input, 'input', inCtx);
  const output = print(tool.output, 'output', outCtx);

  if (inCtx.unknowns.length || outCtx.unknowns.length) {
    partial.push(
      `${name} (${tool.from})\n` +
        [...inCtx.unknowns.map((u) => `      input.${u}`), ...outCtx.unknowns.map((u) => `      output.${u}`)].join('\n'),
    );
  }

  entries.push(`  ${JSON.stringify(name)}: {\n    input: ${input};\n    output: ${output};\n  };`);
}

const header = `/* eslint-disable */
/**
 * GENERATED — do not edit. \`npm run generate:tool-types\`.
 *
 * The input and output shape of every tool in the registry, printed from its
 * Zod schemas so a caller cannot invent one. See
 * \`scripts/generate-tool-types.mts\` for why this is committed rather than
 * built, and why it carries no imports.
 *
 * Two things are printed as the *wire* sees them, not as the server declares
 * them: a \`z.date()\` is a \`string\` (it has been through \`JSON.stringify\`), and
 * a \`.default()\` is optional on input but guaranteed on output.
 *
 * ${names.length} tools.
 */

export interface ToolIO {
${entries.join('\n')}
}

/** Every tool the registry knows. \`invoke\` accepts nothing else. */
export type ToolName = keyof ToolIO;

export type ToolInput<N extends ToolName> = ToolIO[N]['input'];
export type ToolOutput<N extends ToolName> = ToolIO[N]['output'];
`;

/* ── write, or check ────────────────────────────────────────────────── */

let existing = '';
try {
  existing = readFileSync(OUT, 'utf8');
} catch {
  /* first run */
}

if (CHECK) {
  if (existing !== header) {
    console.error(
      `[stale] ${relative(ROOT, OUT)} does not match the registry.\n` +
        '        Run `npm run generate:tool-types` and commit the result.',
    );
    process.exit(1);
  }
  console.log(`[ok] tool types match the registry (${names.length} tools).`);
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, header, 'utf8');
  console.log(`[written] ${relative(ROOT, OUT)} — ${names.length} tools.`);
}

/* ── report ─────────────────────────────────────────────────────────── */

if (skipped.length) {
  console.warn(`\n[skipped] ${skipped.length} export(s) could not be read:`);
  for (const s of skipped) console.warn(`    ${s}`);
}

if (partial.length) {
  console.warn(
    `\n[partial] ${partial.length} tool(s) have a spot that printed as \`unknown\`.\n` +
      `          Safe — a caller must narrow it — but worth knowing:`,
  );
  for (const p of partial) console.warn(`    ${p}`);
}
