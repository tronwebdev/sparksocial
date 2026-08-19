import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';

/**
 * `learning.*` — THE LEARNING LOOP, plan §6.7 / §12 P6.
 *
 *   *"Metric ingestion → Thompson sampling reweighting → exploration floor →
 *   confidence."* (§12's own summary.)
 *
 * `packages/playbooks/src/mix.ts`'s `deriveMix()` already reads
 * `genome.learned.confidence`/`.mix_weights_override` and already re-caps at
 * the 35% promotional ceiling "including by the learning loop" (its own
 * comment) — that consumer side has existed since P2/P3. What was missing is
 * this file: the only writer of those two fields. Nothing else in the
 * registry may touch them (`ScopedDb['genomes'].patchLearned`'s own doc
 * comment says so) — this is where "the account's own performance" in that
 * comment actually comes from.
 *
 * ── The exploration floor ───────────────────────────────────────────────
 * A pillar with two lucky posts is noise, not a signal. `learning.reweight`
 * refuses to let a pillar influence the mix until it has
 * `EXPLORATION_FLOOR_OBSERVATIONS` outcomes, and refuses to set an override
 * at all until at least `MIN_QUALIFYING_ARMS` pillars clear that floor — one
 * hot pillar cannot hijack the whole account's ratio off five posts.
 *
 * ── Where the reward comes from ─────────────────────────────────────────
 * `learning.record_outcome` never accepts a caller-supplied reward number —
 * that would be a straightforward way to fabricate "performance." It computes
 * one from real `content_metrics`, relative to the *same genome's own* recent
 * baseline (never cross-genome, never cross-niche) — a post doing twice this
 * account's own recent average engagement scores a full 1.0.
 */

const EXPLORATION_FLOOR_OBSERVATIONS = 5;
const MIN_QUALIFYING_ARMS = 2;
/** Total observations, across all arms, at which confidence reaches 1.0 — chosen so the §3.2 0.4 threshold arrives around ten real outcomes, a few weeks of posting. */
const CONFIDENCE_TARGET_OBSERVATIONS = 25;

const ArmOut = z.object({
  pillar: z.string(),
  alpha: z.number(),
  beta: z.number(),
  observations: z.number(),
  posteriorMean: z.number(),
  qualifies: z.boolean(),
});

function shapeArm(a: { pillar: string; alpha: number; beta: number; observations: number }) {
  return {
    pillar: a.pillar,
    alpha: a.alpha,
    beta: a.beta,
    observations: a.observations,
    posteriorMean: round(a.alpha / (a.alpha + a.beta)),
    qualifies: a.observations >= EXPLORATION_FLOOR_OBSERVATIONS,
  };
}

/* ── learning.record_outcome ─────────────────────────────────────────── */

export const LearningRecordOutcomeInput = z.object({
  genomeId: z.string().min(1),
  contentItemId: z.string().min(1),
});

export const LearningRecordOutcomeOutput = z.object({
  recorded: z.boolean(),
  pillar: z.string(),
  reward: z.number(),
  arm: ArmOut,
  why: Explanation,
});

