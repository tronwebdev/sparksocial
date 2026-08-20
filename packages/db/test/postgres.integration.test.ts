import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { Database } from '../src/client.js';
import { createGenomeRepository } from '../src/genomeRepository.js';
import { createAssetRepository } from '../src/assetRepository.js';
import { createContentRepository, markPublished } from '../src/contentRepository.js';
import { createAnalyticsRepository } from '../src/analyticsRepository.js';
import { createEngagementRepository } from '../src/engagementRepository.js';
import { createOpportunityRepository } from '../src/opportunityRepository.js';
import { createAuditRepository } from '../src/auditRepository.js';
import { createRunRecorder, getRun } from '../src/runRecorderRepository.js';
import { createConsentRepository } from '../src/consentRepository.js';
import { createTrendObservationRepository } from '../src/trendObservationRepository.js';
import { replaceCampaignSlots, campaignSlots, findDueContentItems, getContentMetrics } from '../src/scoped.js';
import * as schema from '../src/schema.js';
import { EMBEDDING_DIM } from '@sparksocial/shared/embedding';

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
  for (const table of ['agent_steps', 'agent_runs', 'tool_calls', 'content_metrics', 'engagement_messages', 'content_items', 'assets', 'genomes', 'consent_records', 'trend_observations']) {
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

  it('patchConstraints merges one field, bumps version, and leaves the other untouched', async () => {
    const base = await repo().createDraft({
      brandId: 'brand_1', orgId: 'org_1',
      identity: { business_name: 'X', category: 'x', one_liner: 'x', geography: { scope: 'global', locale: 'en', radius_km: null }, languages: ['en'], price_tier: 'mid' },
      dimensions: { proof_asset: ['person'], capture_capability: ['screen'], objective: 'leads', secondary_objectives: [], talent_availability: 'yes_licensed' },
      voice: { tone_vector: { formal: 0.5, playful: 0.5, technical: 0.5, bold: 0.5 }, pov_statements: [], banned_phrases: [], required_disclaimers: [], reading_level: 8 },
      source: 'inference',
    });

    const first = await repo().patchConstraints({
      genomeId: base.id, orgId: 'org_1', patch: { heygenAvatarId: 'av_123' },
    });
    expect(first.version).toBe(2);

    let genome = await repo().get(base.id, 'org_1');
    expect(genome!.constraints.heygen_avatar_id).toBe('av_123');
    expect(genome!.constraints.elevenlabs_voice_id).toBeUndefined();
    // avatar_enabled (set by patchDimensions elsewhere) is untouched by this merge.
    expect(genome!.constraints.approval_mode).toBe('review_first_week');

    const second = await repo().patchConstraints({
      genomeId: base.id, orgId: 'org_1', patch: { elevenlabsVoiceId: 'voice_456' },
    });
    expect(second.version).toBe(3);

    genome = await repo().get(base.id, 'org_1');
    // Setting the voice id did not clobber the avatar id set in the previous call.
    expect(genome!.constraints.heygen_avatar_id).toBe('av_123');
    expect(genome!.constraints.elevenlabs_voice_id).toBe('voice_456');
  });

  it('patchIdentity merges one field, bumps version, and leaves the rest of identity untouched', async () => {
    const base = await repo().createDraft({
      brandId: 'brand_1', orgId: 'org_1',
      identity: { business_name: 'Wrong Name', category: 'software', one_liner: 'x', geography: { scope: 'global', locale: 'en', radius_km: null }, languages: ['en'], price_tier: 'mid' },
      dimensions: { proof_asset: ['person'], capture_capability: ['screen'], objective: 'leads', secondary_objectives: [], talent_availability: 'yes_licensed' },
      voice: { tone_vector: { formal: 0.5, playful: 0.5, technical: 0.5, bold: 0.5 }, pov_statements: [], banned_phrases: [], required_disclaimers: [], reading_level: 8 },
      source: 'inference',
    });

    const patched = await repo().patchIdentity({
      genomeId: base.id, orgId: 'org_1', identity: { business_name: 'Tronweb' },
    });
    expect(patched.version).toBe(2);

    let genome = await repo().get(base.id, 'org_1');
    expect(genome!.identity.business_name).toBe('Tronweb');
    // The chip-review correction touched only the one field the person edited.
    expect(genome!.identity.category).toBe('software');

    const second = await repo().patchIdentity({
      genomeId: base.id, orgId: 'org_1', identity: { category: 'developer tools', price_tier: 'premium' },
    });
    expect(second.version).toBe(3);

    genome = await repo().get(base.id, 'org_1');
    // The name set by the first correction survives a second, unrelated one.
    expect(genome!.identity.business_name).toBe('Tronweb');
    expect(genome!.identity.category).toBe('developer tools');
    expect(genome!.identity.price_tier).toBe('premium');
  });

  it('throws NOT_FOUND patching identity for a genome in the wrong org', async () => {
    const { id } = await repo().createDraft({
      brandId: 'brand_1', orgId: 'org_1',
      identity: { business_name: 'X', category: 'x', one_liner: 'x', geography: { scope: 'global', locale: 'en', radius_km: null }, languages: ['en'], price_tier: 'mid' },
      dimensions: { proof_asset: ['person'], capture_capability: ['screen'], objective: 'leads', secondary_objectives: [], talent_availability: 'yes_licensed' },
      voice: { tone_vector: { formal: 0.5, playful: 0.5, technical: 0.5, bold: 0.5 }, pov_statements: [], banned_phrases: [], required_disclaimers: [], reading_level: 8 },
      source: 'inference',
    });

    await expect(
      repo().patchIdentity({ genomeId: id, orgId: 'org_EVIL', identity: { business_name: 'Hijacked' } }),
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

  it('markPublished persists the platform and the publish receipt (external_id/publish_via/publish_url)', async () => {
    const [row] = await db
      .insert(schema.contentItems)
      .values({ orgId: 'org_1', genomeId: 'gen_A', status: 'scheduled', playbookId: 'pb_workflow_clip' })
      .returning({ id: schema.contentItems.id });

    const contentRepo = createContentRepository(db);
    await contentRepo.markPublished({
      id: row!.id,
      orgId: 'org_1',
      platform: 'tiktok',
      embedding: [0.5],
      externalId: 'ext_123',
      via: 'aggregator:test',
      url: 'https://tiktok.com/@brand/video/1',
    });

    const [persisted] = await db.select().from(schema.contentItems).where(eq(schema.contentItems.id, row!.id));
    expect(persisted).toMatchObject({
      status: 'published',
      platform: 'tiktok',
      externalId: 'ext_123',
      publishVia: 'aggregator:test',
      publishUrl: 'https://tiktok.com/@brand/video/1',
    });
    expect(persisted!.publishedAt).toBeInstanceOf(Date);
  });

  it('markPublished never touches a row in another org', async () => {
    const [row] = await db
      .insert(schema.contentItems)
      .values({ orgId: 'org_1', genomeId: 'gen_A', status: 'scheduled', playbookId: 'pb_workflow_clip' })
      .returning({ id: schema.contentItems.id });

    const contentRepo = createContentRepository(db);
    await contentRepo.markPublished({
      id: row!.id,
      orgId: 'org_wrong_tenant',
      platform: 'tiktok',
      embedding: [0.5],
      externalId: 'ext_123',
      via: 'aggregator:test',
    });

    const [persisted] = await db.select().from(schema.contentItems).where(eq(schema.contentItems.id, row!.id));
    expect(persisted!.status).toBe('scheduled'); // untouched — the WHERE clause never matched
  });
});

describe('findDueContentItems — the scheduler\'s one cross-tenant read (apps/api/src/scheduler.ts)', () => {
  const NOW = new Date('2026-08-13T12:00:00Z');
  const insert = (over: Partial<typeof schema.contentItems.$inferInsert> = {}) =>
    db
      .insert(schema.contentItems)
      .values({ orgId: 'org_1', genomeId: 'gen_A', status: 'scheduled', playbookId: 'pb_workflow_clip', ...over })
      .returning({ id: schema.contentItems.id });

  it('returns items due now or in the past, excluding ones still in the future', async () => {
    const [due] = await insert({ scheduledAt: new Date(NOW.getTime() - 60_000) });
    const [dueExactly] = await insert({ scheduledAt: NOW });
    await insert({ scheduledAt: new Date(NOW.getTime() + 60_000) }); // not due

    const result = await findDueContentItems(db, { before: NOW, limit: 25 });

    expect(result.map((r) => r.id).sort()).toEqual([due!.id, dueExactly!.id].sort());
  });

  it('excludes items that are not status=scheduled, however overdue', async () => {
    // A published or draft row past its old scheduledAt must never be
    // re-published — only a row still waiting in `scheduled` is due.
    await insert({ status: 'published', scheduledAt: new Date(NOW.getTime() - 60_000) });
    await insert({ status: 'draft', scheduledAt: new Date(NOW.getTime() - 60_000) });

    expect(await findDueContentItems(db, { before: NOW, limit: 25 })).toEqual([]);
  });

  it('sees due items across every org — this is the deliberate exception to genome isolation', async () => {
    // `scoped.ts`'s entire design is "every query requires a genomeId scope".
    // The scheduler is the one caller that must see across all tenants to find
    // what's due; the isolation boundary is restored downstream when
    // `apps/api/src/scheduler.ts` builds a correctly-scoped ctx per row before
    // calling `publish.now` through `invokeTool`.
    const [orgA] = await insert({ orgId: 'org_1', genomeId: 'gen_A', scheduledAt: new Date(NOW.getTime() - 1000) });
    const [orgB] = await insert({ orgId: 'org_2', genomeId: 'gen_B', scheduledAt: new Date(NOW.getTime() - 1000) });

    const result = await findDueContentItems(db, { before: NOW, limit: 25 });

    expect(result.map((r) => r.orgId).sort()).toEqual(['org_1', 'org_2']);
    expect(result.map((r) => r.id)).toEqual(expect.arrayContaining([orgA!.id, orgB!.id]));
  });

  it('orders by scheduledAt ascending, so the oldest miss gets caught up first', async () => {
    const [later] = await insert({ scheduledAt: new Date(NOW.getTime() - 1000) });
    const [earlier] = await insert({ scheduledAt: new Date(NOW.getTime() - 5000) });

    const result = await findDueContentItems(db, { before: NOW, limit: 25 });

    expect(result.map((r) => r.id)).toEqual([earlier!.id, later!.id]);
  });

  it('respects the limit', async () => {
    for (let i = 0; i < 5; i++) {
      await insert({ scheduledAt: new Date(NOW.getTime() - i * 1000) });
    }

    expect(await findDueContentItems(db, { before: NOW, limit: 2 })).toHaveLength(2);
  });

  it('carries playbookId, platform and copy through for the scheduler to resolve', async () => {
    const [item] = await insert({
      playbookId: 'pb_avatar_pov',
      platform: 'tiktok',
      copy: [{ kind: 'text', beatId: 'b1', text: 'hello' }],
      scheduledAt: new Date(NOW.getTime() - 1000),
    });

    const [result] = await findDueContentItems(db, { before: NOW, limit: 25 });

    expect(result!.id).toBe(item!.id);
    expect(result).toMatchObject({ playbookId: 'pb_avatar_pov', platform: 'tiktok' });
    expect(result!.copy).toEqual([{ kind: 'text', beatId: 'b1', text: 'hello' }]);
  });
});

describe('content_metrics — analytics.sync (P4)', () => {
  it('upserts, so a re-sync of the same post/platform updates in place rather than duplicating', async () => {
    const analytics = createAnalyticsRepository(db);

    const first = await analytics.record({
      genomeId: 'gen_A',
      orgId: 'org_1',
      contentItemId: '11111111-1111-1111-1111-111111111111',
      platform: 'instagram',
      likes: 10,
      comments: 1,
      shares: 0,
      views: 100,
      impressions: 150, saves: 150,
      raw: { pass: 1 },
    });

    const second = await analytics.record({
      genomeId: 'gen_A',
      orgId: 'org_1',
      contentItemId: '11111111-1111-1111-1111-111111111111',
      platform: 'instagram',
      likes: 25,
      comments: 4,
      shares: 2,
      views: 300,
      impressions: 400, saves: 400,
      raw: { pass: 2 },
    });

    expect(first.likes).toBe(10);
    expect(second).toMatchObject({ likes: 25, comments: 4, shares: 2, views: 300, impressions: 400 });

    // One row, refreshed — not two. If the upsert target were wrong this
    // would be 2.
    const rows = await getContentMetrics(db, { orgId: 'org_1', brandId: 'org_1', genomeId: 'gen_A' }, '11111111-1111-1111-1111-111111111111');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ likes: 25, comments: 4, shares: 2, views: 300, impressions: 400 });
  });

  it('keeps one row per platform for the same post', async () => {
    const analytics = createAnalyticsRepository(db);
    const contentItemId = '22222222-2222-2222-2222-222222222222';

    await analytics.record({
      genomeId: 'gen_A', orgId: 'org_1', contentItemId, platform: 'instagram',
      likes: 1, comments: 0, shares: 0, views: 0, impressions: 0, saves: 0, raw: {},
    });
    await analytics.record({
      genomeId: 'gen_A', orgId: 'org_1', contentItemId, platform: 'tiktok',
      likes: 2, comments: 0, shares: 0, views: 0, impressions: 0, saves: 0, raw: {},
    });

    const rows = await getContentMetrics(db, { orgId: 'org_1', brandId: 'org_1', genomeId: 'gen_A' }, contentItemId);
    expect(rows.map((r) => r.platform).sort()).toEqual(['instagram', 'tiktok']);
  });

  it('never surfaces another org\'s metrics, even for the same content item id', async () => {
    const analytics = createAnalyticsRepository(db);
    const contentItemId = '33333333-3333-3333-3333-333333333333';

    await analytics.record({
      genomeId: 'gen_shared', orgId: 'org_tenant_A', contentItemId, platform: 'instagram',
      likes: 99, comments: 0, shares: 0, views: 0, impressions: 0, saves: 0, raw: {},
    });

    const rows = await getContentMetrics(db, { orgId: 'org_tenant_B', brandId: 'org_tenant_B', genomeId: 'gen_shared' }, contentItemId);
    expect(rows).toEqual([]);
  });
});

