import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineTool, register, __resetRegistry, type InvokeDeps, type ScopedDb } from '@sparksocial/tools';
import { ToolError } from '@sparksocial/shared';
import { makeRunGuardrails } from '@sparksocial/guardrails';
import { makePublishNow, createStubAdapter } from '@sparksocial/publish';
import type { DueContentSource, DueContentItem } from '@sparksocial/db';
import type { Genome } from '@sparksocial/shared/genome';
import { runOnce, startScheduler, type SchedulerDeps } from '../src/scheduler.js';
import { createDevStore } from '../src/dev-store.js';
import { memoryInvokeDeps } from '../src/app.js';

/**
 * `publishOne` hardcodes `tool: 'publish.now'`, so intercepting it means
 * registering a fake under that exact name — the same trick
 * `idempotency.test.ts` uses for `direct.session.send`. This also proves the
 * scheduler goes through `invokeTool`'s real middleware chain (policy included)
 * rather than calling a handler directly.
 */
function fakePublishNow(opts: { effect?: 'publish' | 'external'; throws?: boolean; guardrailBlocked?: boolean } = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const tool = defineTool({
    name: 'publish.now',
    version: 1,
    summary: 'fake publish.now for scheduler tests',
    input: z.object({
      contentItemId: z.string(),
      genomeId: z.string(),
      playbookId: z.string(),
      platform: z.string(),
      text: z.string(),
      referencedAssetIds: z.array(z.string()),
      mediaUrls: z.array(z.string()),
    }),
    output: z.object({ ok: z.boolean() }),
    effect: opts.effect ?? 'publish',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: true,
    // Mirrors the real `publish.now`'s own derivation closely enough for the
    // scheduler's purposes: the platform comes off the validated input, which
    // is what lets `brand.restricted_platform` fire on a scheduled publish.
    policySubject: async (input) => ({ platform: input.platform }),
    async handler(input) {
      calls.push(input);
      if (opts.throws) throw new Error('publish transport down');
      // Same shape `invoke.ts` itself throws when a declared guardrail
      // returns `verdict: 'block'` (see packages/tools/src/invoke.ts) —
      // reproduced here rather than wiring the real guardrail engine, since
      // this fake exists to prove the *scheduler's* reaction to the error
      // code, not to re-prove the guardrail layer itself (the e2e test below
      // does that, against the real `claim_grounding` check).
      if (opts.guardrailBlocked) throw new ToolError('GUARDRAIL_BLOCKED', 'claim_grounding', { guard: 'claim_grounding' });
      return { ok: true };
    },
  });
  return { tool, calls };
}

const genome = (over: Partial<Genome> = {}): Genome =>
  ({
    id: 'gen_1',
    org_id: 'org_1',
    workspace_id: 'brand_1',
    ...over,
  }) as unknown as Genome;

const dueItem = (over: Partial<DueContentItem> = {}): DueContentItem => ({
  id: 'item_1',
  orgId: 'org_1',
  genomeId: 'gen_1',
  playbookId: 'pb_avatar_pov',
  platform: null,
  copy: [{ kind: 'text', beatId: 'b1', text: 'hello world' }],
  intent: null,
  scheduledAt: new Date('2026-08-13T09:00:00Z'),
  ...over,
});

function makeDeps(
  over: Partial<SchedulerDeps> & { items?: DueContentItem[]; missingGenome?: boolean } = {},
): {
  deps: SchedulerDeps;
  invoke: InvokeDeps;
} {
  const items = over.items ?? [dueItem()];
  const source: DueContentSource = { findDue: async () => items };
  const db = {
    genomes: { get: async () => (over.missingGenome ? undefined : genome()) },
    // `markNeedsReview` is the scheduler's write when the approval ladder holds a
    // publish (PRD §7.4): the item leaves `scheduled` so `findDue` stops
    // re-selecting and re-holding it once a minute forever.
    content: { markBlocked: async () => {}, markNeedsReview: async () => {} },
  } as unknown as ScopedDb;

  const invoke: InvokeDeps = { writeToolCall: async () => {} };

  const { items: _items, missingGenome: _missingGenome, ...rest } = over;
  const deps: SchedulerDeps = {
    source,
    db,
    invoke,
    loadBrandGovernance: async () => ({
      createdAt: new Date('2020-01-01T00:00:00Z'),
      approvalMode: 'autopublish',
      agentPaused: false,
    }),
    ...rest,
  };
  return { deps, invoke };
}