export const learningRecordOutcome = defineTool({
  name: 'learning.record_outcome',
  version: 1,

  summary:
    'Score one published post against this genome\'s own recent engagement baseline and record it ' +
    'against its pillar\'s Thompson-sampling arm. The reward is always computed from real content_metrics ' +
    '— never a caller-supplied number.',

  input: LearningRecordOutcomeInput,
  output: LearningRecordOutcomeOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  // Idempotent on contentItemId at the storage layer (the unique index on
  // learning_outcomes) — a repeated call for the same post is a safe replay,
  // not a second vote.
  idempotent: true,

  async handler(input, ctx) {
    const item = await ctx.db.content.get(input.contentItemId, input.genomeId, ctx.orgId);
    if (!item) throw new ToolError('NOT_FOUND', 'No such content item.', { contentItemId: input.contentItemId });
    if (!item.pillar) {
      throw new ToolError('INVALID_INPUT', 'This item has no pillar — nothing for the mix engine to learn about.', {
        contentItemId: input.contentItemId,
      });
    }
    if (item.status !== 'published') {
      throw new ToolError('INVALID_INPUT', 'Only a published post has an outcome to measure.', {
        contentItemId: input.contentItemId,
        status: item.status,
      });
    }

    const ownMetrics = await ctx.db.analytics.listForItems([input.contentItemId], ctx.orgId, input.genomeId);
    const itemEngagement = sumEngagement(ownMetrics);

    // Baseline: this genome's own other recent published posts. Never
    // another genome's, and never the wider platform's — this account's
    // definition of "a good post" is the only one that gets to move its own
    // dial.
    const recent = await ctx.db.content.list(input.genomeId, ctx.orgId, { status: 'published', limit: 50 });
    const recentIds = recent.map((r) => r.id).filter((id) => id !== input.contentItemId);
    const recentMetrics = recentIds.length ? await ctx.db.analytics.listForItems(recentIds, ctx.orgId, input.genomeId) : [];
    const baseline = averageEngagementPerItem(recentMetrics) ?? 1;

    // Twice the recent baseline is a full 1.0; zero engagement is 0.
    const reward = clamp01(itemEngagement / (2 * Math.max(baseline, 1)));

    const { recorded, arm } = await ctx.db.learning.recordOutcome({
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      contentItemId: input.contentItemId,
      pillar: item.pillar,
      reward,
    });

    ctx.logger.info('learning outcome recorded', { genomeId: input.genomeId, pillar: item.pillar, reward: round(reward), recorded });

    return {
      recorded,
      pillar: item.pillar,
      reward: round(reward),
      arm: shapeArm(arm),
      why: {
        summary: recorded
          ? `${item.pillar}: ${itemEngagement} engagement vs. a recent baseline of ${round(baseline)} → reward ${round(reward)}.`
          : `Already scored — this post's outcome was recorded previously.`,
        factors: [
          { label: 'engagement', detail: `${itemEngagement} likes+comments+shares` },
          { label: 'baseline', detail: `${round(baseline)}, from ${recentMetrics.length ? new Set(recentMetrics.map((m) => m.contentItemId)).size : 0} recent posts` },
        ],
        evidence: [{ kind: 'metric' as const, id: input.contentItemId, note: `reward ${round(reward)}` }],
        alternatives: [],
      },
    };
  },
});

/* ── learning.reweight ───────────────────────────────────────────────── */

export const LearningReweightInput = z.object({ genomeId: z.string().min(1) });

export const LearningReweightOutput = z.object({
  confidence: z.number(),
  mixWeightsOverride: z.record(z.string(), z.number()).nullable(),
  arms: z.array(ArmOut),
  why: Explanation,
});

