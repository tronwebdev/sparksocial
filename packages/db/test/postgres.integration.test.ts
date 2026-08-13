import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { Database } from '../src/client.js';
import { createGenomeRepository } from '../src/genomeRepository.js';
import { createAssetRepository } from '../src/assetRepository.js';
import { createContentRepository, markPublished } from '../src/contentRepository.js';
import { createAuditRepository } from '../src/auditRepository.js';
import { createRunRecorder, getRun } from '../src/runRecorderRepository.js';
import * as schema from '../src/schema.js';

/**
 * INTEGRATION TESTS AGAINST A REAL POSTGRES ENGINE.
 *
 * `packages/tools/test/invoke.test.ts` and friends test the repositories'
 * *callers* against fakes — appropriate there, since the point of those tests is
 * the middleware chain's logic, not SQL. These tests exist because a fake
 * `ScopedDb` can never catch a wrong `WHERE` clause, a column name that drifted
 * from `schema.ts`, or an isolation predicate that silently stopped filtering.
 * That class of bug only shows up against a real query planner.
 *
 * `@electric-sql/pglite` is genuine Postgres compiled to WASM, embedded — no
 * Docker, no network, no Azure reachability required (the sandbox can't reach
 * Azure; CLAUDE.md). The one gap: this pglite build doesn't ship the `pgvector`
 * extension, so the test schema substitutes a plain `jsonb` column for
 * `embedding` and these tests do not exercise `asset.retrieve`'s cosine-distance
 * ranking SQL (`<=>`, `::vector`) — that math is unit-tested in
 * `scoped.test.ts`'s query-shape assertions and needs a real pgvector-enabled
 * Postgres (i.e. the actual Azure Flexible Server) to verify end to end. Every
 * other repository method is exercised here against real SQL: genome CRUD,
 * cross-genome isolation on real WHERE clauses, audit writes and idempotent
 * replay, and agent run/step recording.
 */

let pg: PGlite;
let db: Database;

/**
 * Apply `packages/db/migrations` — the same SQL the deploy runs.
 *
 * This used to be a hand-written `CREATE TABLE` block, and that is exactly how
 * the schema and the migrations drifted apart without a single test failing:
 * `org_budgets`, `credit_ledger`, `human_messages` and `brands.posts_per_week`
 * were added to `schema.ts` and never generated into a migration. The suite was
 * green because it was building its own tables from a second source of truth.
 *
 * Applying the real files makes this a **conformance check**: a table or column
 * that exists in `schema.ts` but in no migration now fails here rather than in
 * production, where it presents as `column "posts_per_week" does not exist` on
 * every request that touches it.
 */
async function applyMigrations(target: PGlite): Promise<string[]> {
  const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    // drizzle-kit separates statements with this marker rather than `;`,
    // because a `;` inside a function body or a string literal is not a
    // statement boundary and splitting on it corrupts them.
    for (const raw of readFileSync(join(dir, file), 'utf8').split('--> statement-breakpoint')) {
      const sql = forPglite(raw);
      if (sql.trim()) await target.exec(sql);
    }
  }
  return files;
}

/**
 * The one substitution, kept narrow and visible.
 *
 * This pglite build ships no `pgvector`, so the extension and the four
 * `vector(1536)` columns cannot be created verbatim. Everything else — every
 * table, column, default, constraint and index — is applied exactly as the
 * deploy will apply it.
 *
 * The cost is stated rather than hidden: cosine-distance ranking (`<=>`,
 * `::vector`) is still not exercised here and needs a real pgvector-enabled
 * Postgres. Its query shape is asserted in `scoped.test.ts`.
 */
function forPglite(sql: string): string {
  if (/CREATE\s+EXTENSION[^;]*vector/i.test(sql)) return '';
  return sql.replace(/\bvector\s*\(\s*\d+\s*\)/gi, 'text');
}

let migrationsApplied: string[] = [];

beforeAll(async () => {
  pg = new PGlite();
  migrationsApplied = await applyMigrations(pg);
  db = drizzle(pg, { schema }) as unknown as Database;
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  for (const table of ['agent_steps', 'agent_runs', 'tool_calls', 'content_items', 'assets', 'genomes']) {
    await pg.exec(`TRUNCATE TABLE ${table}`);
  }
});

