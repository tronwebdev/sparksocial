import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { ToolError } from '@sparksocial/shared/types';
import { assertScope, scopePredicate, buildRetrieveQuery, SCOPED_TABLE_NAMES } from '../src/scoped.js';

/**
 * THE BUILD-FAILING ISOLATION TEST (CLAUDE.md invariant 2).
 *
 * An agency runs many clients in one workspace. A client's assets must never surface
 * in another client's generation — including via embedding retrieval, which is the
 * leak everyone forgets. A UI filter is not isolation, and a `where` clause someone
 * remembered to add is not isolation either.
 *
 * So this suite does two things:
 *   1. A **static check** over the repo: no file outside `packages/db/src/scoped.ts`
 *      may reference a scoped table. That is the part that fails the build when
 *      somebody writes a raw query, which is the whole point — it catches the leak
 *      at review time rather than in a customer's account.
 *   2. Behavioural tests that the scope predicate and retrieval path actually carry
 *      the genome predicate.
 *
 * Do not add exceptions to the static check. If a new module genuinely needs one of
 * these tables, it goes through a repository function in scoped.ts.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');

/** The single module permitted to touch scoped tables directly. */
const SCOPED_MODULE = join('packages', 'db', 'src', 'scoped.ts');
/** The schema file necessarily declares them. */
const SCHEMA_MODULE = join('packages', 'db', 'src', 'schema.ts');
/** Barrel re-exports name the modules, not the tables. */
const ALLOWED = new Set([SCOPED_MODULE, SCHEMA_MODULE]);

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.next', '.turbo']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Source files, excluding this test itself (which names the tables to check them). */
function sourceFiles(): string[] {
  return walk(REPO_ROOT)
    .map((f) => relative(REPO_ROOT, f))
    .filter((f) => !f.split(sep).includes('test'));
}

describe('static check — raw queries cannot bypass the scoped layer', () => {
  it('lists the tables it is guarding, so a new scoped table cannot be added silently', () => {
    expect([...SCOPED_TABLE_NAMES].sort()).toEqual(
      ['assets', 'contentItems', 'knowledgeChunks', 'memories'].sort(),
    );
  });

  it.each([...SCOPED_TABLE_NAMES])(
    'no module outside scoped.ts references the `%s` table',
    (table) => {
      const offenders: string[] = [];

      for (const file of sourceFiles()) {
        if (ALLOWED.has(file)) continue;
        const src = readFileSync(join(REPO_ROOT, file), 'utf8');

        // Match the table as an identifier — `assets.embedding`, `from(assets)`,
        // `{ assets }` — but not `assetsScoped` or a word inside a comment sentence.
        const asIdentifier = new RegExp(`\\b${table}\\b\\s*[.,)\\]}]`, 'm');
        const asImport = new RegExp(`import[^;]*\\b${table}\\b[^;]*from\\s+['"][^'"]*schema`, 'm');

        if (asImport.test(src) || asIdentifier.test(stripComments(src))) {
          offenders.push(file);
        }
      }

      expect(
        offenders,
        `These files reach a scoped table directly. Route them through a repository ` +
          `function in ${SCOPED_MODULE} instead — a genome predicate that a developer ` +
          `has to remember is not isolation.\n  ${offenders.join('\n  ')}`,
      ).toEqual([]);
    },
  );
});

/** Crude but sufficient: prevents prose in doc comments tripping the identifier match. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * Render a Drizzle `SQL` to its parameterised text plus bound params.
 *
 * Asserting on this rather than on the object graph matters: it is the string that
 * actually reaches Postgres. A predicate that exists on the object but never makes it
 * into the emitted SQL would pass a structural check and still leak.
 */
const dialect = new PgDialect();
function render(fragment: SQL | undefined): string {
  if (!fragment) return '<none>';
  const { sql, params } = dialect.sqlToQuery(fragment);
  return `${sql} :: ${JSON.stringify(params)}`;
}

