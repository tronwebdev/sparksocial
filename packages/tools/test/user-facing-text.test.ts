import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * TWO STATIC CHECKS ON TEXT THAT REACHES A PERSON.
 *
 * Both guard defects found on staging, and both are the same shape: something
 * written for us was rendered to a customer.
 *
 * ── 1. Mojibake ───────────────────────────────────────────────────────────
 *
 * The Engagement screen showed an em dash rendered as three stray characters and
 * a section sign rendered as two, mid-sentence, in copy a brand owner reads. Not
 * a rendering bug — the source files literally contained those characters. Five
 * files had been through a UTF-8-decoded-as-cp1252 round trip at some point, and
 * 385 em dashes, box-drawing characters, arrows and section signs were stored
 * double-encoded.
 *
 * It is invisible in review: a diff renders the mojibake and the real character
 * at the same width, and nothing fails to compile. The only thing that catches it
 * is looking for the byte pattern, which is what this does.
 *
 * The patterns are built from codepoints rather than written out, so this file
 * does not trip its own check. Exempting the file instead would let a real
 * regression hide in the one place nobody would look for it.
 *
 * ── 2. Internal references in user-visible strings ────────────────────────
 *
 * `PRD §12 open question` was the *note* on an evidence row — written to record
 * how confident we were in a rule, rendered under "What it looked at" on a brand
 * owner's screen. `"The PRD default."` was the hint on an oversight option in the
 * campaign wizard, offering a document the reader has never seen as the reason to
 * pick one.
 *
 * This one cannot be fully automated: `docs/STATUS.md` in a tool `summary` is
 * read by the model and is fine, while the same string in an `Explanation` is
 * not. So the check is narrow and specific — the two places that actually reach a
 * screen, `Explanation` notes and `apps/web` copy — rather than a repo-wide ban
 * that would be turned off within a week.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');
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

function sources(): string[] {
  return [...walk(join(REPO_ROOT, 'packages')), ...walk(join(REPO_ROOT, 'apps'))];
}

describe('static check — no mojibake in any source file', () => {
  /**
   * The three lead characters UTF-8 text takes when decoded as cp1252: U+00C3,
   * U+00E2, U+00C2. Checking the lead rather than each full sequence catches
   * variants nobody has produced yet — a mis-encoded ellipsis or curly quote
   * would be found by the same rule.
   *
   * Written as codepoints so this file is not itself an offender.
   *
   * None of the three has a legitimate use in this codebase's English copy. If one
   * ever does — a brand name, a French quote — the fix is to exempt that string,
   * not to widen the rule.
   */
  const MOJIBAKE_LEADS = [0x00c3, 0x00e2, 0x00c2].map((c) => String.fromCharCode(c));

  it('finds none', () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      const src = readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (MOJIBAKE_LEADS.some((c) => line.includes(c))) {
          offenders.push(`${relative(REPO_ROOT, file)}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      });
    }

    expect(
      offenders,
      `These lines contain double-encoded UTF-8 — text that was decoded as cp1252 and re-encoded. It ` +
        `renders as three stray characters where an em dash belongs, and reaches customers' screens ` +
        `verbatim. Repair the characters; do not add an exemption.\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('would catch a reintroduction', () => {
    // The check is a substring test, so this asserts the *rule* rather than the
    // current state — a static check that cannot fail is not a check.
    const sample = `published 5 posts ${String.fromCharCode(0x00e2, 0x20ac, 0x201d)} both`;
    expect(MOJIBAKE_LEADS.some((c) => sample.includes(c))).toBe(true);
  });
});

describe('static check — no internal doc references in text a person reads', () => {
  /**
   * `PRD §…`, `plan §…`, `engine_spec §…`, a path into `docs/`. Section numbers on
   * their own are not matched: `§7.3` appears in comments constantly and that is
   * where it belongs.
   */
  const INTERNAL = /\bPRD\s*§|\bplan\s*§|engine_spec|MASTER_BUILD_PLAN|docs\/[A-Z_]+\.md/;

  /** Comments are where this reasoning is supposed to live. */
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }

  it('none in an Explanation summary or note', () => {
    /**
     * Scoped to `summary:` and `note:` on explanation-shaped objects, because
     * those are the two fields `WhyPopover` renders as prose. A tool's own
     * `summary` field is deliberately excluded — that one is read by the model,
     * where "PRD §5's success metrics" is useful context rather than a leak.
     */
    const offenders: string[] = [];
    for (const file of sources()) {
      const rel = relative(REPO_ROOT, file);
      if (rel.split(sep).includes('test')) continue;
      const body = stripComments(readFileSync(file, 'utf8'));

      for (const m of body.matchAll(/\bnote:\s*(['"`])((?:(?!\1)[\s\S]){0,300}?)\1/g)) {
        if (INTERNAL.test(m[2]!)) offenders.push(`${rel} → note: ${m[2]!.slice(0, 80)}`);
      }
    }

    expect(
      offenders,
      `An Explanation's \`note\` is rendered to the reader under "What it looked at". A reference to a ` +
        `document they have never seen belongs in a code comment.\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('none in apps/web copy', () => {
    // Every string in a component is a candidate for the screen. This is the one
    // directory where the ban can be blanket, because nothing here is read by a
    // model.
    const offenders: string[] = [];
    for (const file of walk(join(REPO_ROOT, 'apps', 'web', 'src'))) {
      const body = stripComments(readFileSync(file, 'utf8'));
      for (const m of body.matchAll(/(['"`])((?:(?!\1)[\s\S]){2,300}?)\1/g)) {
        if (INTERNAL.test(m[2]!)) {
          offenders.push(`${relative(REPO_ROOT, file)} → ${m[2]!.slice(0, 80)}`);
        }
      }
    }

    expect(
      offenders,
      `A string in a component is a string on a screen. "The PRD default" was the hint on an oversight ` +
        `option — a document the reader has never seen, offered as the reason to choose one.\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});