describe('genome repository — real SQL', () => {
  const repo = () => createGenomeRepository(db);

  it('creates a draft with defaulted audience/offer/constraints/learned, then reads it back', async () => {
    const identity = {
      business_name: 'Emeka Cuts',
      category: 'barbershop',
      one_liner: 'Fades done right.',
      geography: { scope: 'local', locale: 'en-NG', radius_km: 10 },
      languages: ['en'],
      price_tier: 'mid',
    };
    const dimensions = {
      proof_asset: ['physical_craft'],
      capture_capability: ['space'],
      objective: 'bookings',
      secondary_objectives: [],
      talent_availability: 'yes_unlicensed',
    };
    const voice = {
      tone_vector: { formal: 0.3, playful: 0.5, technical: 0.1, bold: 0.4 },
      pov_statements: [],
      banned_phrases: [],
      required_disclaimers: [],
      reading_level: 8,
    };

    const { id } = await repo().createDraft({ brandId: 'brand_1', orgId: 'org_1', identity, dimensions, voice, source: 'inference' });
    const genome = await repo().get(id, 'org_1');

    expect(genome).toBeDefined();
    expect(genome!.version).toBe(1);
    expect(genome!.identity.business_name).toBe('Emeka Cuts');
    // Defaults applied by the Zod schema, not hand-written here.
    expect(genome!.constraints.approval_mode).toBe('review_first_week');
    expect(genome!.learned.confidence).toBe(0);
    expect(genome!.audience.segments).toEqual([]);
  });

  it('patchDimensions bumps version and merges avatar_enabled without clobbering other constraints', async () => {
    const base = await repo().createDraft({
      brandId: 'brand_1', orgId: 'org_1',
      identity: { business_name: 'X', category: 'x', one_liner: 'x', geography: { scope: 'global', locale: 'en', radius_km: null }, languages: ['en'], price_tier: 'mid' },
      dimensions: { proof_asset: ['person'], capture_capability: ['screen'], objective: 'leads', secondary_objectives: [], talent_availability: 'yes_licensed' },
      voice: { tone_vector: { formal: 0.5, playful: 0.5, technical: 0.5, bold: 0.5 }, pov_statements: [], banned_phrases: [], required_disclaimers: [], reading_level: 8 },
      source: 'inference',
    });

    const patched = await repo().patchDimensions({
      genomeId: base.id, orgId: 'org_1',
      dimensions: { proof_asset: ['product_ui'], capture_capability: ['screen'], objective: 'trials', secondary_objectives: [], talent_availability: 'no' },
      avatarEnabled: true,
    });
    expect(patched.version).toBe(2);

    const genome = await repo().get(base.id, 'org_1');
    expect(genome!.dimensions.objective).toBe('trials');
    expect(genome!.constraints.avatar_enabled).toBe(true);
    // approval_mode was never touched — merge, not overwrite.
    expect(genome!.constraints.approval_mode).toBe('review_first_week');
  });

  it('throws NOT_FOUND patching a genome in the wrong org — the isolation boundary on a real UPDATE', async () => {
    const { id } = await repo().createDraft({
      brandId: 'brand_1', orgId: 'org_1',
      identity: { business_name: 'X', category: 'x', one_liner: 'x', geography: { scope: 'global', locale: 'en', radius_km: null }, languages: ['en'], price_tier: 'mid' },
      dimensions: { proof_asset: ['person'], capture_capability: ['screen'], objective: 'leads', secondary_objectives: [], talent_availability: 'yes_licensed' },
      voice: { tone_vector: { formal: 0.5, playful: 0.5, technical: 0.5, bold: 0.5 }, pov_statements: [], banned_phrases: [], required_disclaimers: [], reading_level: 8 },
      source: 'inference',
    });

    await expect(
      repo().patchDimensions({
        genomeId: id, orgId: 'org_EVIL',
        dimensions: { proof_asset: ['person'], capture_capability: ['screen'], objective: 'leads', secondary_objectives: [], talent_availability: 'yes_licensed' },
        avatarEnabled: false,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('get() returns undefined for a scope mismatch rather than another org\'s genome', async () => {
    const { id } = await repo().createDraft({
      brandId: 'brand_1', orgId: 'org_1',
      identity: { business_name: 'Secret', category: 'x', one_liner: 'x', geography: { scope: 'global', locale: 'en', radius_km: null }, languages: ['en'], price_tier: 'mid' },
      dimensions: { proof_asset: ['person'], capture_capability: ['screen'], objective: 'leads', secondary_objectives: [], talent_availability: 'yes_licensed' },
      voice: { tone_vector: { formal: 0.5, playful: 0.5, technical: 0.5, bold: 0.5 }, pov_statements: [], banned_phrases: [], required_disclaimers: [], reading_level: 8 },
      source: 'inference',
    });
    expect(await repo().get(id, 'org_OTHER')).toBeUndefined();
  });

  /**
   * `listForOrg` is what tells a client which genomes it may ask for, so a leak
   * here hands an attacker the exact ids the auth resolver is meant to gate. It
   * is also the one genome read that runs *before* a genome is selected, which
   * means it cannot lean on any genome-scoped predicate — only on `orgId`.
   */
  it('listForOrg returns only the calling org\'s genomes, never another org\'s', async () => {
    const mk = (orgId: string, name: string) =>
      repo().createDraft({
        brandId: `brand_${orgId}`, orgId,
        identity: { business_name: name, category: 'x', one_liner: 'x', geography: { scope: 'global', locale: 'en', radius_km: null }, languages: ['en'], price_tier: 'mid' },
        dimensions: { proof_asset: ['person'], capture_capability: ['screen'], objective: 'leads', secondary_objectives: [], talent_availability: 'yes_licensed' },
        voice: { tone_vector: { formal: 0.5, playful: 0.5, technical: 0.5, bold: 0.5 }, pov_statements: [], banned_phrases: [], required_disclaimers: [], reading_level: 8 },
        source: 'inference',
      });

    const mine = await mk('org_list_A', 'Mine One');
    await mk('org_list_A', 'Mine Two');
    const theirs = await mk('org_list_B', 'Theirs');

    const listed = await repo().listForOrg('org_list_A');
    const ids = listed.map((g) => g.id);

    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    expect(listed.map((g) => g.name).sort()).toEqual(['Mine One', 'Mine Two']);
    expect(listed.every((g) => g.brandId === 'brand_org_list_A')).toBe(true);
  });

  it('listForOrg is empty for an org with no genomes rather than falling back to all', async () => {
    expect(await repo().listForOrg('org_with_nothing')).toEqual([]);
  });
});

describe('asset repository — cross-genome isolation on real SQL', () => {
  const repo = () => createAssetRepository(db);

  it('inventory() for genome B never reflects assets ingested for genome A', async () => {
    await repo().create({ genomeId: 'gen_A', orgId: 'org_1', url: 'https://x/a.jpg', assetRole: 'physical_capture', mediaType: 'image', rightsStatus: 'cleared', caption: 'a', embedding: [0.1], source: 'test' });
    await repo().create({ genomeId: 'gen_A', orgId: 'org_1', url: 'https://x/b.jpg', assetRole: 'physical_capture', mediaType: 'image', rightsStatus: 'cleared', caption: 'b', embedding: [0.1], source: 'test' });
    await repo().create({ genomeId: 'gen_B', orgId: 'org_1', url: 'https://x/c.jpg', assetRole: 'physical_capture', mediaType: 'image', rightsStatus: 'cleared', caption: 'c', embedding: [0.1], source: 'test' });

    expect(await repo().inventory('gen_A', 'org_1')).toEqual({ physical_capture: 2 });
    expect(await repo().inventory('gen_B', 'org_1')).toEqual({ physical_capture: 1 });
  });

  it('an asset created under one org is invisible under another, even with the same genomeId', async () => {
    // The exact leak §9/§10 warn about: an agency's genome ids are not secret,
    // so isolation cannot rest on the genome id being hard to guess.
    await repo().create({ genomeId: 'gen_shared', orgId: 'org_tenant_A', url: 'https://x/secret.jpg', assetRole: 'physical_capture', mediaType: 'image', rightsStatus: 'cleared', caption: 'tenant A secret', embedding: [0.1], source: 'test' });

    expect(await repo().inventory('gen_shared', 'org_tenant_B')).toEqual({});
    expect(await repo().captionsByRole('gen_shared', 'org_tenant_B', ['physical_capture'])).toEqual([]);
  });

  it('inventory() only counts rights-cleared assets', async () => {
    await repo().create({ genomeId: 'gen_A', orgId: 'org_1', url: 'https://x/cleared.jpg', assetRole: 'product_shot', mediaType: 'image', rightsStatus: 'cleared', caption: 'ok', embedding: [0.1], source: 'test' });
    await repo().create({ genomeId: 'gen_A', orgId: 'org_1', url: 'https://x/pending.jpg', assetRole: 'product_shot', mediaType: 'image', rightsStatus: 'pending', caption: 'not yet', embedding: [0.1], source: 'test' });

    expect(await repo().inventory('gen_A', 'org_1')).toEqual({ product_shot: 1 });
  });

  it('captionsByRole filters by role and scope together', async () => {
    await repo().create({ genomeId: 'gen_A', orgId: 'org_1', url: 'https://x/1.jpg', assetRole: 'knowledge', mediaType: 'image', rightsStatus: 'cleared', caption: 'the app supports X', embedding: [0.1], source: 'test' });
    await repo().create({ genomeId: 'gen_A', orgId: 'org_1', url: 'https://x/2.jpg', assetRole: 'product_shot', mediaType: 'image', rightsStatus: 'cleared', caption: 'a photo', embedding: [0.1], source: 'test' });

    expect(await repo().captionsByRole('gen_A', 'org_1', ['knowledge'])).toEqual(['the app supports X']);
  });

  it('info() returns rights status and lastUsedDaysAgo only for ids within scope', async () => {
    const a = await repo().create({ genomeId: 'gen_A', orgId: 'org_1', url: 'https://x/1.jpg', assetRole: 'product_shot', mediaType: 'image', rightsStatus: 'restricted', caption: 'x', embedding: [0.1], source: 'test' });
    const info = await repo().info([a.id, '00000000-0000-0000-0000-000000000000'], 'gen_A', 'org_1');

    expect(info[a.id]?.rightsStatus).toBe('restricted');
    expect(info[a.id]?.lastUsedDaysAgo).toBeUndefined(); // never used
    expect(info['00000000-0000-0000-0000-000000000000']).toBeUndefined();
  });
});

describe('content repository — publishing history for the guardrail layer', () => {
  it('recent() only returns published items within the window, scoped to org+genome', async () => {
    const contentRepo = createContentRepository(db);
    const [old, recentItem, otherGenome] = await Promise.all([
      db.insert(schema.contentItems).values({ orgId: 'org_1', genomeId: 'gen_A', status: 'draft', playbookId: 'pb_workflow_clip' }).returning({ id: schema.contentItems.id }),
      db.insert(schema.contentItems).values({ orgId: 'org_1', genomeId: 'gen_A', status: 'draft', playbookId: 'pb_workflow_clip' }).returning({ id: schema.contentItems.id }),
      db.insert(schema.contentItems).values({ orgId: 'org_1', genomeId: 'gen_B', status: 'draft', playbookId: 'pb_workflow_clip' }).returning({ id: schema.contentItems.id }),
    ]);

    // Old, outside the 30-day window.
    await markPublished(db, { id: old[0]!.id, orgId: 'org_1', embedding: [1, 0, 0], publishedAt: new Date(Date.now() - 60 * 86_400_000) });
    // Recent, inside the window.
    await markPublished(db, { id: recentItem[0]!.id, orgId: 'org_1', embedding: [0, 1, 0] });
    // Recent but a different genome — must not leak.
    await markPublished(db, { id: otherGenome[0]!.id, orgId: 'org_1', embedding: [0, 0, 1] });

    const result = await contentRepo.recent('gen_A', 'org_1', 30);
    expect(result).toHaveLength(1);
    expect(result[0]!.embedding).toEqual([0, 1, 0]);
  });

  it('derives isAvatarFormat from the playbook, not a stored flag', async () => {
    const contentRepo = createContentRepository(db);
    const [avatarItem] = await db
      .insert(schema.contentItems)
      .values({ orgId: 'org_1', genomeId: 'gen_A', status: 'draft', playbookId: 'pb_avatar_pov' })
      .returning({ id: schema.contentItems.id });
    await markPublished(db, { id: avatarItem!.id, orgId: 'org_1', embedding: [1] });

    const result = await contentRepo.recent('gen_A', 'org_1', 30);
    expect(result[0]!.isAvatarFormat).toBe(true); // pb_avatar_pov requires likeness license
  });
});

describe('audit repository — the tool_calls table', () => {
  it('writes and reads back a row with all optional fields present', async () => {
    const audit = createAuditRepository(db);
    await audit.writeToolCall({
      id: '00000000-0000-0000-0000-0000000000c1', tool: 'asset.retrieve', version: 1, caller: 'agent', orgId: 'org_1',
      brandId: 'brand_1', genomeId: 'gen_1', runId: '00000000-0000-0000-0000-000000000001', role: 'owner',
      input: { intent: 'fade' }, output: { found: 3 }, effect: 'read', decision: 'allow',
      costCents: 0, status: 'succeeded', why: { summary: 'ok', factors: [], evidence: [], alternatives: [] },
      at: new Date('2026-08-01T00:00:00Z'),
    });

    const found = await audit.lookupIdempotent!('nonexistent-key');
    expect(found).toBeUndefined(); // no idempotency key on that row
  });

  it('replays the correct row for a reused idempotency key, most recent first', async () => {
    const audit = createAuditRepository(db);
    await audit.writeToolCall({
      id: '00000000-0000-0000-0000-0000000000c1', tool: 'publish.now', version: 1, caller: 'user', orgId: 'org_1', role: 'owner',
      input: {}, output: { ok: true }, effect: 'publish', decision: 'allow', costCents: 0,
      idempotencyKey: 'run_1:tc1', status: 'succeeded', at: new Date('2026-08-01T00:00:00Z'),
    });

    const found = await audit.lookupIdempotent!('run_1:tc1');
    expect(found?.id).toBe('00000000-0000-0000-0000-0000000000c1');
    expect(found?.output).toEqual({ ok: true });
  });

  it('round-trips a gated (no output) row correctly', async () => {
    const audit = createAuditRepository(db);
    await audit.writeToolCall({
      id: '00000000-0000-0000-0000-0000000000c2', tool: 'publish.now', version: 1, caller: 'agent', orgId: 'org_1', role: 'owner',
      input: {}, effect: 'publish', decision: 'approval', ruleId: 'guardrail.flagged',
      reason: 'flagged', costCents: 0, status: 'gated', at: new Date(),
    });
    const found = await audit.lookupIdempotent!('nope');
    expect(found).toBeUndefined();
  });
});

describe('run recorder — agent_runs / agent_steps', () => {
  it('startRun then finishRun updates the same row to a terminal state', async () => {
    const recorder = createRunRecorder(db);
    await recorder.startRun({ id: '00000000-0000-0000-0000-000000000001', brandId: 'brand_1', agent: 'curator', goal: 'find photos', trigger: 'user', startedAt: new Date() });

    let run = await getRun(db, '00000000-0000-0000-0000-000000000001', 'brand_1');
    expect(run?.status).toBe('running');

    await recorder.finishRun('00000000-0000-0000-0000-000000000001', { status: 'succeeded', costCents: 5, tokens: { input: 100, output: 50 }, endedAt: new Date() });

    run = await getRun(db, '00000000-0000-0000-0000-000000000001', 'brand_1');
    expect(run?.status).toBe('succeeded');
    expect(run?.costCents).toBe(5);
    expect(run?.tokens).toEqual({ input: 100, output: 50 });
  });

  it('steps are ordered by idx, not insertion order or timestamp', async () => {
    const recorder = createRunRecorder(db);
    await recorder.startRun({ id: '00000000-0000-0000-0000-000000000002', brandId: 'brand_1', agent: 'curator', goal: 'x', trigger: 'user', startedAt: new Date() });

    // Insert out of order on purpose.
    await recorder.appendStep({ runId: '00000000-0000-0000-0000-000000000002', idx: 2, type: 'tool', payload: { step: 'c' }, ms: 10, at: new Date() });
    await recorder.appendStep({ runId: '00000000-0000-0000-0000-000000000002', idx: 0, type: 'think', payload: { step: 'a' }, ms: 10, at: new Date() });
    await recorder.appendStep({ runId: '00000000-0000-0000-0000-000000000002', idx: 1, type: 'tool', payload: { step: 'b' }, ms: 10, at: new Date() });

    // Read back and confirm idx ordering rather than relying on any implicit
    // table scan order.
    const all = await db
      .select({ idx: schema.agentSteps.idx, payload: schema.agentSteps.payload })
      .from(schema.agentSteps);
    const byIdx = [...all].sort((a, b) => a.idx - b.idx).map((s) => (s.payload as { step: string }).step);
    expect(byIdx).toEqual(['a', 'b', 'c']);
  });

  it('a run started for one brand is invisible when read under another', async () => {
    const recorder = createRunRecorder(db);
    await recorder.startRun({ id: '00000000-0000-0000-0000-000000000003', brandId: 'brand_secret', agent: 'curator', goal: 'x', trigger: 'user', startedAt: new Date() });
    expect(await getRun(db, '00000000-0000-0000-0000-000000000003', 'brand_other')).toBeUndefined();
  });

  it('links a delegated run to its parent', async () => {
    const recorder = createRunRecorder(db);
    await recorder.startRun({ id: '00000000-0000-0000-0000-0000000000aa', brandId: 'brand_1', agent: 'spark', goal: 'x', trigger: 'user', startedAt: new Date() });
    await recorder.startRun({
      id: '00000000-0000-0000-0000-0000000000bb',
      brandId: 'brand_1',
      agent: 'curator',
      goal: 'y',
      trigger: 'event',
      startedAt: new Date(),
      parentRunId: '00000000-0000-0000-0000-0000000000aa',
    });

    const child = await getRun(db, '00000000-0000-0000-0000-0000000000bb', 'brand_1');
    expect(child?.parentRunId).toBe('00000000-0000-0000-0000-0000000000aa');
  });
});

describe('migrations conform to schema.ts', () => {
  /**
   * The check that was missing, and the reason four objects reached `schema.ts`
   * with no migration behind them.
   *
   * Drizzle's `generate` diffs the schema against the migration folder, so the
   * two only agree if somebody remembered to run it. Nothing verified that they
   * had. The symptom in production is `column "posts_per_week" does not exist`
   * on every request that touches the column — which is to say, after deploy,
   * on a Friday.
   */
  // `Object.values` gives a union of each table's *specific* generic type, and
  // drizzle's `PgTable<TableConfig>` is not assignable from those — so the
  // narrowing is done with `is()` and the widening stated separately.
  const tables = Object.values(schema).flatMap((v) => (is(v, PgTable) ? [v as unknown as PgTable] : []));

  it('applies every migration file in order', () => {
    // A guard against the harness silently doing nothing: an empty folder, or a
    // path that stopped resolving, would otherwise leave every table missing
    // and every test failing for a reason that looks like a schema bug.
    expect(migrationsApplied.length).toBeGreaterThan(0);
    expect(migrationsApplied).toEqual([...migrationsApplied].sort());
  });

  it('declares at least one migration per table in schema.ts', async () => {
    const live = await pg.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const present = new Set(live.rows.map((r) => r.table_name));
    const missing = tables.map(getTableName).filter((t) => !present.has(t));

    expect(missing, `tables in schema.ts with no migration: ${missing.join(', ')}`).toEqual([]);
  });

  it('declares every column too, not just the table', async () => {
    /**
     * Table-level checking alone would have passed while `brands.posts_per_week`
     * was missing — `brands` already existed, and the new column arrived with a
     * tool that read it. Column drift is the more common failure precisely
     * because adding a column feels smaller than adding a table.
     */
    const live = await pg.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    const present = new Set(live.rows.map((r) => `${r.table_name}.${r.column_name}`));

    const missing: string[] = [];
    for (const table of tables) {
      const name = getTableName(table);
      for (const column of Object.values(getTableColumns(table))) {
        if (!present.has(`${name}.${column.name}`)) missing.push(`${name}.${column.name}`);
      }
    }

    expect(missing, `columns in schema.ts with no migration: ${missing.join(', ')}`).toEqual([]);
  });

  it('created the tables added most recently', async () => {
    // Named explicitly rather than relying on the generic sweep above: these
    // four are the ones that actually drifted, and a regression on them should
    // fail with their names in the message.
    const live = await pg.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const present = new Set(live.rows.map((r) => r.table_name));

    for (const t of ['org_budgets', 'credit_ledger', 'human_messages', 'approvals']) {
      expect(present.has(t), `${t} is missing`).toBe(true);
    }
  });
});
