import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools';
import {
  contentVariantSplit,
  contentVariantResult,
  DECISIVE_RATIO,
  MIN_IMPRESSIONS,
} from '../src/variantTest.js';

/**
 * `DISC-02`'s A/B test.
 *
 * The arithmetic is trivial and almost nothing here tests it. What these cover
 * is the **refusal to over-claim**: two posts are not a sample, and every path
 * that could quietly turn a bigger number into a verdict is pinned. A dashboard
 * announcing "arm B wins" off 40 impressions against 44 is lying in the most
 * comfortable way available — the number really is bigger.
 *
 * The other property worth pinning is that the arms differ *only* in copy. A
 * test that let a confound through (a different playbook, a different pillar)
 * would produce a real number measuring the wrong thing, which is worse than no
 * number at all.
 */

interface Draft {
  id: string;
  genomeId: string;
  playbookId: string;
  mode: string;
  pillar?: string;
  campaignId?: string;
  status: string;
  copy: unknown;
  variantGroupId?: string;
  variantLabel?: string;
  createdAt: Date;
}

const draft = (over: Partial<Draft> = {}): Draft => ({
  id: 'ci_a',
  genomeId: 'gen_1',
  playbookId: 'pb_text_update',
  mode: 'synthesize',
  pillar: 'proof',
  status: 'draft',
  copy: [{ kind: 'text', beatId: 'copy', text: 'the original' }],
  createdAt: new Date('2026-08-20T10:00:00Z'),
  ...over,
});

interface Metric {
  contentItemId: string;
  platform: string;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
  impressions: number;
}

const metric = (contentItemId: string, over: Partial<Metric> = {}): Metric => ({
  contentItemId,
  platform: 'instagram',
  likes: 0,
  comments: 0,
  shares: 0,
  saves: 0,
  views: 0,
  impressions: 0,
  ...over,
});

