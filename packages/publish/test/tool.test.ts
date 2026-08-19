import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import { PublishError, createStubAdapter, routeAdapters } from '../src/adapter.js';
import { createRateLimiter, DEFAULT_BUDGETS } from '../src/retry.js';
import { makePublishNow, makePublishStatus } from '../src/tool.js';

/**
 * `publish.now` is the only irreversible tool in the registry. Most of what
 * matters about it is *declaration* rather than behaviour — the effect that
 * routes it through the approval ladder, the flag that stops a retry
 * double-posting — so those are asserted as hard contract.
 */

// `oauthConnections.get` resolving to undefined ("nothing connected for this
// genome/platform") is realistic for the stub adapter — it needs no
// per-brand token. Merged into every test's `db` override below (not just
// the default) so a test overriding `db` for its own purposes (content/
// assets stores) doesn't have to also know about this unrelated lookup.
const defaultOauthConnections = { get: async () => undefined };

const ctx = (over: Partial<ToolCtx> = {}): ToolCtx => {
  const { db: dbOver, ...restOver } = over;
  return {
    orgId: 'org_1',
    brandId: 'brand_1',
    genomeId: 'gen_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: { oauthConnections: defaultOauthConnections, ...dbOver } as unknown as ToolCtx['db'],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
    ...restOver,
  } as unknown as ToolCtx;
};

/** `markPublished` runs in a swallowed try/catch (the post is already live by
 * the time it's called), and every `ctx()` here stubs `db` as `{}` anyway —
 * so this only needs to satisfy `PublishDeps`, never actually run. */
const embed = { embed: async () => [0] };

const input = {
  contentItemId: 'item_1',
  genomeId: 'gen_1',
  playbookId: 'pb_craft_capture',
  platform: 'instagram' as const,
  text: 'the fade finishing',
  referencedAssetIds: [],
  mediaUrls: [],
};

describe('publish.now — registry contract', () => {
  const tool = makePublishNow({ adapters: [createStubAdapter()], sleep: async () => {}, embed });

  it('declares the publish effect, which is what the approval ladder keys on', () => {
    // `policy.ts` has a dedicated branch for `effect: 'publish'`. Declaring
    // anything else would route the most dangerous call in the product around
    // review_first_week and review_everything entirely.
    expect(tool.effect).toBe('publish');
  });

  it('is not idempotent — a retry must not put the post up twice', () => {
    expect(tool.idempotent).toBe(false);
  });

  it('declares the guardrails that must run before a feed sees it', () => {
    // There is no later stage to catch an ungrounded claim once it is live.
    expect(tool.guardrails).toEqual(expect.arrayContaining(['rights', 'platform_policy', 'claim_grounding']));
  });

  it('is not available to viewers or clients', () => {
    expect(tool.scopes).not.toContain('viewer');
    expect(tool.scopes).not.toContain('client');
  });
});

