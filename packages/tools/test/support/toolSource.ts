/**
 * Reading the tool declarations out of the source, for the static checks.
 *
 * Shared by `idempotency-callsites.test.ts` and `credit-categories.test.ts`,
 * which both need the same thing: the text of every `defineTool({ … })` argument
 * object in the repo, split per block rather than per file. Two files declaring
 * this separately is how the two copies drift, and a drifted parser turns a
 * static check into a no-op that reports success.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REPO_ROOT = join(HERE, '..', '..', '..', '..');

// `.claude/worktrees/*` are full nested checkouts of this repo — walking one
// checks a second unrelated copy of every file. Same reason `isolation.test.ts`
// skips them.
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.next', '.turbo', '.claude']);

export function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * The text of each `defineTool({ … })` argument object.
 *
 * Per block, not per file: several files declare more than one tool —
 * `approvalTools.ts` has a read and a write — and attributing a file's first
 * `name:` to a property declared further down misreports both.
 */
export function toolBlocks(src: string): string[] {
  const blocks: string[] = [];
  for (const m of src.matchAll(/defineTool\(\s*\{/g)) {
    const start = src.indexOf('{', m.index!);
    let depth = 0;
    let i = start;
    for (; i < src.length; i++) {
      const c = src[i]!;
      if (c === '{' || c === '(' || c === '[') depth++;
      else if (c === '}' || c === ')' || c === ']') {
        depth--;
        if (depth === 0) break;
      }
    }
    blocks.push(src.slice(start, i + 1));
  }
  return blocks;
}

/** Every declared tool in the repo, with the source of its declaration. */
export function declaredTools(): Array<{ name: string; block: string; file: string }> {
  const out: Array<{ name: string; block: string; file: string }> = [];
  for (const base of [join(REPO_ROOT, 'packages'), join(REPO_ROOT, 'apps', 'api', 'src')]) {
    for (const file of walk(base)) {
      // `.ts` only, and never a test fixture: a stub tool declared inside a test
      // is not a tool the product ships, and holding it to the same rules sends
      // every check hunting bugs in its own scaffolding.
      if (!file.endsWith('.ts') || relative(REPO_ROOT, file).split(sep).includes('test')) continue;
      const src = readFileSync(file, 'utf8');
      for (const block of toolBlocks(src)) {
        const name = /name:\s*'([^']+)'/.exec(block)?.[1];
        if (name) out.push({ name, block, file });
      }
    }
  }
  return out;
}