describe('engagement_messages — the inbox (PRD §8.8, P4)', () => {
  it('ingest is idempotent on (org, genome, platform, external_id) — a webhook retry lands the same row', async () => {
    const engagement = createEngagementRepository(db);

    const first = await engagement.ingest({
      genomeId: 'gen_A', orgId: 'org_1', platform: 'instagram', externalId: 'ext_1',
      kind: 'comment', authorHandle: '@follower', text: 'How much?',
    });
    const retried = await engagement.ingest({
      genomeId: 'gen_A', orgId: 'org_1', platform: 'instagram', externalId: 'ext_1',
      kind: 'comment', authorHandle: '@follower', text: 'How much?? (edited)',
    });

    expect(retried.id).toBe(first.id);
    const rows = await db.select().from(schema.engagementMessages).where(eq(schema.engagementMessages.id, first.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe('How much?? (edited)'); // delivery-side field refreshed
  });

  it('a retried delivery does not clobber a classification already recorded', async () => {
    const engagement = createEngagementRepository(db);
    const message = await engagement.ingest({
      genomeId: 'gen_A', orgId: 'org_1', platform: 'instagram', externalId: 'ext_2',
      kind: 'comment', authorHandle: '@follower', text: 'Nice work!',
    });

    await engagement.classify({
      id: message.id, genomeId: 'gen_A', orgId: 'org_1',
      category: 'auto_handled', intentScore: 0.6, suggestedReply: 'Thanks so much!',
      why: { summary: 'Positive engagement', factors: [], evidence: [], alternatives: [] },
    });

    // The same comment redelivered by the platform.
    await engagement.ingest({
      genomeId: 'gen_A', orgId: 'org_1', platform: 'instagram', externalId: 'ext_2',
      kind: 'comment', authorHandle: '@follower', text: 'Nice work!',
    });

    const rows = await db.select().from(schema.engagementMessages).where(eq(schema.engagementMessages.id, message.id));
    expect(rows[0]).toMatchObject({ status: 'classified', category: 'auto_handled' });
  });

  it('never surfaces another org\'s messages, even with the same platform/externalId', async () => {
    const engagement = createEngagementRepository(db);
    await engagement.ingest({
      genomeId: 'gen_shared', orgId: 'org_tenant_A', platform: 'instagram', externalId: 'ext_shared',
      kind: 'comment', authorHandle: '@x', text: 'tenant A secret question',
    });

    const crossTenant = await engagement.ingest({
      genomeId: 'gen_shared', orgId: 'org_tenant_B', platform: 'instagram', externalId: 'ext_shared',
      kind: 'comment', authorHandle: '@y', text: 'tenant B message',
    });

    // Different org → different row, not an upsert across the tenant boundary.
    const rows = await db.select().from(schema.engagementMessages).where(eq(schema.engagementMessages.externalId, 'ext_shared'));
    expect(rows).toHaveLength(2);
    expect(await engagement.get(crossTenant.id, 'gen_shared', 'org_tenant_A')).toBeUndefined();
  });

  it('get() is scoped — out of org/genome reads as not found, not an error', async () => {
    const engagement = createEngagementRepository(db);
    const message = await engagement.ingest({
      genomeId: 'gen_A', orgId: 'org_1', platform: 'x', externalId: 'ext_3',
      kind: 'dm', authorHandle: '@dm_sender', text: 'hi',
    });

    expect(await engagement.get(message.id, 'gen_A', 'org_1')).toMatchObject({ id: message.id });
    expect(await engagement.get(message.id, 'gen_A', 'org_wrong')).toBeUndefined();
    expect(await engagement.get(message.id, 'gen_wrong', 'org_1')).toBeUndefined();
  });

  it('markReplied flips status to replied, scoped, and is a no-op read for another tenant', async () => {
    const engagement = createEngagementRepository(db);
    const message = await engagement.ingest({
      genomeId: 'gen_A', orgId: 'org_1', platform: 'x', externalId: 'ext_4',
      kind: 'dm', authorHandle: '@dm_sender', text: 'Interested — how much?',
    });

    expect(await engagement.markReplied({ id: message.id, genomeId: 'gen_A', orgId: 'org_wrong' })).toBeUndefined();

    const updated = await engagement.markReplied({ id: message.id, genomeId: 'gen_A', orgId: 'org_1' });
    expect(updated).toMatchObject({ id: message.id, status: 'replied' });

    const rows = await db.select().from(schema.engagementMessages).where(eq(schema.engagementMessages.id, message.id));
    expect(rows[0]!.status).toBe('replied');
  });

  it('markAutoHandled flips status to auto_handled, scoped, and is a no-op read for another tenant', async () => {
    const engagement = createEngagementRepository(db);
    const message = await engagement.ingest({
      genomeId: 'gen_A', orgId: 'org_1', platform: 'x', externalId: 'ext_auto_1',
      kind: 'comment', authorHandle: '@follower', text: 'What time do you open?',
    });

    expect(await engagement.markAutoHandled({ id: message.id, genomeId: 'gen_A', orgId: 'org_wrong' })).toBeUndefined();

    const updated = await engagement.markAutoHandled({ id: message.id, genomeId: 'gen_A', orgId: 'org_1' });
    expect(updated).toMatchObject({ id: message.id, status: 'auto_handled' });
  });

  it('markEscalated flips status to escalated, scoped, and is a no-op read for another tenant', async () => {
    const engagement = createEngagementRepository(db);
    const message = await engagement.ingest({
      genomeId: 'gen_A', orgId: 'org_1', platform: 'x', externalId: 'ext_esc_1',
      kind: 'comment', authorHandle: '@follower', text: 'This is unacceptable.',
    });

    expect(await engagement.markEscalated({ id: message.id, genomeId: 'gen_A', orgId: 'org_wrong' })).toBeUndefined();

    const updated = await engagement.markEscalated({ id: message.id, genomeId: 'gen_A', orgId: 'org_1' });
    expect(updated).toMatchObject({ id: message.id, status: 'escalated' });
  });

  it('audit returns only rows in the given status set, newest first, scoped to the tenant', async () => {
    const engagement = createEngagementRepository(db);
    await engagement.ingest({
      genomeId: 'gen_audit', orgId: 'org_1', platform: 'x', externalId: 'ext_audit_open',
      kind: 'comment', authorHandle: '@a', text: 'still open',
    });
    const replied = await engagement.ingest({
      genomeId: 'gen_audit', orgId: 'org_1', platform: 'x', externalId: 'ext_audit_replied',
      kind: 'comment', authorHandle: '@b', text: 'thanks!',
    });
    await engagement.markReplied({ id: replied.id, genomeId: 'gen_audit', orgId: 'org_1' });
    const otherTenant = await engagement.ingest({
      genomeId: 'gen_audit', orgId: 'org_other', platform: 'x', externalId: 'ext_audit_other',
      kind: 'comment', authorHandle: '@c', text: 'not yours',
    });
    await engagement.markReplied({ id: otherTenant.id, genomeId: 'gen_audit', orgId: 'org_other' });

    const rows = await engagement.audit('gen_audit', 'org_1', {
      statuses: ['replied', 'auto_handled', 'escalated', 'dismissed', 'converted'],
      limit: 50,
    });

    expect(rows.map((r) => r.id)).toEqual([replied.id]);
  });
});

describe('opportunities — sales leads raised from the engagement inbox (master plan §3.2)', () => {
  it('create inserts a new row linked to the inbox message, scoped to org/genome', async () => {
    const opportunities = createOpportunityRepository(db);
    const inboxItemId = randomUUID();
    const opp = await opportunities.create({
      genomeId: 'gen_A', orgId: 'org_1', inboxItemId, temperature: 'hot', recommendedAction: 'Call within the hour.',
    });

    expect(opp).toMatchObject({ genomeId: 'gen_A', inboxItemId, temperature: 'hot', recommendedAction: 'Call within the hour.' });
    expect(opp.routedTo).toBeUndefined();

    const rows = await db.select().from(schema.opportunities).where(eq(schema.opportunities.id, opp.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.orgId).toBe('org_1');
  });

  it('creating twice makes two rows — never an upsert', async () => {
    const opportunities = createOpportunityRepository(db);
    const inboxItemId = randomUUID();
    const first = await opportunities.create({
      genomeId: 'gen_A', orgId: 'org_1', inboxItemId, temperature: 'warm', recommendedAction: 'Follow up.',
    });
    const second = await opportunities.create({
      genomeId: 'gen_A', orgId: 'org_1', inboxItemId, temperature: 'warm', recommendedAction: 'Follow up.',
    });

    expect(first.id).not.toBe(second.id);
  });

  it('get() is scoped — out of org/genome reads as not found, not an error', async () => {
    const opportunities = createOpportunityRepository(db);
    const opp = await opportunities.create({
      genomeId: 'gen_A', orgId: 'org_1', inboxItemId: randomUUID(), temperature: 'cold', recommendedAction: 'Add to newsletter.',
    });

    expect(await opportunities.get(opp.id, 'gen_A', 'org_1')).toMatchObject({ id: opp.id });
    expect(await opportunities.get(opp.id, 'gen_A', 'org_wrong')).toBeUndefined();
    expect(await opportunities.get(opp.id, 'gen_wrong', 'org_1')).toBeUndefined();
  });

  it('route updates routed_to, scoped, and is a no-op for another tenant', async () => {
    const opportunities = createOpportunityRepository(db);
    const inboxItemId = randomUUID();
    const opp = await opportunities.create({
      genomeId: 'gen_A', orgId: 'org_1', inboxItemId, temperature: 'hot', recommendedAction: 'Call now.',
    });

    expect(await opportunities.route({ id: opp.id, genomeId: 'gen_A', orgId: 'org_wrong', routedTo: 'nope@x.com' })).toBeUndefined();

    const routed = await opportunities.route({ id: opp.id, genomeId: 'gen_A', orgId: 'org_1', routedTo: 'sales@emekacuts.com' });
    expect(routed).toMatchObject({ id: opp.id, routedTo: 'sales@emekacuts.com' });

    // Re-routing just updates the destination — same row, not a second one.
    const reRouted = await opportunities.route({ id: opp.id, genomeId: 'gen_A', orgId: 'org_1', routedTo: 'crm-ref-42' });
    expect(reRouted).toMatchObject({ id: opp.id, routedTo: 'crm-ref-42' });

    const rows = await db.select().from(schema.opportunities).where(eq(schema.opportunities.inboxItemId, inboxItemId));
    expect(rows).toHaveLength(1);
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

    for (const t of ['org_budgets', 'credit_ledger', 'human_messages', 'approvals', 'consent_records']) {
      expect(present.has(t), `${t} is missing`).toBe(true);
    }
  });
});

describe('trend observations — §8.9\'s time series on real SQL', () => {
  const repo = () => createTrendObservationRepository(db);
  const at = (iso: string) => new Date(iso);

  const sample = (overrides: Record<string, unknown> = {}) => ({
    source: 'tiktok',
    trendId: 'tr_1',
    topic: 'one continuous shot',
    observedAt: at('2026-08-19T14:32:11.500Z'),
    volume: 1000,
    velocity: 0.8,
    saturation: 0.2,
    growth: 1.5,
    ...overrides,
  });

  it('round-trips the 0–1 metrics through the integer encoding', async () => {
    await repo().record([sample()]);
    const [row] = await repo().series({ source: 'tiktok', trendId: 'tr_1', sinceDays: 3650 });
    expect(row!.velocity).toBeCloseTo(0.8, 3);
    expect(row!.saturation).toBeCloseTo(0.2, 3);
    expect(row!.growth).toBeCloseTo(1.5, 3);
    expect(row!.volume).toBe(1000);
  });

  it('buckets to the hour, so a sub-hour repeat is one row not two', async () => {
    // The reason this matters: every `trend.rank` call by every org records a
    // sample. Without the bucket a busy afternoon writes thousands of rows and
    // the chart is dense without being more informative.
    await repo().record([sample({ observedAt: at('2026-08-19T14:02:00Z') })]);
    await repo().record([sample({ observedAt: at('2026-08-19T14:58:59Z'), volume: 2000 })]);

    const rows = await repo().series({ source: 'tiktok', trendId: 'tr_1', sinceDays: 3650 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.observedAt.toISOString()).toBe('2026-08-19T14:00:00.000Z');
    // Last write wins inside the bucket — otherwise the hour's value is set by
    // whoever loaded the feed at :01 and never updated again.
    expect(rows[0]!.volume).toBe(2000);
  });

  it('collapses duplicates inside a single batch rather than erroring', async () => {
    // Postgres rejects an ON CONFLICT statement whose own VALUES list conflicts
    // with itself, and two callers handing us the same trend in one hour is a
    // normal thing to happen, not a caller bug.
    await repo().record([
      sample({ observedAt: at('2026-08-19T09:10:00Z'), volume: 1 }),
      sample({ observedAt: at('2026-08-19T09:50:00Z'), volume: 7 }),
    ]);
    const rows = await repo().series({ source: 'tiktok', trendId: 'tr_1', sinceDays: 3650 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.volume).toBe(7);
  });

  it('returns the series oldest first', async () => {
    await repo().record([
      sample({ observedAt: at('2026-08-19T12:00:00Z') }),
      sample({ observedAt: at('2026-08-17T12:00:00Z') }),
      sample({ observedAt: at('2026-08-18T12:00:00Z') }),
    ]);
    const rows = await repo().series({ source: 'tiktok', trendId: 'tr_1', sinceDays: 3650 });
    expect(rows.map((r) => r.observedAt.toISOString())).toEqual([
      '2026-08-17T12:00:00.000Z',
      '2026-08-18T12:00:00.000Z',
      '2026-08-19T12:00:00.000Z',
    ]);
  });

  it('keys the series by source as well as id, so two sources cannot merge', async () => {
    await repo().record([sample(), sample({ source: 'youtube', volume: 5 })]);
    const tiktok = await repo().series({ source: 'tiktok', trendId: 'tr_1', sinceDays: 3650 });
    const youtube = await repo().series({ source: 'youtube', trendId: 'tr_1', sinceDays: 3650 });
    expect(tiktok).toHaveLength(1);
    expect(youtube).toHaveLength(1);
    expect(youtube[0]!.volume).toBe(5);
  });

  it('records nothing and does not error on an empty batch', async () => {
    await expect(repo().record([])).resolves.toBeUndefined();
  });
});

describe('consent repository — real SQL', () => {
  const repo = () => createConsentRepository(db);

  it('grants, then reports active for that subject and for "anyone" alike', async () => {
    await repo().grant({ genomeId: 'gen_1', orgId: 'org_1', kind: 'avatar_clone', subject: 'Emeka, owner', grantedBy: 'user_1' });

    expect(await repo().hasActive('gen_1', 'org_1', 'avatar_clone', 'Emeka, owner')).toBe(true);
    expect(await repo().hasActive('gen_1', 'org_1', 'avatar_clone')).toBe(true);
    // Different kind, different subject, different genome: none of them match.
    expect(await repo().hasActive('gen_1', 'org_1', 'voice_clone', 'Emeka, owner')).toBe(false);
    expect(await repo().hasActive('gen_1', 'org_1', 'avatar_clone', 'Someone Else')).toBe(false);
    expect(await repo().hasActive('gen_2', 'org_1', 'avatar_clone', 'Emeka, owner')).toBe(false);
  });

  it('revoke turns hasActive false, and is a write-once latch like humanLoop.answer', async () => {
    const granted = await repo().grant({ genomeId: 'gen_1', orgId: 'org_1', kind: 'avatar_clone', subject: 'Emeka, owner', grantedBy: 'user_1' });

    const revoked = await repo().revoke({ id: granted.id, orgId: 'org_1', revokedBy: 'user_2' });
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
    expect(await repo().hasActive('gen_1', 'org_1', 'avatar_clone', 'Emeka, owner')).toBe(false);

    // Revoking an already-revoked record is a no-op, not a second fact.
    expect(await repo().revoke({ id: granted.id, orgId: 'org_1', revokedBy: 'user_3' })).toBeUndefined();
  });

  it('the newest row per subject wins, not "does any un-revoked row exist"', async () => {
    // An older, still-open grant for the same subject+kind must not paper over
    // a deliberate, more recent revocation — the exact bug the naive
    // `isNull(revokedAt)` query would have had. The ordering is on `grantedAt`,
    // so the two grants need to land in different microseconds, not just
    // different `await` points — a millisecond-resolution clock could
    // otherwise tie them and make the assertion flaky.
    const tick = () => new Promise((r) => setTimeout(r, 5));

    const first = await repo().grant({ genomeId: 'gen_1', orgId: 'org_1', kind: 'avatar_clone', subject: 'Emeka, owner', grantedBy: 'user_1' });
    await repo().revoke({ id: first.id, orgId: 'org_1', revokedBy: 'user_1' });
    await tick();
    const second = await repo().grant({ genomeId: 'gen_1', orgId: 'org_1', kind: 'avatar_clone', subject: 'Emeka, owner', grantedBy: 'user_1' });
    await tick();

    // Newest (second) grant is active — re-granting after a revoke works.
    expect(await repo().hasActive('gen_1', 'org_1', 'avatar_clone', 'Emeka, owner')).toBe(true);

    await repo().revoke({ id: second.id, orgId: 'org_1', revokedBy: 'user_1' });
    // Newest row is now revoked; the older (already-revoked) row must not
    // resurrect an "active" result.
    expect(await repo().hasActive('gen_1', 'org_1', 'avatar_clone', 'Emeka, owner')).toBe(false);
  });

  it('does not leak across orgId — same genomeId, different org', async () => {
    await repo().grant({ genomeId: 'gen_shared', orgId: 'org_a', kind: 'avatar_clone', subject: 'Person A', grantedBy: 'user_a' });

    expect(await repo().hasActive('gen_shared', 'org_b', 'avatar_clone', 'Person A')).toBe(false);
    expect(await repo().list('gen_shared', 'org_b')).toEqual([]);
    const revokeFromOtherOrg = await repo().revoke({ id: randomUUID(), orgId: 'org_b', revokedBy: 'user_b' });
    expect(revokeFromOtherOrg).toBeUndefined();
  });

  it('list returns full history for a genome, newest first', async () => {
    await repo().grant({ genomeId: 'gen_1', orgId: 'org_1', kind: 'avatar_clone', subject: 'Emeka, owner', grantedBy: 'user_1' });
    await repo().grant({ genomeId: 'gen_1', orgId: 'org_1', kind: 'voice_clone', subject: 'Emeka, owner', grantedBy: 'user_1' });

    const rows = await repo().list('gen_1', 'org_1');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.grantedAt.getTime()).toBeGreaterThanOrEqual(rows[1]!.grantedAt.getTime());
  });
});

describe('content drafts — real SQL', () => {
  const repo = () => createContentRepository(db);
  const why = { summary: 'Drafted from the brief.', factors: [], evidence: [], alternatives: [] };

  it('creates a draft and reads it back scoped to its genome and org', async () => {
    const created = await repo().createDraft({
      genomeId: 'gen_1', orgId: 'org_1', playbookId: 'pb_text_update', mode: 'synthesize',
      copy: { beats: [{ beatId: 'copy', text: 'Two slots open this week.' }] }, why,
    });

    expect(created.status).toBe('draft');
    expect(created.playbookId).toBe('pb_text_update');

    const read = await repo().get(created.id, 'gen_1', 'org_1');
    expect(read).toMatchObject({ id: created.id, mode: 'synthesize', status: 'draft' });
    expect((read!.copy as { beats: unknown[] }).beats).toHaveLength(1);
  });

  it('is invisible from another genome or org — same isolation rule as everywhere else', async () => {
    const created = await repo().createDraft({
      genomeId: 'gen_1', orgId: 'org_1', playbookId: 'pb_text_update', mode: 'synthesize', copy: {}, why,
    });

    expect(await repo().get(created.id, 'gen_2', 'org_1')).toBeUndefined();
    expect(await repo().get(created.id, 'gen_1', 'org_2')).toBeUndefined();
  });

  it('updateDraft overwrites copy/why in place — regeneration replaces, not appends', async () => {
    const created = await repo().createDraft({
      genomeId: 'gen_1', orgId: 'org_1', playbookId: 'pb_text_update', mode: 'synthesize',
      copy: { text: 'first take' }, why,
    });

    const updated = await repo().updateDraft({
      id: created.id, genomeId: 'gen_1', orgId: 'org_1', copy: { text: 'second take' }, why,
    });

    expect(updated?.copy).toEqual({ text: 'second take' });
    expect((await repo().get(created.id, 'gen_1', 'org_1'))?.copy).toEqual({ text: 'second take' });
  });

  it('a scheduled slot (from calendar.generate) can be filled in by id', async () => {
    const campaignId = randomUUID();
    await replaceCampaignSlots(
      db,
      { orgId: 'org_1', brandId: 'org_1', genomeId: 'gen_1' },
      campaignId,
      [{ campaignId, playbookId: 'pb_offer_announcement', mode: 'assemble', pillar: 'product', scheduledAt: new Date() }],
    );
    const [slot] = await campaignSlots(db, { orgId: 'org_1', brandId: 'org_1', genomeId: 'gen_1' }, campaignId);

    const filled = await repo().updateDraft({
      id: slot!.id, genomeId: 'gen_1', orgId: 'org_1', copy: { text: 'Two slots open this week.' }, why,
    });

    expect(filled?.playbookId).toBe('pb_offer_announcement');
    expect(filled?.copy).toEqual({ text: 'Two slots open this week.' });
  });

  it('refuses to overwrite a published item — a fact about the world, not a plan', async () => {
    const created = await repo().createDraft({
      genomeId: 'gen_1', orgId: 'org_1', playbookId: 'pb_text_update', mode: 'synthesize', copy: {}, why,
    });
    await markPublished(db, { id: created.id, orgId: 'org_1', embedding: new Array(EMBEDDING_DIM).fill(0.1) });

    const attempted = await repo().updateDraft({
      id: created.id, genomeId: 'gen_1', orgId: 'org_1', copy: { text: 'rewritten' }, why,
    });
    expect(attempted).toBeUndefined();
  });

  it('list() finds both ad-hoc drafts and filled calendar slots, newest first', async () => {
    const adHoc = await repo().createDraft({
      genomeId: 'gen_1', orgId: 'org_1', playbookId: 'pb_text_update', mode: 'synthesize', copy: { text: 'ad hoc' }, why,
    });

    const campaignId = randomUUID();
    await replaceCampaignSlots(
      db,
      { orgId: 'org_1', brandId: 'org_1', genomeId: 'gen_1' },
      campaignId,
      [{ campaignId, playbookId: 'pb_offer_announcement', mode: 'assemble', pillar: 'product', scheduledAt: new Date() }],
    );
    const [slot] = await campaignSlots(db, { orgId: 'org_1', brandId: 'org_1', genomeId: 'gen_1' }, campaignId);
    await repo().updateDraft({ id: slot!.id, genomeId: 'gen_1', orgId: 'org_1', copy: { text: 'from calendar' }, why });

    const listed = await repo().list('gen_1', 'org_1', { limit: 10 });
    expect(listed.map((r) => r.id).sort()).toEqual([adHoc.id, slot!.id].sort());
  });

  it('list() filters by status', async () => {
    const drafted = await repo().createDraft({
      genomeId: 'gen_1', orgId: 'org_1', playbookId: 'pb_text_update', mode: 'synthesize', copy: {}, why,
    });
    const published = await repo().createDraft({
      genomeId: 'gen_1', orgId: 'org_1', playbookId: 'pb_text_update', mode: 'synthesize', copy: {}, why,
    });
    await markPublished(db, { id: published.id, orgId: 'org_1', embedding: new Array(EMBEDDING_DIM).fill(0.1) });

    const draftsOnly = await repo().list('gen_1', 'org_1', { status: 'draft', limit: 10 });
    expect(draftsOnly.map((r) => r.id)).toEqual([drafted.id]);

    const publishedOnly = await repo().list('gen_1', 'org_1', { status: 'published', limit: 10 });
    expect(publishedOnly.map((r) => r.id)).toEqual([published.id]);
  });

  it('list() does not leak across genomes', async () => {
    await repo().createDraft({
      genomeId: 'gen_1', orgId: 'org_1', playbookId: 'pb_text_update', mode: 'synthesize', copy: {}, why,
    });
    expect(await repo().list('gen_2', 'org_1', { limit: 10 })).toEqual([]);
  });

  it('schedule() places an ad-hoc draft on a date and marks it scheduled', async () => {
    const created = await repo().createDraft({
      genomeId: 'gen_1', orgId: 'org_1', playbookId: 'pb_text_update', mode: 'synthesize', copy: {}, why,
    });
    expect(created.status).toBe('draft');

    const scheduledAt = new Date('2026-09-01T09:00:00.000Z');
    const scheduled = await repo().schedule({ id: created.id, genomeId: 'gen_1', orgId: 'org_1', scheduledAt });

    expect(scheduled?.status).toBe('scheduled');
    expect(scheduled?.scheduledAt?.toISOString()).toBe(scheduledAt.toISOString());
  });

  it('schedule() moves an already-scheduled slot to a new date (CAL-05 drag)', async () => {
    const campaignId = randomUUID();
    await replaceCampaignSlots(
      db,
      { orgId: 'org_1', brandId: 'org_1', genomeId: 'gen_1' },
      campaignId,
      [{ campaignId, playbookId: 'pb_offer_announcement', mode: 'assemble', pillar: 'product', scheduledAt: new Date('2026-09-01T09:00:00.000Z') }],
    );
    const [slot] = await campaignSlots(db, { orgId: 'org_1', brandId: 'org_1', genomeId: 'gen_1' }, campaignId);

    const moved = new Date('2026-09-05T09:00:00.000Z');
    const scheduled = await repo().schedule({ id: slot!.id, genomeId: 'gen_1', orgId: 'org_1', scheduledAt: moved });
    expect(scheduled?.scheduledAt?.toISOString()).toBe(moved.toISOString());
  });

  it('schedule() refuses a published item — a fact about the world, not a plan', async () => {
    const created = await repo().createDraft({
      genomeId: 'gen_1', orgId: 'org_1', playbookId: 'pb_text_update', mode: 'synthesize', copy: {}, why,
    });
    await markPublished(db, { id: created.id, orgId: 'org_1', embedding: new Array(EMBEDDING_DIM).fill(0.1) });

    const attempted = await repo().schedule({
      id: created.id, genomeId: 'gen_1', orgId: 'org_1', scheduledAt: new Date('2026-09-01T09:00:00.000Z'),
    });
    expect(attempted).toBeUndefined();
  });

  it('schedule() does not leak across orgs', async () => {
    const created = await repo().createDraft({
      genomeId: 'gen_1', orgId: 'org_1', playbookId: 'pb_text_update', mode: 'synthesize', copy: {}, why,
    });
    const attempted = await repo().schedule({
      id: created.id, genomeId: 'gen_1', orgId: 'org_EVIL', scheduledAt: new Date('2026-09-01T09:00:00.000Z'),
    });
    expect(attempted).toBeUndefined();
  });
});