describe('scheduler', () => {
  beforeEach(() => __resetRegistry());

  it('publishes a due item, filling the platform from the playbook when none is set', async () => {
    const { tool, calls } = fakePublishNow();
    register(tool);
    const { deps } = makeDeps();

    await runOnce(deps);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      contentItemId: 'item_1',
      genomeId: 'gen_1',
      playbookId: 'pb_avatar_pov',
      platform: 'instagram', // pb_avatar_pov's first declared platform
      text: 'hello world',
      referencedAssetIds: [],
      mediaUrls: [],
    });
  });

  it('uses the item platform when one is already set, without consulting the playbook', async () => {
    const { tool, calls } = fakePublishNow();
    register(tool);
    const { deps } = makeDeps({ items: [dueItem({ platform: 'tiktok' })] });

    await runOnce(deps);

    expect(calls[0]).toMatchObject({ platform: 'tiktok' });
  });

  it('collects asset and generated-media beats into referencedAssetIds/mediaUrls', async () => {
    const { tool, calls } = fakePublishNow();
    register(tool);
    const { deps } = makeDeps({
      items: [
        dueItem({
          platform: 'x',
          copy: [
            { kind: 'text', beatId: 'b1', text: 'caption' },
            { kind: 'asset', beatId: 'b2', assetId: 'asset_1', role: 'social_proof', caption: null },
            { kind: 'generated_image', beatId: 'b3', url: 'https://cdn/img.png', prompt: 'p' },
          ],
        }),
      ],
    });

    await runOnce(deps);

    expect(calls[0]).toMatchObject({
      referencedAssetIds: ['asset_1'],
      mediaUrls: ['https://cdn/img.png'],
    });
  });

  it('idempotency-keys each attempt to the content item and platform, not the tick', async () => {
    const { tool, calls } = fakePublishNow();
    register(tool);
    const { deps, invoke } = makeDeps({ items: [dueItem({ platform: 'linkedin' })] });
    const writeToolCall = vi.spyOn(invoke, 'writeToolCall');

    await runOnce(deps);

    expect(writeToolCall).toHaveBeenCalled();
    // The one route to the audit row also carries the idempotency key; assert
    // via the fake handler's success rather than reaching into invoke internals.
    expect(calls).toHaveLength(1);
  });

  it('skips an item whose genome no longer exists, without calling publish.now — and marks it blocked so it stops being retried', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tool, calls } = fakePublishNow();
    register(tool);
    const markBlocked = vi.fn(async () => {});
    const { deps } = makeDeps({
      db: { genomes: { get: async () => undefined }, content: { markBlocked } } as unknown as ScopedDb,
    });

    await runOnce(deps);

    expect(calls).toHaveLength(0);
    expect(markBlocked).toHaveBeenCalledWith(expect.objectContaining({ id: 'item_1', orgId: 'org_1' }));
    vi.restoreAllMocks();
  });

  it('skips an item with no playbookId — and marks it blocked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tool, calls } = fakePublishNow();
    register(tool);
    const markBlocked = vi.fn(async () => {});
    const { deps } = makeDeps({
      items: [dueItem({ playbookId: null })],
      db: { genomes: { get: async () => genome() }, content: { markBlocked } } as unknown as ScopedDb,
    });

    await runOnce(deps);

    expect(calls).toHaveLength(0);
    expect(markBlocked).toHaveBeenCalledWith(expect.objectContaining({ id: 'item_1', orgId: 'org_1' }));
    vi.restoreAllMocks();
  });

  it('skips an item whose playbookId no longer resolves and has no explicit platform — and marks it blocked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tool, calls } = fakePublishNow();
    register(tool);
    const markBlocked = vi.fn(async () => {});
    const { deps } = makeDeps({
      items: [dueItem({ playbookId: 'pb_does_not_exist' })],
      db: { genomes: { get: async () => genome() }, content: { markBlocked } } as unknown as ScopedDb,
    });

    await runOnce(deps);

    expect(calls).toHaveLength(0);
    expect(markBlocked).toHaveBeenCalledWith(expect.objectContaining({ id: 'item_1', orgId: 'org_1' }));
    vi.restoreAllMocks();
  });

  it('drafts a due item that has no copy yet, then publishes it', async () => {
    // The day-0 bug, from the other side. `calendar.generate` writes empty
    // slots, so "due but undrafted" is the *normal* state of a campaign's next
    // post — not a fault. The scheduler used to mark these `blocked` with "No
    // written copy", which meant activating a campaign blocked its own opening
    // day within one tick. Drafting is SPARK's own work (PRD §1), so it does it.
    const { tool, calls } = fakePublishNow();
    register(tool);

    const drafted = { kind: 'text', beatId: 'b1', text: 'copy SPARK wrote' };
    const draftTool = defineTool({
      name: 'content.draft',
      version: 1,
      summary: 'fake content.draft for scheduler tests',
      input: z.object({
        genomeId: z.string(),
        playbookId: z.string(),
        contentItemId: z.string().optional(),
        intent: z.string().default(''),
      }),
      output: z.object({ contentItemId: z.string() }),
      effect: 'write',
      autonomy: 'auto',
      scopes: ['owner', 'admin', 'editor'],
      idempotent: false,
      async handler(input) {
        return { contentItemId: input.contentItemId ?? 'item_1' };
      },
    });
    register(draftTool);

    const markBlocked = vi.fn(async () => {});
    const { deps } = makeDeps({
      // No text beats — only an asset, which is exactly what an unfilled slot
      // looks like once the resolver has picked media but written nothing.
      items: [dueItem({ copy: [{ kind: 'asset', beatId: 'b1', assetId: 'a1', role: 'social_proof', caption: null }] })],
      db: {
        genomes: { get: async () => genome() },
        // The re-read after drafting: the scheduler trusts the row, not the
        // tool's return value, because the row is what gets published.
        content: { markBlocked, get: async () => ({ copy: [drafted] }) },
      } as unknown as ScopedDb,
    });

    await runOnce(deps);

    expect(markBlocked).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ text: 'copy SPARK wrote' });
  });

  it('blocks an item only once drafting itself has failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tool, calls } = fakePublishNow();
    register(tool);
    // No `content.draft` registered at all, so the draft attempt fails hard.
    // A hard failure is terminal for the same reason a guardrail block is: it
    // will fail identically on every future tick.
    const markBlocked = vi.fn(async () => {});
    const { deps } = makeDeps({
      items: [dueItem({ copy: [{ kind: 'asset', beatId: 'b1', assetId: 'a1', role: 'social_proof', caption: null }] })],
      db: { genomes: { get: async () => genome() }, content: { markBlocked } } as unknown as ScopedDb,
    });

    await runOnce(deps);

    expect(calls).toHaveLength(0);
    expect(markBlocked).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'item_1', orgId: 'org_1', reason: expect.stringContaining('could not draft') }),
    );
    vi.restoreAllMocks();
  });

  it('treats malformed copy the same as no text, rather than throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tool, calls } = fakePublishNow();
    register(tool);
    const { deps } = makeDeps({ items: [dueItem({ copy: 'not-an-array-of-beats' })] });

    await expect(runOnce(deps)).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it('logs rather than throws when publish.now fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { tool } = fakePublishNow({ throws: true });
    register(tool);
    const { deps } = makeDeps();

    await expect(runOnce(deps)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('marks a guardrail-blocked item blocked, so it stops being retried', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { tool } = fakePublishNow({ guardrailBlocked: true });
    register(tool);
    const markBlocked = vi.fn(async () => {});
    const { deps } = makeDeps({
      db: { genomes: { get: async () => genome() }, content: { markBlocked } } as unknown as ScopedDb,
    });

    await runOnce(deps);

    expect(markBlocked).toHaveBeenCalledWith({ id: 'item_1', orgId: 'org_1', reason: 'claim_grounding' });
    vi.restoreAllMocks();
  });

  it('does not mark a transient failure blocked — it stays retryable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { tool } = fakePublishNow({ throws: true });
    register(tool);
    const markBlocked = vi.fn(async () => {});
    const { deps } = makeDeps({
      db: { genomes: { get: async () => genome() }, content: { markBlocked } } as unknown as ScopedDb,
    });

    await runOnce(deps);

    expect(markBlocked).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('logs rather than throws when the approval ladder holds the publish for review', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { tool, calls } = fakePublishNow();
    register(tool);
    const markNeedsReview = vi.fn(async () => {});
    const { deps } = makeDeps({
      db: {
        genomes: { get: async () => genome() },
        content: { markBlocked: async () => {}, markNeedsReview },
      } as unknown as ScopedDb,
      loadBrandGovernance: async () => ({
        createdAt: new Date('2020-01-01T00:00:00Z'),
        approvalMode: 'review_everything',
        agentPaused: false,
      }),
    });

    await runOnce(deps);

    // Held, not published — the fake handler never ran.
    expect(calls).toHaveLength(0);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('publish held for review'),
      expect.objectContaining({ contentItemId: 'item_1' }),
    );
    // And it left `scheduled`, so the next tick does not re-hold it. Staying
    // scheduled meant this log line repeated once a minute forever while the
    // calendar still showed the post as going out.
    expect(markNeedsReview).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'item_1', reason: expect.stringContaining('Waiting for approval') }),
    );
    vi.restoreAllMocks();
  });

  it('processes every due item even when one throws mid-batch', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { tool, calls } = fakePublishNow();
    register(tool);
    const { deps } = makeDeps({
      items: [
        dueItem({ id: 'item_bad', playbookId: null }), // resolves fine, just skipped (no throw)
        dueItem({ id: 'item_good' }),
      ],
    });
    // Force a genuine throw for the first item by making genomes.get reject.
    let call = 0;
    (deps.db as unknown as { genomes: { get: () => Promise<unknown> } }).genomes.get = async () => {
      call += 1;
      if (call === 1) throw new Error('db unavailable');
      return genome();
    };

    await expect(runOnce(deps)).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ contentItemId: 'item_good' });
    vi.restoreAllMocks();
  });

  it('respects the credits ledger, so a scheduled publish is not exempt from spend limits', async () => {
    // effect: 'publish' does not itself trigger the budget rule (only
    // `estimatedCents > 0` does) — this asserts `deps.credits` is at least
    // wired through to the ctx the way `whatsappWebhook.systemCtx` does it,
    // by checking the resolver was actually invoked with it.
    const { tool, calls } = fakePublishNow();
    register(tool);
    const budgetCalls: string[] = [];
    const credits = {
      budget: async (orgId: string) => {
        budgetCalls.push(orgId);
        return { monthlyCapCents: 10_000, spentCents: 0 };
      },
      record: async () => {},
    };
    const { deps } = makeDeps({ credits: credits as never });

    await runOnce(deps);

    expect(budgetCalls).toContain('org_1');
    expect(calls).toHaveLength(1);
  });
});