describe('publish.now — behaviour', () => {
  it('publishes through the routed adapter and returns its receipt', async () => {
    const adapter = createStubAdapter({ name: 'aggregator:test' });
    const tool = makePublishNow({ adapters: [adapter], sleep: async () => {}, embed });

    const out = await tool.handler(input, ctx());

    expect(adapter.sent).toHaveLength(1);
    expect(out.via).toBe('aggregator:test');
    expect(out.platform).toBe('instagram');
    expect(out.externalId).toBeTruthy();
  });

  it('derives the idempotency key from the content item and platform', async () => {
    // The same scheduled post must resolve to the same publish however it was
    // retried — which means the key cannot be random.
    const adapter = createStubAdapter();
    const tool = makePublishNow({ adapters: [adapter], sleep: async () => {}, embed });

    await tool.handler(input, ctx());
    expect(adapter.sent[0]!.idempotencyKey).toBe('item_1:instagram');
  });

  it('refuses when the brand’s platform budget is spent, as RATE_LIMITED', async () => {
    // Not an error in the post — the throttle working. The distinction tells
    // the caller to reschedule rather than to fix and retry.
    const limiter = createRateLimiter();
    for (let i = 0; i < DEFAULT_BUDGETS.instagram.perWindow; i++) {
      limiter.tryConsume('brand_1', 'instagram', new Date());
    }
    const tool = makePublishNow({ adapters: [createStubAdapter()], limiter, sleep: async () => {}, embed });

    const err = await tool.handler(input, ctx()).catch((e: unknown) => e as ToolError);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe('RATE_LIMITED');
  });

  it('does not consume budget belonging to another brand', async () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < DEFAULT_BUDGETS.instagram.perWindow; i++) {
      limiter.tryConsume('brand_1', 'instagram', new Date());
    }
    const tool = makePublishNow({ adapters: [createStubAdapter()], limiter, sleep: async () => {}, embed });

    await expect(tool.handler(input, ctx({ brandId: 'brand_2' }))).resolves.toBeDefined();
  });

  it('refuses without a brand rather than publishing to an ambiguous account', async () => {
    const tool = makePublishNow({ adapters: [createStubAdapter()], sleep: async () => {}, embed });
    await expect(tool.handler(input, ctx({ brandId: undefined }))).rejects.toThrow(ToolError);
  });

  it('surfaces a permanent adapter failure as UPSTREAM_FAILED, not a silent success', async () => {
    const failing = {
      name: 'aggregator:failing',
      supports: () => true,
      publish: async () => {
        throw new PublishError('instagram', 'caption too long', false);
      },
    };
    const tool = makePublishNow({ adapters: [failing], sleep: async () => {}, embed });

    const err = await tool.handler(input, ctx()).catch((e: unknown) => e as ToolError);
    expect((err as ToolError).code).toBe('UPSTREAM_FAILED');
    expect((err as ToolError).meta.retryable).toBe(false);
  });

  it('refuses a genome other than the one selected', async () => {
    // The input carries a genome for the guardrail contract; the verified one
    // is `ctx.genomeId`. Publishing a post attributed to a genome the caller
    // did not select must not be resolved silently.
    const tool = makePublishNow({ adapters: [createStubAdapter()], sleep: async () => {}, embed });
    const err = await tool
      .handler({ ...input, genomeId: 'gen_someone_else' }, ctx())
      .catch((e: unknown) => e as ToolError);
    expect((err as ToolError).code).toBe('ISOLATION_VIOLATION');
  });

  it('carries the draft shape the guardrail layer requires', () => {
    // `makeRunGuardrails` parses the tool's *input* against GuardrailableDraft
    // and blocks with `wiring_error` if it does not match. This shipped wrong
    // once: the tool declared three guardrails and its input was not
    // draft-shaped, so every publish was blocked rather than checked.
    const parsed = makePublishNow({ adapters: [createStubAdapter()], embed }).input.parse(input);
    for (const field of ['genomeId', 'playbookId', 'platform', 'text', 'referencedAssetIds']) {
      expect(parsed, field).toHaveProperty(field);
    }
  });

  it('refuses a platform no adapter serves instead of posting elsewhere', async () => {
    // Publishing to the wrong place is worse than not publishing.
    const igOnly = createStubAdapter({ supports: ['instagram'] });
    const tool = makePublishNow({ adapters: [igOnly], sleep: async () => {}, embed });

    await expect(tool.handler({ ...input, platform: 'linkedin' }, ctx())).rejects.toThrow();
  });
});

describe('publish.now — records the receipt (the write side of guard.duplicate/avatar_saturation)', () => {
  function fakeContentStore() {
    const calls: unknown[] = [];
    return {
      calls,
      content: {
        markPublished: async (args: unknown) => {
          calls.push(args);
        },
      } as unknown as ToolCtx['db']['content'],
    };
  }

  it('marks the content item published with the receipt and a real embedding', async () => {
    const { calls, content } = fakeContentStore();
    const embedded = [0.1, 0.2, 0.3];
    const tool = makePublishNow({
      adapters: [createStubAdapter({ name: 'aggregator:test' })],
      sleep: async () => {},
      embed: { embed: async () => embedded },
    });

    await tool.handler(input, ctx({ db: { content } as unknown as ToolCtx['db'] }));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      id: 'item_1',
      orgId: 'org_1',
      platform: 'instagram',
      via: 'aggregator:test',
      embedding: embedded,
    });
    expect((calls[0] as { externalId: string }).externalId).toBeTruthy();
  });

  it('embeds the published text, not the input as a whole', async () => {
    const { calls, content } = fakeContentStore();
    let embeddedText: string | undefined;
    const tool = makePublishNow({
      adapters: [createStubAdapter()],
      sleep: async () => {},
      embed: {
        embed: async (text) => {
          embeddedText = text;
          return [1];
        },
      },
    });

    await tool.handler(input, ctx({ db: { content } as unknown as ToolCtx['db'] }));

    expect(embeddedText).toBe(input.text);
    expect(calls).toHaveLength(1);
  });

  it('does not fail the publish when recording the receipt fails — the post is already live', async () => {
    const tool = makePublishNow({
      adapters: [createStubAdapter()],
      sleep: async () => {},
      embed,
    });
    const failingContent = {
      markPublished: async () => {
        throw new Error('db unavailable');
      },
    } as unknown as ToolCtx['db']['content'];

    const out = await tool.handler(input, ctx({ db: { content: failingContent } as unknown as ToolCtx['db'] }));

    // Retrying this as a failure would post the same content a second time —
    // the swallow is deliberate, same trade-off as `recordCost` in invoke.ts.
    expect(out.externalId).toBeTruthy();
  });
});