export const learningReweight = defineTool({
  name: 'learning.reweight',
  version: 1,

  summary:
    'Recompute this genome\'s learned mix weights and confidence from its Thompson-sampling arms. The only ' +
    'writer of genome.learned — the resolver\'s mix engine (already wired) picks it up automatically once ' +
    'confidence clears 0.4.',

  input: LearningReweightInput,
  output: LearningReweightOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin'],
  // Recomputing from the same arm data twice in a row produces the same
  // result — a safe replay, not a new decision.
  idempotent: true,
  surfaces: ['CAL-03'],

  async handler(input, ctx) {
    const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
    if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

    const armRows = await ctx.db.learning.list(input.genomeId, ctx.orgId);
    const arms = armRows.map(shapeArm);

    // `learning.freeze` locks the mix at whatever it currently is — this is
    // the ONLY writer of `mix_weights_override`/`confidence` (this file's own
    // header comment), so refusing to write here is what "frozen" means in
    // practice. Arms keep accumulating in the background via
    // `learning.record_outcome`; freezing does not stop data collection, only
    // the moment the mix engine would act on it.
    if (genome.learned.frozen) {
      ctx.logger.info('learning reweight skipped — frozen', { genomeId: input.genomeId });
      return {
        confidence: round(genome.learned.confidence),
        mixWeightsOverride: genome.learned.mix_weights_override,
        arms,
        why: {
          summary: `Frozen — the mix stays at its last computed state (confidence ${round(genome.learned.confidence)}). Call learning.freeze with enabled: false to resume.`,
          factors: [{ label: 'frozen', detail: 'learning.freeze is active for this genome' }],
          evidence: [{ kind: 'rule' as const, id: 'learning.frozen', note: 'learning.reweight is a no-op while frozen' }],
          alternatives: [],
        },
      };
    }

    const qualifying = arms.filter((a) => a.qualifies);
    const totalObservations = arms.reduce((s, a) => s + a.observations, 0);
    const confidence = round(clamp01(totalObservations / CONFIDENCE_TARGET_OBSERVATIONS));

    const mixWeightsOverride =
      qualifying.length >= MIN_QUALIFYING_ARMS
        ? Object.fromEntries(qualifying.map((a) => [a.pillar, a.posteriorMean]))
        : null;

    await ctx.db.genomes.patchLearned({
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      patch: { confidence, ...(mixWeightsOverride ? { mix_weights_override: mixWeightsOverride } : {}) },
    });

    ctx.logger.info('learning reweighted', { genomeId: input.genomeId, confidence, qualifyingArms: qualifying.length });

    return {
      confidence,
      mixWeightsOverride,
      arms,
      why: {
        summary: mixWeightsOverride
          ? `Learned mix applied — ${qualifying.length} pillar${qualifying.length === 1 ? '' : 's'} have enough data (confidence ${confidence}).`
          : `Still cold-start — ${qualifying.length} of ${MIN_QUALIFYING_ARMS} pillars needed have cleared ${EXPLORATION_FLOOR_OBSERVATIONS} observations (confidence ${confidence}).`,
        factors: arms.map((a) => ({ label: a.pillar, detail: `${a.observations} obs, posterior ${a.posteriorMean}`, weight: a.posteriorMean })),
        evidence: [{ kind: 'rule' as const, id: 'engine_spec.§7.2', note: 'Thompson sampling, exploration floor, confidence threshold 0.4' }],
        alternatives: [],
      },
    };
  },
});

/* ── learning.confidence ─────────────────────────────────────────────── */

export const learningConfidence = defineTool({
  name: 'learning.confidence',
  version: 1,
  summary: 'Read this genome\'s current learning state — confidence, whether a learned mix is active, and every arm\'s standing. Free, no writes.',
  input: z.object({ genomeId: z.string().min(1) }),
  output: z.object({
    confidence: z.number(),
    active: z.boolean(),
    mixWeightsOverride: z.record(z.string(), z.number()).nullable(),
    arms: z.array(ArmOut),
  }),
  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,
  async handler(input, ctx) {
    const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
    if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });
    const armRows = await ctx.db.learning.list(input.genomeId, ctx.orgId);
    return {
      confidence: genome.learned.confidence,
      active: genome.learned.confidence > 0.4 && genome.learned.mix_weights_override !== null,
      mixWeightsOverride: genome.learned.mix_weights_override,
      arms: armRows.map(shapeArm),
    };
  },
});

/* ── learning.explain ────────────────────────────────────────────────── */

export const learningExplain = defineTool({
  name: 'learning.explain',
  version: 1,
  summary: 'Why the mix engine is using cold-start or learned weights right now, arm by arm.',
  input: z.object({ genomeId: z.string().min(1) }),
  output: z.object({ why: Explanation }),
  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,
  async handler(input, ctx) {
    const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
    if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });
    const armRows = await ctx.db.learning.list(input.genomeId, ctx.orgId);
    const arms = armRows.map(shapeArm);
    const active = genome.learned.confidence > 0.4 && genome.learned.mix_weights_override !== null;

    return {
      why: {
        summary: active
          ? `Using this account's own learned mix (confidence ${round(genome.learned.confidence)}).`
          : `Still using cold-start defaults (confidence ${round(genome.learned.confidence)}, needs > 0.4).`,
        factors: arms.length
          ? arms.map((a) => ({ label: a.pillar, detail: `${a.observations} outcomes, ${a.qualifies ? 'qualifies' : 'below the exploration floor'}`, weight: a.posteriorMean }))
          : [{ label: 'no data yet', detail: 'call learning.record_outcome as posts publish to start learning' }],
        evidence: [],
        alternatives: [],
      },
    };
  },
});

/* ── learning.freeze ─────────────────────────────────────────────────── */

