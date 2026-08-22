import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineTool, register, __resetRegistry, type ScopedDb } from '@sparksocial/tools';
import { runOnce, resetOutcomeObserverWarnings } from '../src/outcome-observer.js';
import { createDevStore } from '../src/dev-store.js';
import { memoryInvokeDeps } from '../src/app.js';

/**
 * THE OUTCOME OBSERVER — the clock PRD §6.7's learning loop never had.
 *
 * `analytics.sync` and `learning.record_outcome` were both built, tested and
 * registered, and nothing ever called either one. Every genome's
 * Thompson-sampling arms therefore sat at their cold-start priors forever.
 *
 * Two things are worth pinning here, and they are not the same thing:
 *
 *  - **that the tools get called at all**, through `invokeTool` rather than
 *    behind the registry's back, under the candidate's own tenant;
 *  - **which posts are selected**, which is the part that can be subtly wrong
 *    while looking like it works. Scoring a post the hour it publishes reads
 *    near-zero engagement and records it as a failure, so the mix engine learns
 *    to avoid whatever was posted most recently — confidently, because the arms
 *    fill with real-looking observations. The selection tests below are the ones
 *    that stop that.
 *
 * The selection logic is exercised through `createDevStore`, which re-expresses
 * the same cadence and maturation rules `scoped.ts` runs in SQL.
 */