describe('publish.now — records asset usage (the write side of asset.reuse)', () => {
  function fakeStores() {
    const contentCalls: unknown[] = [];
    const assetCalls: unknown[] = [];
    return {
      contentCalls,
      assetCalls,
      db: {
        content: { markPublished: async (args: unknown) => void contentCalls.push(args) },
        assets: { recordUsage: async (args: unknown) => void assetCalls.push(args) },
      } as unknown as ToolCtx['db'],
    };
  }

  it('records usage for every referenced asset once the post is live', async () => {
    const { assetCalls, db } = fakeStores();
    const tool = makePublishNow({ adapters: [createStubAdapter()], sleep: async () => {}, embed });

    await tool.handler({ ...input, referencedAssetIds: ['asset_1', 'asset_2'] }, ctx({ db }));

    expect(assetCalls).toHaveLength(2);
    expect(assetCalls).toEqual(
      expect.arrayContaining([
        { id: 'asset_1', genomeId: 'gen_1', orgId: 'org_1' },
        { id: 'asset_2', genomeId: 'gen_1', orgId: 'org_1' },
      ]),
    );
  });

  it('calls nothing when the draft references no assets', async () => {
    const { assetCalls, db } = fakeStores();
    const tool = makePublishNow({ adapters: [createStubAdapter()], sleep: async () => {}, embed });

    await tool.handler(input, ctx({ db }));

    expect(assetCalls).toHaveLength(0);
  });

  it('does not fail the publish when recording asset usage fails — the post is already live', async () => {
    const tool = makePublishNow({ adapters: [createStubAdapter()], sleep: async () => {}, embed });
    const failingAssets = { recordUsage: async () => { throw new Error('db unavailable'); } } as unknown as ToolCtx['db']['assets'];

    const out = await tool.handler(
      { ...input, referencedAssetIds: ['asset_1'] },
      ctx({ db: { content: { markPublished: async () => {} }, assets: failingAssets } as unknown as ToolCtx['db'] }),
    );

    expect(out.externalId).toBeTruthy();
  });
});

describe('adapter routing', () => {
  it('prefers a native adapter over the aggregator for the same platform', async () => {
    // As approvals clear, native adapters are prepended and the aggregator
    // quietly stops receiving that platform — with no caller change.
    const native = createStubAdapter({ name: 'native:x', supports: ['x'] });
    const aggregator = createStubAdapter({ name: 'aggregator:stub' });

    const router = routeAdapters([native, aggregator]);
    expect(router.for('x').name).toBe('native:x');
    expect(router.for('instagram').name).toBe('aggregator:stub');
  });

  it('reports only the platforms something can actually serve', () => {
    const router = routeAdapters([createStubAdapter({ supports: ['instagram', 'x'] })]);
    expect(router.supported().sort()).toEqual(['instagram', 'x']);
  });
});

describe('publish.status', () => {
  it('reports adapter and remaining budget per platform', async () => {
    const tool = makePublishStatus({ adapters: [createStubAdapter({ supports: ['instagram'] })], embed });
    const out = await tool.handler({}, ctx());

    const instagram = out.platforms.find((p) => p.platform === 'instagram')!;
    expect(instagram.supported).toBe(true);
    expect(instagram.via).toBe('aggregator:stub');
    expect(instagram.remainingToday).toBe(DEFAULT_BUDGETS.instagram.perWindow);

    // Naming what is *not* reachable is what makes "LinkedIn is pending
    // approval" visible rather than folklore.
    const linkedin = out.platforms.find((p) => p.platform === 'linkedin')!;
    expect(linkedin.supported).toBe(false);
    expect(linkedin.via).toBeNull();
  });

  it('is readable by every role and never mutates', () => {
    const tool = makePublishStatus({ adapters: [createStubAdapter()], embed });
    expect(tool.effect).toBe('read');
    expect(tool.scopes).toContain('client');
  });
});