function ctx(drafts: Draft[], metrics: Metric[] = []) {
  const learningWrites: unknown[] = [];
  const c = {
    orgId: 'org_1',
    genomeId: 'gen_1',
    role: 'owner',
    approvalMode: 'autopublish',
    budget: { remainingCents: 10_000, monthlyCapCents: 50_000 },
    db: {
      content: {
        async get(id: string) {
          return drafts.find((d) => d.id === id);
        },
        async createDraft(args: Record<string, unknown>) {
          const created = draft({ ...args, id: `ci_${drafts.length + 1}` } as Partial<Draft>);
          drafts.push(created);
          return created;
        },
        async tagVariant({ id, variantGroupId, variantLabel }: { id: string; variantGroupId: string; variantLabel: string }) {
          const row = drafts.find((d) => d.id === id);
          if (!row) return undefined;
          row.variantGroupId = variantGroupId;
          row.variantLabel = variantLabel;
          return row;
        },
        async variantGroup(variantGroupId: string) {
          return drafts
            .filter((d) => d.variantGroupId === variantGroupId)
            .sort((a, b) => (a.variantLabel ?? '').localeCompare(b.variantLabel ?? ''));
        },
      },
      analytics: {
        async listForItems(ids: string[]) {
          return metrics.filter((m) => ids.includes(m.contentItemId));
        },
      },
      learning: {
        async recordOutcome(args: unknown) {
          learningWrites.push(args);
          return { recorded: true, arm: { pillar: 'proof', alpha: 2, beta: 1, observations: 1, updatedAt: new Date() } };
        },
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    trace: { span: async (_n: string, fn: () => unknown) => fn(), event: () => {} },
  } as unknown as ToolCtx;
  return { ctx: c, learningWrites };
}

const beats = [{ kind: 'text' as const, beatId: 'copy', text: 'the alternative' }];

describe('content.variant.split', () => {
  it('creates a second row rather than editing the first', async () => {
    // Two content items is the whole point: two publishes, two sets of metrics,
    // two outcomes. An edit would be a choice, not a test.
    const drafts = [draft()];
    const { ctx: c } = ctx(drafts);
    const out = await contentVariantSplit.handler(
      { genomeId: 'gen_1', contentItemId: 'ci_a', variantBeats: beats },
      c,
    );
    expect(drafts).toHaveLength(2);
    expect(out.arms.map((a) => a.label)).toEqual(['a', 'b']);
  });

  it('holds everything except the copy constant', async () => {
    // A confound would produce a real number measuring the wrong thing, which
    // is worse than no number.
    const drafts = [draft({ pillar: 'offer', campaignId: 'cmp_1', playbookId: 'pb_offer_announcement', mode: 'assemble' })];
    const { ctx: c } = ctx(drafts);
    await contentVariantSplit.handler({ genomeId: 'gen_1', contentItemId: 'ci_a', variantBeats: beats }, c);
    const armB = drafts[1]!;
    expect(armB.playbookId).toBe('pb_offer_announcement');
    expect(armB.mode).toBe('assemble');
    expect(armB.pillar).toBe('offer');
    expect(armB.campaignId).toBe('cmp_1');
    expect(armB.copy).toEqual(beats);
  });

  it('tags arm A without touching its copy', async () => {
    // Arm A is usually a draft somebody already reviewed. Setting up a test must
    // not alter the words being tested — which is why `tagVariant` exists rather
    // than a widened `updateDraft`.
    const drafts = [draft()];
    const original = drafts[0]!.copy;
    const { ctx: c } = ctx(drafts);
    await contentVariantSplit.handler({ genomeId: 'gen_1', contentItemId: 'ci_a', variantBeats: beats }, c);
    expect(drafts[0]!.copy).toBe(original);
    expect(drafts[0]!.variantLabel).toBe('a');
  });

  it('refuses to test a post that already published', async () => {
    const { ctx: c } = ctx([draft({ status: 'published' })]);
    await expect(
      contentVariantSplit.handler({ genomeId: 'gen_1', contentItemId: 'ci_a', variantBeats: beats }, c),
    ).rejects.toThrow(ToolError);
  });

  it('refuses to nest a test inside a test', async () => {
    const { ctx: c } = ctx([draft({ variantGroupId: 'grp_1', variantLabel: 'a' })]);
    await expect(
      contentVariantSplit.handler({ genomeId: 'gen_1', contentItemId: 'ci_a', variantBeats: beats }, c),
    ).rejects.toThrow(ToolError);
  });

  it('is human-only — SPARK does not decide to double the posting volume', () => {
    // Running a test means deliberately publishing something you think is worse.
    expect(contentVariantSplit.autonomy).toBe('human_only');
  });
});

describe('content.variant.result', () => {
  const group = (over: { aMetrics?: Partial<Metric>; bMetrics?: Partial<Metric>; status?: string } = {}) => {
    const drafts = [
      draft({ id: 'ci_a', variantGroupId: 'grp_1', variantLabel: 'a', status: over.status ?? 'published' }),
      draft({ id: 'ci_b', variantGroupId: 'grp_1', variantLabel: 'b', status: over.status ?? 'published' }),
    ];
    const metrics = [metric('ci_a', over.aMetrics), metric('ci_b', over.bMetrics)];
    return ctx(drafts, metrics);
  };

  it('waits for both arms to publish before comparing anything', async () => {
    const { ctx: c } = group({ status: 'scheduled' });
    const out = await contentVariantResult.handler({ genomeId: 'gen_1', variantGroupId: 'grp_1' }, c);
    expect(out.winner).toBeNull();
    expect(out.undecidedBecause).toBe('awaiting_publish');
  });

  it('refuses to decide below the impressions floor', async () => {
    // A post seen 30 times can beat one seen 28 by a mile in ratio terms and
    // mean nothing at all.
    const { ctx: c } = group({
      aMetrics: { impressions: 30, likes: 6 },
      bMetrics: { impressions: 28, likes: 1 },
    });
    const out = await contentVariantResult.handler({ genomeId: 'gen_1', variantGroupId: 'grp_1' }, c);
    expect(out.winner).toBeNull();
    expect(out.undecidedBecause).toBe('awaiting_metrics');
    expect(out.why.summary).toContain(String(MIN_IMPRESSIONS));
  });

  it('calls a small difference too close rather than a win', async () => {
    // The comfortable lie this exists to refuse: B really is bigger.
    const { ctx: c } = group({
      aMetrics: { impressions: 1_000, likes: 50 },
      bMetrics: { impressions: 1_000, likes: 55 },
    });
    const out = await contentVariantResult.handler({ genomeId: 'gen_1', variantGroupId: 'grp_1' }, c);
    expect(out.winner).toBeNull();
    expect(out.undecidedBecause).toBe('too_close');
    expect(out.why.summary).toMatch(/noise/i);
  });

  it('names a winner once the gap clears the threshold', async () => {
    const { ctx: c } = group({
      aMetrics: { impressions: 1_000, likes: 20 },
      bMetrics: { impressions: 1_000, likes: 80 },
    });
    const out = await contentVariantResult.handler({ genomeId: 'gen_1', variantGroupId: 'grp_1' }, c);
    expect(out.winner).toBe('b');
    expect(out.winnerContentItemId).toBe('ci_b');
  });

  it('still says two posts is a hint when it does name a winner', async () => {
    // The caveat travels with the verdict. Without it the honesty is only in a
    // doc comment nobody reading a dashboard will see.
    const { ctx: c } = group({
      aMetrics: { impressions: 1_000, likes: 20 },
      bMetrics: { impressions: 1_000, likes: 80 },
    });
    const out = await contentVariantResult.handler({ genomeId: 'gen_1', variantGroupId: 'grp_1' }, c);
    expect(out.why.summary).toMatch(/hint, not proof/i);
  });

  it('treats a zero-interaction runner-up as no result, not an infinite win', async () => {
    // The ratio would be Infinity, which is evidence of nothing except that one
    // arm got no interactions.
    const { ctx: c } = group({
      aMetrics: { impressions: 1_000, likes: 40 },
      bMetrics: { impressions: 1_000, likes: 0 },
    });
    const out = await contentVariantResult.handler({ genomeId: 'gen_1', variantGroupId: 'grp_1' }, c);
    expect(out.winner).toBeNull();
    expect(out.undecidedBecause).toBe('too_close');
    expect(out.why.summary).toMatch(/reached anybody/i);
  });

  it('counts saves among interactions, not just likes', async () => {
    // Saves is the strongest short-form signal and the one CC-04 names — a rate
    // that ignored it would understate exactly the posts that worked.
    const { ctx: c } = group({
      aMetrics: { impressions: 1_000, likes: 10 },
      bMetrics: { impressions: 1_000, likes: 10, saves: 60 },
    });
    const out = await contentVariantResult.handler({ genomeId: 'gen_1', variantGroupId: 'grp_1' }, c);
    expect(out.winner).toBe('b');
  });

  it('reports a null rate rather than zero when an arm was seen by nobody', async () => {
    const { ctx: c } = group({ aMetrics: { impressions: 0 }, bMetrics: { impressions: 0 } });
    const out = await contentVariantResult.handler({ genomeId: 'gen_1', variantGroupId: 'grp_1' }, c);
    expect(out.arms.every((a) => a.engagementRate === null)).toBe(true);
  });

  it('orders arms by label so a verdict never swaps sides', async () => {
    const { ctx: c } = group({ aMetrics: { impressions: 1_000 }, bMetrics: { impressions: 1_000 } });
    const out = await contentVariantResult.handler({ genomeId: 'gen_1', variantGroupId: 'grp_1' }, c);
    expect(out.arms.map((a) => a.label)).toEqual(['a', 'b']);
  });

  it('writes nothing to the learning loop', async () => {
    // It is a read. `learning.record_outcome` owns the reward, computed from the
    // brand's own baseline — a second reward formula here would drift from it.
    const { ctx: c, learningWrites } = group({
      aMetrics: { impressions: 1_000, likes: 20 },
      bMetrics: { impressions: 1_000, likes: 80 },
    });
    await contentVariantResult.handler({ genomeId: 'gen_1', variantGroupId: 'grp_1' }, c);
    expect(learningWrites).toEqual([]);
    expect(contentVariantResult.effect).toBe('read');
  });

  it('points at the tool that does the recording', async () => {
    const { ctx: c } = group({
      aMetrics: { impressions: 1_000, likes: 20 },
      bMetrics: { impressions: 1_000, likes: 80 },
    });
    const out = await contentVariantResult.handler({ genomeId: 'gen_1', variantGroupId: 'grp_1' }, c);
    expect(out.why.factors?.some((f) => f.detail?.includes('learning.record_outcome'))).toBe(true);
  });

  it('404s for a group that does not exist in this brand', async () => {
    const { ctx: c } = ctx([]);
    await expect(
      contentVariantResult.handler({ genomeId: 'gen_1', variantGroupId: 'nope' }, c),
    ).rejects.toThrow(ToolError);
  });

  it('states its threshold rather than hiding it', () => {
    // A coarse heuristic that admits it is one. Exported so the UI and the tests
    // read the same number as the tool.
    expect(DECISIVE_RATIO).toBeGreaterThan(1);
    expect(MIN_IMPRESSIONS).toBeGreaterThan(0);
  });
});
