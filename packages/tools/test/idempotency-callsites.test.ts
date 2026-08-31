import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A STATIC CHECK OVER `apps/web`: every call to a non-idempotent tool carries an
 * idempotency key.
 *
 * ── Why this needs a test rather than a type ──────────────────────────────
 *
 * `invoke.ts` refuses a non-idempotent tool with no key — `INVALID_INPUT`, before
 * the handler runs. That is correct and it is the contract. But the web client
 * reaches tools by *name*, through `invoke(name, input, key?)`, so the compiler
 * cannot know that `'team.invite'` is one of the tools that needs a third
 * argument. The failure therefore lands at runtime, on a button, in production.
 *
 * It landed on seven of them: brand import, team invite, Ask Spark's draft
 * buttons, the onboarding document upload, and all three Knowledge controls.
 * Every one of those was rejected 100% of the time — not flaky, not
 * intermittent, simply dead — and two of them carried a comment *explaining*
 * that no key was sent on purpose. That is the tell: the contract reads
 * backwards. `idempotent: false` does not mean "send no key"; it means the tool
 * cannot be safely repeated, so a key is required to make a duplicated request
 * return the first result instead of doing the thing twice.
 *
 * A comment could not have prevented this, because a comment is what caused it.
 * So the rule is checked.
 *
 * ── What counts as passing ────────────────────────────────────────────────
 *
 * A third argument, whatever it is. Choosing *well* between a fresh
 * `crypto.randomUUID()` and a stable string is a judgement this cannot make —
 * see the note on `invoke()` in `apps/web/src/lib/tools.ts`. What it can do is
 * refuse the one option that is never right: omitting it.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');

// Same reason `isolation.test.ts` skips these: `.claude/worktrees/*` are full
// nested checkouts of this repo, and walking one checks a second unrelated copy
// of every file.
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.next', '.turbo', '.claude']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Tools declared `idempotent: false`, read out of the source.
 *
 * Parsed per `defineTool({...})` block rather than per file, because several
 * files declare more than one tool — `approvalTools.ts` has a read and a write,
 * and attributing the file's first `name:` to its `idempotent: false` puts
 * `queue.review.list` on this list, which sends the check hunting a bug that
 * does not exist while hiding the one that does.
 */
function nonIdempotentTools(): Set<string> {
  const names = new Set<string>();
  for (const base of ['packages', join('apps', 'api', 'src')]) {
    for (const file of walk(join(REPO_ROOT, base))) {
      if (!file.endsWith('.ts') || relative(REPO_ROOT, file).split(sep).includes('test')) continue;
      const src = readFileSync(file, 'utf8');
      for (const block of toolBlocks(src)) {
        const name = /name:\s*'([^']+)'/.exec(block)?.[1];
        if (name && /idempotent:\s*false/.test(block)) names.add(name);
      }
    }
  }
  return names;
}

/** The text of each `defineTool({ … })` argument object. */
function toolBlocks(src: string): string[] {
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

/**
 * Split a parenthesised argument list on its top-level commas.
 *
 * Counting commas naively does not work: every one of these calls passes an
 * object literal full of them. Quote tracking matters for the same reason —
 * `publish:${id}:${platform}` is a template literal containing a colon and, in
 * other call sites, a comma.
 */
export function topLevelArgs(callFromOpenParen: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let buf = '';
  let quote: string | undefined;

  for (let i = 0; i < callFromOpenParen.length; i++) {
    const c = callFromOpenParen[i]!;
    if (quote) {
      if (c === '\\') {
        buf += c + (callFromOpenParen[i + 1] ?? '');
        i++;
        continue;
      }
      if (c === quote) quote = undefined;
      buf += c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      buf += c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      depth++;
      if (depth > 1) buf += c;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) break;
      buf += c;
      continue;
    }
    if (c === ',' && depth === 1) {
      args.push(buf.trim());
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim()) args.push(buf.trim());
  return args;
}

describe('static check — non-idempotent tools are called with an idempotency key', () => {
  it('finds the tools it is guarding, so an empty list cannot pass silently', () => {
    // Without this, a regression in the parser above turns the real check into a
    // no-op that reports success — the failure mode every static check has.
    const tools = nonIdempotentTools();
    expect(tools.size).toBeGreaterThan(30);
    expect(tools.has('publish.now')).toBe(true);
    expect(tools.has('content.draft')).toBe(true);
    // A read declared idempotent must not appear, which is what catches the
    // per-file misattribution described above.
    expect(tools.has('queue.review.list')).toBe(false);
  });

  it('every apps/web call site passes one', () => {
    const tools = nonIdempotentTools();
    const offenders: string[] = [];

    for (const file of walk(join(REPO_ROOT, 'apps', 'web', 'src'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/invoke(?:<[^>]*>)?\(\s*\n?\s*'([^']+)'/g)) {
        const name = m[1]!;
        if (!tools.has(name)) continue;
        const open = src.indexOf('(', m.index!);
        if (topLevelArgs(src.slice(open)).length < 3) {
          const line = src.slice(0, m.index!).split('\n').length;
          offenders.push(`${relative(REPO_ROOT, file)}:${line} → ${name}`);
        }
      }
    }

    expect(
      offenders,
      `These tools are declared \`idempotent: false\`, so \`invoke.ts\` rejects the call before the ` +
        `handler runs and the button does nothing. Pass a third argument to \`invoke()\`: a fresh ` +
        `\`crypto.randomUUID()\` when each press is a new action, or a stable string when a repeat ` +
        `press must collapse into the first.\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});