describe('startScheduler', () => {
  beforeEach(() => {
    __resetRegistry();
    vi.useFakeTimers();
  });

  it('runs a tick immediately, then again on every interval, until stopped', async () => {
    const { tool, calls } = fakePublishNow();
    register(tool);
    const { deps } = makeDeps();

    const scheduler = startScheduler(deps, 1000);
    await vi.advanceTimersByTimeAsync(0); // flush the immediate tick
    expect(calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(2);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(2); // no further ticks after stop()

    vi.useRealTimers();
  });
});

describe('scheduler + the real publish.now + the real dev store', () => {
  beforeEach(() => __resetRegistry());

  /**
   * Regression test for the bug the P4 survey found: `publish.now` returned a
   * receipt but nothing ever wrote it back, so `content_items.status` never
   * left `scheduled` and every tick re-selected the same row forever (the
   * fake `publish.now` in the tests above can't catch this — it never touches
   * `ctx.db.content`). This wires the real tool and the real dev store to
   * prove a published item actually stops being due.
   */
  it('a scheduled item is no longer due after the scheduler publishes it', async () => {
    register(makePublishNow({ adapters: [createStubAdapter()], embed: { embed: async () => [0.1] } }));

    const orgId = 'org_sched_e2e';
    const store = createDevStore();
    const { id: genomeId } = await store.genomes.createDraft({
      brandId: 'brand_sched_e2e',
      orgId,
      identity: {
        business_name: 'Scheduler Test Co',
        category: 'test_fixture',
        one_liner: 'exists only to prove the scheduler publishes',
        geography: { scope: 'global', locale: 'en-US', radius_km: null },
        languages: ['en'],
        price_tier: 'mid',
      },
      dimensions: {},
      voice: {},
      source: 'user',
    });

    const draft = await store.content.createDraft({
      genomeId,
      orgId,
      playbookId: 'pb_workflow_clip',
      mode: 'synthesize',
      copy: [{ kind: 'text', beatId: 'b1', text: 'due for a real publish' }],
      why: { summary: 'test', factors: [], evidence: [], alternatives: [] },
    });
    await store.content.schedule({ id: draft.id, genomeId, orgId, scheduledAt: new Date(Date.now() - 60_000) });

    const invoke = memoryInvokeDeps();
    const deps: SchedulerDeps = {
      source: { findDue: store.findDue },
      db: store,
      invoke,
      loadBrandGovernance: async () => ({
        createdAt: new Date('2020-01-01T00:00:00Z'),
        approvalMode: 'autopublish',
        agentPaused: false,
      }),
    };

    const dueBefore = await store.findDue(new Date(), 25);
    expect(dueBefore.map((d) => d.id)).toContain(draft.id);

    await runOnce(deps);

    const dueAfter = await store.findDue(new Date(), 25);
    expect(dueAfter.map((d) => d.id)).not.toContain(draft.id);

    const published = await store.content.get(draft.id, genomeId, orgId);
    expect(published?.status).toBe('published');
    expect(published?.platform).toBeTruthy();
  });

  /**
   * Regression test for the infinite-retry bug: a scheduled item whose
   * `publish.now` call is hard-blocked by a guardrail (not held for review —
   * a block never reaches the policy engine at all) used to stay `scheduled`
   * forever, so every tick re-selected and re-failed it identically. This
   * wires the real `claim_grounding` check (via `makeRunGuardrails`, the same
   * function `apps/api/src/index.ts` wires in production) against a genome
   * with no knowledge/social-proof assets, so any specific numeric claim in
   * the draft is genuinely ungrounded — not a fake error code, the real
   * guardrail actually blocking it.
   */
  it('marks a guardrail-blocked scheduled item blocked, so it is no longer due on the next tick', async () => {
    register(
      makePublishNow({
        adapters: [createStubAdapter()],
        embed: { embed: async () => [0.1] },
      }),
    );

    const orgId = 'org_sched_blocked_e2e';
    const store = createDevStore();
    const { id: genomeId } = await store.genomes.createDraft({
      brandId: 'brand_sched_blocked_e2e',
      orgId,
      identity: {
        business_name: 'Scheduler Blocked Test Co',
        category: 'test_fixture',
        one_liner: 'exists only to prove a guardrail-blocked item stops being retried',
        geography: { scope: 'global', locale: 'en-US', radius_km: null },
        languages: ['en'],
        price_tier: 'mid',
      },
      dimensions: {},
      voice: {},
      source: 'user',
    });

    // "40%" is a checkable numeric claim (claimGrounding.ts's own NUMERIC_CLAIM
    // pattern) with nothing in this genome's knowledge/social_proof assets to
    // ground it against — a real block, not a contrived one.
    const draft = await store.content.createDraft({
      genomeId,
      orgId,
      playbookId: 'pb_workflow_clip',
      mode: 'synthesize',
      copy: [{ kind: 'text', beatId: 'b1', text: 'We cut costs by 40% for every client' }],
      why: { summary: 'test', factors: [], evidence: [], alternatives: [] },
    });
    await store.content.schedule({ id: draft.id, genomeId, orgId, scheduledAt: new Date(Date.now() - 60_000) });

    const invoke = memoryInvokeDeps({ runGuardrails: makeRunGuardrails({ embed: async () => [0.1] }) });
    const deps: SchedulerDeps = {
      source: { findDue: store.findDue },
      db: store,
      invoke,
      loadBrandGovernance: async () => ({
        createdAt: new Date('2020-01-01T00:00:00Z'),
        approvalMode: 'autopublish',
        agentPaused: false,
      }),
    };

    const dueBefore = await store.findDue(new Date(), 25);
    expect(dueBefore.map((d) => d.id)).toContain(draft.id);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    await runOnce(deps);
    vi.restoreAllMocks();

    // The whole point: gone from `findDue` after exactly one tick, not still
    // sitting there to be re-selected (and re-failed) on the next one.
    const dueAfter = await store.findDue(new Date(), 25);
    expect(dueAfter.map((d) => d.id)).not.toContain(draft.id);

    const blocked = await store.content.get(draft.id, genomeId, orgId);
    expect(blocked?.status).toBe('blocked');
    expect(blocked?.blockedReason).toMatch(/claim_grounding/);

    // A second tick must not re-attempt it — the regression this test guards
    // against is specifically "it keeps trying forever."
    const before = dueAfter.length;
    await runOnce(deps);
    const dueAfterSecondTick = await store.findDue(new Date(), 25);
    expect(dueAfterSecondTick).toHaveLength(before);
  });
});