const NOW = new Date('2026-08-20T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const daysAgo = (d: number) => hoursAgo(d * 24);

/* ── fake tools, registered under the real names ─────────────────────────── */

function fakeSync() {
  const calls: string[] = [];
  const tool = defineTool({
    name: 'analytics.sync',
    version: 1,
    summary: 'fake analytics.sync for outcome-observer tests',
    input: z.object({ genomeId: z.string(), contentItemId: z.string() }),
    output: z.object({ contentItemId: z.string(), syncedAt: z.string() }),
    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: true,
    async handler(input) {
      calls.push(input.contentItemId);
      return { contentItemId: input.contentItemId, syncedAt: NOW.toISOString() };
    },
  });
  return { tool, calls };
}

function fakeRecord(opts: { throwsFor?: string } = {}) {
  const calls: string[] = [];
  const tool = defineTool({
    name: 'learning.record_outcome',
    version: 1,
    summary: 'fake learning.record_outcome for outcome-observer tests',
    input: z.object({ genomeId: z.string(), contentItemId: z.string() }),
    output: z.object({ recorded: z.boolean(), reward: z.number() }),
    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: true,
    async handler(input) {
      if (opts.throwsFor === input.contentItemId) throw new Error('this genome is broken');
      calls.push(input.contentItemId);
      return { recorded: true, reward: 0.5 };
    },
  });
  return { tool, calls };
}

/* ── a seeded dev store ──────────────────────────────────────────────────── */

interface SeedPost {
  pillar?: string;
  publishedAt: Date;
  /** When its metrics were last synced. Omit for a post never synced. */
  syncedAt?: Date;
  scored?: boolean;
}

async function seed(posts: SeedPost[], orgId = 'org_1') {
  // A movable clock, so a snapshot can be placed in the past. Every cadence
  // rule under test is arithmetic over `publishedAt` and `syncedAt`; without
  // this the fixture could only ever assert that nothing is due.
  let clock = NOW;
  const store = createDevStore({ now: () => clock });
  const { id: genomeId } = await store.genomes.createDraft({
    brandId: 'brand_1',
    orgId,
    identity: {
      business_name: 'Outcome Test Co',
      category: 'test_fixture',
      one_liner: 'exists only to prove the learning loop turns',
      geography: { scope: 'global', locale: 'en-US', radius_km: null },
      languages: ['en'],
      price_tier: 'mid',
    },
    dimensions: {},
    voice: {},
    source: 'user',
  });

  const ids: string[] = [];
  for (const [i, post] of posts.entries()) {
    const draft = await store.content.createDraft({
      genomeId,
      orgId,
      playbookId: 'pb_workflow_clip',
      mode: 'synthesize',
      ...(post.pillar !== undefined ? { pillar: post.pillar } : {}),
      copy: [{ kind: 'text', beatId: 'b1', text: `post ${i}` }],
      why: { summary: 'test', factors: [], evidence: [], alternatives: [] },
    });

    await store.content.markPublished({
      id: draft.id,
      orgId,
      platform: 'instagram',
      embedding: [0.1],
      externalId: `ext_${i}`,
      via: 'test',
      publishedAt: post.publishedAt,
    });

    if (post.syncedAt) {
      clock = post.syncedAt;
      await store.analytics.record({
        genomeId,
        orgId,
        contentItemId: draft.id,
        platform: 'instagram',
        likes: 10,
        comments: 2,
        shares: 1,
        views: 100,
        impressions: 120,
        saves: 3,
        raw: {},
      });
      clock = NOW;
    }

    if (post.scored) {
      await store.learning.recordOutcome({
        genomeId,
        orgId,
        contentItemId: draft.id,
        pillar: post.pillar ?? 'proof',
        reward: 0.5,
      });
    }

    ids.push(draft.id);
  }

  return { store, genomeId, ids, orgId };
}

const deps = (
  store: Awaited<ReturnType<typeof seed>>['store'],
  invoke: ReturnType<typeof memoryInvokeDeps>,
  over: Record<string, unknown> = {},
) => ({
  source: store,
  db: store as unknown as ScopedDb,
  invoke,
  loadBrandGovernance: async () => ({
    createdAt: new Date(0),
    approvalMode: 'autopublish' as const,
    agentPaused: false,
  }),
  now: () => NOW,
  ...over,
});

describe('outcome observer — the tools actually get called', () => {
  beforeEach(() => {
    __resetRegistry();
    resetOutcomeObserverWarnings();
  });

  it('syncs a published post through the registry, not behind it', async () => {
    const sync = fakeSync();
    register(sync.tool);
    const invoke = memoryInvokeDeps();
    const { store, ids } = await seed([{ publishedAt: hoursAgo(6) }]);

    await runOnce(deps(store, invoke));

    expect(sync.calls).toEqual([ids[0]]);
    // The point of going through `invokeTool`: a clock-triggered pull and a
    // hand-triggered one leave identical `tool_calls` rows, cost included.
    expect(invoke.rows.map((r) => r.tool)).toContain('analytics.sync');
  });

  it('runs under the post’s own tenant, not a system identity', async () => {
    // Unlike the trend observer, this work belongs to somebody: the metrics are
    // that brand's, and it is that brand's budget the vendor call spends.
    const sync = fakeSync();
    register(sync.tool);
    const invoke = memoryInvokeDeps();
    const { store } = await seed([{ publishedAt: hoursAgo(6) }], 'org_specific');

    await runOnce(deps(store, invoke));

    expect(invoke.rows[0]!.orgId).toBe('org_specific');
  });

  it('scores a matured post through learning.record_outcome', async () => {
    const record = fakeRecord();
    register(record.tool);
    const invoke = memoryInvokeDeps();
    const { store, ids } = await seed([
      { pillar: 'proof', publishedAt: daysAgo(5), syncedAt: hoursAgo(1) },
    ]);

    await runOnce(deps(store, invoke));

    expect(record.calls).toEqual([ids[0]]);
  });

  it('syncs before it scores, so a score reads fresh numbers', async () => {
    // The one coupling between the phases. A post crossing its maturation
    // threshold should be judged on numbers read moments ago, not last cycle's.
    const order: string[] = [];
    const sync = fakeSync();
    const record = fakeRecord();
    register(sync.tool);
    register(record.tool);
    const invoke = memoryInvokeDeps();
    const { store } = await seed([
      { pillar: 'proof', publishedAt: daysAgo(5), syncedAt: daysAgo(2) },
    ]);

    await runOnce(deps(store, invoke));

    for (const row of invoke.rows) order.push(row.tool);
    expect(order.indexOf('analytics.sync')).toBeLessThan(order.indexOf('learning.record_outcome'));
  });

  it('keeps going when one post fails', async () => {
    // One tenant's broken genome must not cost the rest of the batch their
    // turn. Not latched: the read offers the failed post again next tick.
    const { store, ids } = await seed([
      { pillar: 'proof', publishedAt: daysAgo(5), syncedAt: hoursAgo(1) },
      { pillar: 'proof', publishedAt: daysAgo(4), syncedAt: hoursAgo(1) },
    ]);
    const record = fakeRecord({ throwsFor: ids[0] });
    register(record.tool);
    const err = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const invoke = memoryInvokeDeps();

    await runOnce(deps(store, invoke));
    err.mockRestore();

    expect(record.calls).toEqual([ids[1]]);
  });

  it('says once, not every tick, that no metrics vendor is configured', async () => {
    // With `analytics.sync` unregistered every candidate produces an identical
    // NOT_FOUND. Saying so thousands of times buries whatever else is in the log.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { store } = await seed([{ publishedAt: hoursAgo(6) }, { publishedAt: hoursAgo(7) }]);
    const invoke = memoryInvokeDeps();

    await runOnce(deps(store, invoke));
    await runOnce(deps(store, invoke));

    const vendorWarnings = warn.mock.calls.filter((c) => String(c[0]).includes('not registered'));
    warn.mockRestore();
    expect(vendorWarnings).toHaveLength(1);
  });

  it('still scores when the sync tool is missing', async () => {
    // The phases are independent apart from their order. An instance with no
    // metrics vendor can still learn from snapshots it already has.
    const record = fakeRecord();
    register(record.tool);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const invoke = memoryInvokeDeps();
    const { store, ids } = await seed([
      { pillar: 'proof', publishedAt: daysAgo(5), syncedAt: daysAgo(2) },
    ]);

    await runOnce(deps(store, invoke));
    warn.mockRestore();

    expect(record.calls).toEqual([ids[0]]);
  });

  it('buckets the sync idempotency key by hour, so two ticks are one call', async () => {
    const sync = fakeSync();
    register(sync.tool);
    const invoke = memoryInvokeDeps();
    const { store } = await seed([{ publishedAt: hoursAgo(6) }]);

    await runOnce(deps(store, invoke));
    await runOnce(deps(store, invoke));

    // Two ticks, one vendor call — the second replayed. Safe against skipping a
    // real sync because the tightest cadence is three hours.
    expect(sync.calls).toHaveLength(1);
  });

  it('keys an outcome permanently, because a post has exactly one', async () => {
    const record = fakeRecord();
    register(record.tool);
    const invoke = memoryInvokeDeps();
    const { store, ids } = await seed([
      { pillar: 'proof', publishedAt: daysAgo(5), syncedAt: hoursAgo(1) },
    ]);

    await runOnce(deps(store, invoke));
    const key = invoke.rows.find((r) => r.tool === 'learning.record_outcome')!.idempotencyKey;

    expect(key).toBe(`learning-outcome:${ids[0]}`);
  });

  it('respects the batch size, so one org cannot monopolise a tick', async () => {
    const sync = fakeSync();
    register(sync.tool);
    const invoke = memoryInvokeDeps();
    const { store } = await seed([
      { publishedAt: hoursAgo(6) },
      { publishedAt: hoursAgo(7) },
      { publishedAt: hoursAgo(8) },
    ]);

    await runOnce(deps(store, invoke, { batchSize: 2 }));

    expect(sync.calls).toHaveLength(2);
  });
});

/* ── selection: the part that can be subtly wrong ────────────────────────── */

describe('outcome observer — which posts are due a metrics sync', () => {
  it('always offers a post that has never been synced, whatever its age', async () => {
    // A post published while the observer was down would otherwise never be
    // measured at all.
    const { store, ids } = await seed([{ publishedAt: daysAgo(20) }]);

    const due = await store.findMetricsDue({ now: NOW, limit: 10 });

    expect(due.map((d) => d.id)).toEqual([ids[0]]);
  });

  it('leaves a fresh post alone for three hours, then offers it', async () => {
    // Engagement moves by the hour on a post's first day, so the tight tier is
    // where the resolution is worth paying for.
    const recent = await seed([{ publishedAt: hoursAgo(6), syncedAt: hoursAgo(1) }]);
    expect(await recent.store.findMetricsDue({ now: NOW, limit: 10 })).toHaveLength(0);

    const stale = await seed([{ publishedAt: hoursAgo(6), syncedAt: hoursAgo(4) }]);
    expect(await stale.store.findMetricsDue({ now: NOW, limit: 10 })).toHaveLength(1);
  });

  it('widens to a day once a post is two days old', async () => {
    const fresh = await seed([{ publishedAt: daysAgo(3), syncedAt: hoursAgo(5) }]);
    // Four hours would have been due under the fresh tier; at three days old it
    // is not, which is the whole point of widening.
    expect(await fresh.store.findMetricsDue({ now: NOW, limit: 10 })).toHaveLength(0);

    const stale = await seed([{ publishedAt: daysAgo(3), syncedAt: hoursAgo(30) }]);
    expect(await stale.store.findMetricsDue({ now: NOW, limit: 10 })).toHaveLength(1);
  });

  it('widens to a week past seven days', async () => {
    const fresh = await seed([{ publishedAt: daysAgo(10), syncedAt: daysAgo(2) }]);
    expect(await fresh.store.findMetricsDue({ now: NOW, limit: 10 })).toHaveLength(0);

    const stale = await seed([{ publishedAt: daysAgo(10), syncedAt: daysAgo(8) }]);
    expect(await stale.store.findMetricsDue({ now: NOW, limit: 10 })).toHaveLength(1);
  });

  it('stops tracking a post that has stopped moving', async () => {
    // A post this old has a final number. Re-reading it forever is a standing
    // vendor cost with no new information in it.
    const { store } = await seed([{ publishedAt: daysAgo(60), syncedAt: daysAgo(50) }]);

    expect(await store.findMetricsDue({ now: NOW, limit: 10 })).toHaveLength(0);
  });

  it('works the oldest posts first', async () => {
    const { store, ids } = await seed([{ publishedAt: hoursAgo(4) }, { publishedAt: hoursAgo(20) }]);

    const due = await store.findMetricsDue({ now: NOW, limit: 10 });

    expect(due.map((d) => d.id)).toEqual([ids[1], ids[0]]);
  });
});

describe('outcome observer — which posts are ready to be scored', () => {
  it('refuses to score a post that has not had time to accumulate', async () => {
    // The test this whole design exists for. Scoring at publish time reads
    // near-zero engagement and records a *failure*, teaching the mix engine to
    // avoid whatever was posted most recently.
    const { store } = await seed([
      { pillar: 'proof', publishedAt: hoursAgo(2), syncedAt: hoursAgo(1) },
    ]);

    expect(await store.findOutcomesDue({ now: NOW, limit: 10 })).toHaveLength(0);
  });

  it('scores it once the window has passed', async () => {
    const { store, ids } = await seed([
      { pillar: 'proof', publishedAt: hoursAgo(80), syncedAt: hoursAgo(1) },
    ]);

    const due = await store.findOutcomesDue({ now: NOW, limit: 10 });

    expect(due.map((d) => d.id)).toEqual([ids[0]]);
  });

  it('honours a caller’s own maturation window', async () => {
    const { store } = await seed([
      { pillar: 'proof', publishedAt: hoursAgo(30), syncedAt: hoursAgo(1) },
    ]);

    expect(await store.findOutcomesDue({ now: NOW, limit: 10, maturationHours: 24 })).toHaveLength(1);
    expect(await store.findOutcomesDue({ now: NOW, limit: 10, maturationHours: 48 })).toHaveLength(0);
  });

  it('will not score a post with no metrics snapshot', async () => {
    // With no snapshot the reward divides by a baseline of 1 and produces a
    // number that looks like data.
    const { store } = await seed([{ pillar: 'proof', publishedAt: daysAgo(5) }]);

    expect(await store.findOutcomesDue({ now: NOW, limit: 10 })).toHaveLength(0);
  });

  it('will not score a post with no pillar', async () => {
    // There is no arm for the mix engine to move.
    const { store } = await seed([{ publishedAt: daysAgo(5), syncedAt: hoursAgo(1) }]);

    expect(await store.findOutcomesDue({ now: NOW, limit: 10 })).toHaveLength(0);
  });

  it('does not offer a post that has already been scored', async () => {
    const { store } = await seed([
      { pillar: 'proof', publishedAt: daysAgo(5), syncedAt: hoursAgo(1), scored: true },
    ]);

    expect(await store.findOutcomesDue({ now: NOW, limit: 10 })).toHaveLength(0);
  });

  it('works a backlog oldest-first, so each score sees the baseline before it', async () => {
    // A reward is measured against this genome's own recent posts. Scoring a
    // backlog newest-first would judge every post against a baseline assembled
    // backwards from its own future.
    const { store, ids } = await seed([
      { pillar: 'proof', publishedAt: daysAgo(4), syncedAt: hoursAgo(1) },
      { pillar: 'proof', publishedAt: daysAgo(9), syncedAt: hoursAgo(1) },
    ]);

    const due = await store.findOutcomesDue({ now: NOW, limit: 10 });

    expect(due.map((d) => d.id)).toEqual([ids[1], ids[0]]);
  });
});