export const LearningFreezeInput = z.object({ genomeId: z.string().min(1), enabled: z.boolean() });

export const LearningFreezeOutput = z.object({
  genomeId: z.string(),
  frozen: z.boolean(),
  why: Explanation,
});

export const learningFreeze = defineTool({
  name: 'learning.freeze',
  version: 1,

  summary:
    'Lock this genome’s mix at its current state and stop learning.reweight moving it further, without ' +
    'discarding accumulated data — use learning.reset for that. The learning-loop equivalent of agent.pause.',

  input: LearningFreezeInput,
  output: LearningFreezeOutput,

  effect: 'write',
  // Same reasoning as `agent.pause`/`.resume`: overriding an automatic
  // process because a person disagrees with where it's heading is exactly
  // the kind of decision that must not also be SPARK's to make about itself.
  autonomy: 'human_only',
  scopes: ['owner', 'admin', 'editor', 'approver'],
  idempotent: true,

  async handler(input, ctx) {
    const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
    if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

    await ctx.db.genomes.patchLearned({ genomeId: input.genomeId, orgId: ctx.orgId, patch: { frozen: input.enabled } });
    ctx.logger.info('learning freeze set', { genomeId: input.genomeId, frozen: input.enabled });

    return {
      genomeId: input.genomeId,
      frozen: input.enabled,
      why: {
        summary: input.enabled
          ? `Frozen at confidence ${round(genome.learned.confidence)} — learning.reweight will no-op until unfrozen.`
          : 'Unfrozen — learning.reweight resumes moving the mix from accumulated data.',
        factors: [{ label: 'frozen', detail: String(input.enabled) }],
        evidence: [],
        alternatives: [],
      },
    };
  },
});

/* ── learning.reset ──────────────────────────────────────────────────── */

export const LearningResetInput = z.object({ genomeId: z.string().min(1) });

export const LearningResetOutput = z.object({
  genomeId: z.string(),
  why: Explanation,
});

export const learningReset = defineTool({
  name: 'learning.reset',
  version: 1,

  summary:
    'Wipe this genome’s learning state back to true cold start — every arm and every recorded outcome, ' +
    'confidence back to 0, the learned mix override cleared. Not reversible; also clears any freeze.',

  input: LearningResetInput,
  output: LearningResetOutput,

  effect: 'destructive',
  // `destructive` already routes to owner/admin approval via policy.ts rule 5
  // regardless of this — `human_only` on top is belt-and-suspenders for the
  // same reason `agent.resume` narrows past `agent.pause`: deleting weeks of
  // accumulated performance data is not a call SPARK gets to propose to itself.
  autonomy: 'human_only',
  scopes: ['owner', 'admin'],
  idempotent: true,

  async handler(input, ctx) {
    const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
    if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

    await ctx.db.learning.reset(input.genomeId, ctx.orgId);
    await ctx.db.genomes.patchLearned({
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      patch: { confidence: 0, mix_weights_override: null, frozen: false, top_formats: [], best_post_times: [] },
    });

    ctx.logger.warn('learning reset', { genomeId: input.genomeId });

    return {
      genomeId: input.genomeId,
      why: {
        summary: 'Every arm and outcome deleted, confidence and mix override cleared — this genome is back to cold start.',
        factors: [{ label: 'reversible', detail: 'no — accumulated performance data is gone, not archived' }],
        evidence: [],
        alternatives: [],
      },
    };
  },
});

function sumEngagement(rows: Array<{ likes: number; comments: number; shares: number }>): number {
  return rows.reduce((s, r) => s + r.likes + r.comments + r.shares, 0);
}

function averageEngagementPerItem(rows: Array<{ contentItemId: string; likes: number; comments: number; shares: number }>): number | undefined {
  if (rows.length === 0) return undefined;
  const byItem = new Map<string, number>();
  for (const r of rows) byItem.set(r.contentItemId, (byItem.get(r.contentItemId) ?? 0) + r.likes + r.comments + r.shares);
  const values = [...byItem.values()];
  return values.reduce((s, v) => s + v, 0) / values.length;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round = (n: number) => Math.round(n * 1000) / 1000;