// ---------------------------------------------------------------------------

describe('assertScope', () => {
  const complete = { orgId: 'org_1', brandId: 'brand_1', genomeId: 'gen_1' };

  it('returns the scope when all three ids are present', () => {
    expect(assertScope(complete)).toEqual(complete);
  });

  it.each(['orgId', 'brandId', 'genomeId'] as const)(
    'throws ISOLATION_VIOLATION when %s is missing',
    (missing) => {
      const partial = { ...complete, [missing]: undefined };
      expect(() => assertScope(partial)).toThrow(ToolError);
      try {
        assertScope(partial);
      } catch (e) {
        expect((e as ToolError).code).toBe('ISOLATION_VIOLATION');
      }
    },
  );

  it('rejects an empty string as firmly as undefined — a blank id is not a scope', () => {
    expect(() => assertScope({ ...complete, genomeId: '' })).toThrow(ToolError);
  });
});

describe('scopePredicate', () => {
  const scope = { orgId: 'org_1', brandId: 'brand_1', genomeId: 'gen_1' };

  it.each([...SCOPED_TABLE_NAMES])('binds both org and genome for %s', (table) => {
    const emitted = render(scopePredicate(table, scope));
    expect(emitted).toContain('"org_id"');
    expect(emitted).toContain('"genome_id"');
    expect(emitted).toContain('org_1');
    expect(emitted).toContain('gen_1');
  });
});

describe('buildRetrieveQuery', () => {
  const scope = { orgId: 'org_1', brandId: 'brand_1', genomeId: 'gen_1' };
  const embedding = Array.from({ length: 8 }, (_, i) => i / 8);

  it('refuses to build a query without a complete scope', () => {
    expect(() =>
      buildRetrieveQuery({ orgId: 'org_1', brandId: 'brand_1', genomeId: '' }, { intent: 'x', embedding }),
    ).toThrow(ToolError);
  });

  it('carries the genome predicate into the emitted SQL', () => {
    const q = buildRetrieveQuery(scope, { intent: 'workflow clip b-roll', embedding });
    const where = render(q.where);
    expect(where).toContain('"genome_id"');
    expect(where).toContain('gen_1');
  });

  it('only ever returns rights-cleared assets', () => {
    const where = render(buildRetrieveQuery(scope, { intent: 'x', embedding }).where);
    expect(where).toContain('"rights_status"');
    expect(where).toContain('cleared');
  });

  it('defaults to k=8', () => {
    expect(buildRetrieveQuery(scope, { intent: 'x', embedding }).limit).toBe(8);
  });

  it('honours an explicit k', () => {
    expect(buildRetrieveQuery(scope, { intent: 'x', embedding, k: 3 }).limit).toBe(3);
  });

  it('scores by similarity minus the recency and usage penalties, not raw cosine', () => {
    // Without both penalties the same three photos surface every week and the
    // account reads as automated — the specific failure this product exists to avoid.
    const score = render(buildRetrieveQuery(scope, { intent: 'x', embedding }).score);
    expect(score).toContain('<=>'); // pgvector cosine distance
    expect(score).toContain('last_used_at'); // recency penalty term
    expect(score).toContain('usage_count'); // diversity penalty term
  });

  it('filters by required asset roles when supplied', () => {
    const where = render(
      buildRetrieveQuery(scope, {
        intent: 'x',
        embedding,
        requiredRoles: ['product_screen', 'work_artifact'],
      }).where,
    );
    expect(where).toContain('product_screen');
    expect(where).toContain('work_artifact');
  });

  it('omits the role filter when the list is empty', () => {
    const withRoles = render(buildRetrieveQuery(scope, { intent: 'x', embedding, requiredRoles: [] }).where);
    const without = render(buildRetrieveQuery(scope, { intent: 'x', embedding }).where);
    expect(withRoles).toBe(without);
  });
});
