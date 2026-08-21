import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import { ResolvedBeat } from './draft.js';

/**
 * `content.variant.split` / `content.variant.result` — PRD §8.9 / `DISC-02`'s
 * A/B test.
 *
 * §8.9 marks A/B optional and half of it already existed: `draft.variants`
 * writes alternative takes on the same playbook and the Draft Panel shows them.
 * What was missing is the part that makes it a *test* rather than a choice —
 * two posts that both go out, each measured, with the result feeding
 * `learning.record_outcome`.
 *
 * ── The honest part, which is most of the design ──────────────────────────
 *
 * **Two posts are not a sample.** Any tool that reads two engagement numbers and
 * announces a winner is lying, and it is a comfortable lie because the number
 * really is bigger. So `content.variant.result` reports the observed difference,
 * says outright how weak the evidence is, and only records an outcome to the
 * learning loop when the gap is large enough that noise is an unlikely
 * explanation — see {@link DECISIVE_RATIO} and {@link MIN_IMPRESSIONS}.
 *
 * When it is not decisive it says so and records nothing. A Thompson-sampling
 * arm updated from coin flips is worse than an arm with no data: the mix engine
 * would act on it with the same confidence either way.
 *
 * ── This tool does not write to the learning loop ─────────────────────────
 *
 * It names the winning content item and stops there. `learning.record_outcome`
 * already scores a published post against the genome's *own recent baseline* and
 * refuses a caller-supplied reward — so recording from here would mean either
 * re-deriving that baseline (a second reward formula, guaranteed to drift from
 * the first) or handing it a number, which it correctly will not accept.
 *
 * A first draft of this file did compute its own reward. That is exactly the
 * "two scorers, one question" mistake this codebase avoids elsewhere, and the
 * comment justifying it was wrong in a way that read as careful. One reward
 * formula, in the tool that owns it; this one decides only *whether the test
 * settled anything*.
 */

/**
 * How much better an arm has to do before the difference is worth acting on.
 *
 * 1.5× on the engagement rate. Chosen to be obviously past the noise of two
 * posts rather than as a statistical threshold, because with n=1 per arm there
 * is no statistic to compute — this is a *heuristic that admits it is one*, and
 * a smaller number would give the appearance of rigour without the substance.
 */
export const DECISIVE_RATIO = 1.5;

/**
 * Below this many impressions on either arm, nothing is decided at all.
 *
 * A post seen 30 times can beat one seen 28 times by a mile in ratio terms and
 * mean nothing whatsoever. This is the floor that stops a verdict being reached
 * on the first hour of delivery.
 */
export const MIN_IMPRESSIONS = 200;

/* ── content.variant.split ───────────────────────────────────────────── */

export const ContentVariantSplitInput = z.object({
  genomeId: z.string().min(1),
  /** The draft that becomes arm `a`. */
  contentItemId: z.string().min(1),
  /**
   * The alternative copy, as `draft.variants` returned it. Passed in rather than
   * re-generated so the arm that gets published is the one a person actually
   * read — regenerating here would make the test about copy nobody approved.
   */
  variantBeats: z.array(ResolvedBeat).min(1),
});

export const ContentVariantSplitOutput = z.object({
  variantGroupId: z.string(),
  arms: z.array(z.object({ contentItemId: z.string(), label: z.string() })),
  why: Explanation,
});

export const contentVariantSplit = defineTool({
  name: 'content.variant.split',
  version: 1,

  summary:
    'Turn a draft and one of its alternative takes into a two-arm A/B test: the original becomes arm A, ' +
    'the alternative is saved as arm B, and both are scheduled and measured separately. Free.',

  input: ContentVariantSplitInput,
  output: ContentVariantSplitOutput,

  effect: 'write',
  /**
   * `human_only`. Running an A/B test means deliberately publishing something
   * you believe is *worse* to find out — a reasonable thing for a person to
   * choose and not a decision to hand an agent, which would otherwise be free to
   * double a brand's posting volume in the name of learning.
   */
  autonomy: 'human_only',
  scopes: ['owner', 'admin', 'editor'],
  // A second call makes a second arm, not the same one again.
  idempotent: false,
  surfaces: ['DISC-02', 'CC-03'],

  async handler(input, ctx) {
    const original = await ctx.db.content.get(input.contentItemId, input.genomeId, ctx.orgId);
    if (!original) throw new ToolError('NOT_FOUND', 'No such draft.', { contentItemId: input.contentItemId });

    if (original.status === 'published' || original.status === 'rolled_back') {
      throw new ToolError('INVALID_INPUT', 'That post has already gone out — a test has to be set up before either arm publishes.', {
        contentItemId: input.contentItemId,
        status: original.status,
      });
    }
    if (original.variantGroupId) {
      throw new ToolError('INVALID_INPUT', 'That draft is already an arm of a test.', {
        contentItemId: input.contentItemId,
        variantGroupId: original.variantGroupId,
      });
    }

    const variantGroupId = randomUUID();

    /**
     * Arm B is a new row rather than an edit, which is the whole point: two
     * `content_items` are two publishes, two sets of metrics and two outcomes.
     * It inherits the playbook, mode, pillar and campaign so the *only*
     * difference between the arms is the copy — otherwise the test measures
     * whichever confound came along for the ride.
     */
    const armB = await ctx.db.content.createDraft({
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      playbookId: original.playbookId,
      mode: original.mode as 'synthesize' | 'assemble' | 'direct_finish',
      ...(original.pillar ? { pillar: original.pillar } : {}),
      ...(original.campaignId ? { campaignId: original.campaignId } : {}),
      copy: input.variantBeats,
      why: {
        summary: 'Arm B of an A/B test — same playbook and assets as arm A, different copy.',
        factors: [{ label: 'variant of', detail: original.id }],
        evidence: [],
        alternatives: [],
      },
      variantGroupId,
      variantLabel: 'b',
    });

    /**
     * Arm A is tagged by an update rather than being recreated, so its existing
     * schedule, renders and approval history survive. A test set up on a draft
     * somebody already placed on the calendar should not move it.
     */
    await ctx.db.content.tagVariant({
      id: original.id,
      genomeId: input.genomeId,
      orgId: ctx.orgId,
      variantGroupId,
      variantLabel: 'a',
    });

    ctx.logger.info('variant test created', { variantGroupId, armA: original.id, armB: armB.id });

    return {
      variantGroupId,
      arms: [
        { contentItemId: original.id, label: 'a' },
        { contentItemId: armB.id, label: 'b' },
      ],
      why: {
        summary: 'Both arms will publish and be measured separately. Schedule them close together — a day apart is a different audience, not a different post.',
        factors: [
          { label: 'held constant', detail: 'playbook, assets, pillar and campaign' },
          { label: 'varied', detail: 'the written copy only' },
          // The arm ids go in a factor rather than in `evidence`: that field's
          // `kind` enum has no member for a content item, and labelling a draft
          // as a `past_post` or a `metric` to satisfy the type would make the
          // explanation say something untrue.
          { label: 'arms', detail: `a: ${original.id}, b: ${armB.id}` },
        ],
        evidence: [],
        alternatives: [],
      },
    };
  },
});

/* ── content.variant.result ──────────────────────────────────────────── */

const ArmResult = z.object({
  contentItemId: z.string(),
  label: z.string(),
  status: z.string(),
  impressions: z.number().int(),
  /** Likes + comments + shares + saves. The interactions, not the reach. */
  engagements: z.number().int(),
  /** Engagements over impressions. Null when nothing was seen — not zero, which would read as "nobody engaged". */
  engagementRate: z.number().nullable(),
});

export const ContentVariantResultInput = z.object({
  genomeId: z.string().min(1),
  variantGroupId: z.string().min(1),
});

export const ContentVariantResultOutput = z.object({
  variantGroupId: z.string(),
  arms: z.array(ArmResult),
  /** The better arm, or null when nothing can be concluded. */
  winner: z.string().nullable(),
  /**
   * Why there is no winner, when there is not: `awaiting_publish`,
   * `awaiting_metrics`, `too_close`. Named states rather than one "inconclusive",
   * because they call for completely different actions.
   */
  undecidedBecause: z.enum(['awaiting_publish', 'awaiting_metrics', 'too_close']).nullable(),
  /**
   * The winning arm's content item, so a caller can pass it straight to
   * `learning.record_outcome` — which is where the reward is computed, from the
   * genome's own baseline. Null whenever `winner` is.
   */
  winnerContentItemId: z.string().nullable(),
  why: Explanation,
});

export const contentVariantResult = defineTool({
  name: 'content.variant.result',
  version: 1,

  summary:
    'How the two arms of an A/B test actually did, and whether the difference is big enough to mean ' +
    'anything. Optionally records the winner against its pillar for the mix engine to learn from.',

  input: ContentVariantResultInput,
  output: ContentVariantResultOutput,

  // A read: it writes nothing, which is what lets a dashboard poll it without
  // wondering whether looking at a result changes it.
  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,
  surfaces: ['DISC-02', 'CC-04'],

  async handler(input, ctx) {
    const arms = await ctx.db.content.variantGroup(input.variantGroupId, input.genomeId, ctx.orgId);
    if (arms.length === 0) {
      throw new ToolError('NOT_FOUND', 'No test with that id in this brand.', { variantGroupId: input.variantGroupId });
    }

    const metrics = await ctx.db.analytics.listForItems(
      arms.map((a) => a.id),
      ctx.orgId,
      input.genomeId,
    );
    const byItem = new Map(metrics.map((m) => [m.contentItemId, m]));

    const results = arms.map((arm) => {
      const m = byItem.get(arm.id);
      const impressions = m?.impressions ?? 0;
      const engagements = (m?.likes ?? 0) + (m?.comments ?? 0) + (m?.shares ?? 0) + (m?.saves ?? 0);
      return {
        contentItemId: arm.id,
        label: arm.variantLabel ?? '?',
        status: arm.status,
        impressions,
        engagements,
        // Null, not zero: "seen by nobody" and "seen and ignored" are different
        // facts and only one of them is a result.
        engagementRate: impressions > 0 ? Number((engagements / impressions).toFixed(4)) : null,
      };
    });

    const verdict = decide(results);
    const winning = verdict.winner ? arms.find((a) => a.variantLabel === verdict.winner) : undefined;

    return {
      variantGroupId: input.variantGroupId,
      arms: results,
      winner: verdict.winner,
      undecidedBecause: verdict.because,
      winnerContentItemId: winning?.id ?? null,
      why: explainVerdict(results, verdict, Boolean(winning?.pillar)),
    };
  },
});

type ArmResultT = z.infer<typeof ArmResult>;
interface Verdict {
  winner: string | null;
  because: 'awaiting_publish' | 'awaiting_metrics' | 'too_close' | null;
  ratio: number | null;
}

/**
 * Three named ways to have no winner, because they call for different actions:
 * wait for the post to go out, wait for the numbers, or accept that the copy did
 * not matter. Collapsing them into "inconclusive" would tell somebody to keep
 * refreshing a test that has already finished saying nothing.
 */
function decide(arms: ArmResultT[]): Verdict {
  if (arms.some((a) => a.status !== 'published')) {
    return { winner: null, because: 'awaiting_publish', ratio: null };
  }
  if (arms.some((a) => a.impressions < MIN_IMPRESSIONS)) {
    return { winner: null, because: 'awaiting_metrics', ratio: null };
  }

  const ranked = [...arms].sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0));
  const best = ranked[0]!;
  const next = ranked[1];
  if (!next) return { winner: best.label, because: null, ratio: null };

  const bestRate = best.engagementRate ?? 0;
  const nextRate = next.engagementRate ?? 0;
  // A zero-rate runner-up would make the ratio infinite, which is not evidence
  // of anything except that one arm got no interactions at all.
  const ratio = nextRate > 0 ? Number((bestRate / nextRate).toFixed(2)) : null;

  if (ratio === null || ratio < DECISIVE_RATIO) {
    return { winner: null, because: 'too_close', ratio };
  }
  return { winner: best.label, because: null, ratio };
}

/**
 * §7.3's `why`, and the place the tool is honest about its own limits.
 *
 * A verdict from two posts is a hint. Saying so in the explanation — rather than
 * in a doc comment nobody reading the dashboard will see — is the difference
 * between a useful heuristic and a product that invents statistical confidence.
 */
function explainVerdict(arms: ArmResultT[], verdict: Verdict, learnable: boolean): Explanation {
  const evidence = arms.map((a) => ({
    kind: 'metric' as const,
    id: a.contentItemId,
    note: `arm ${a.label}: ${a.impressions} seen, ${a.engagements} interactions`,
  }));

  if (verdict.because === 'awaiting_publish') {
    return {
      summary: 'Both arms have to publish before there is anything to compare.',
      factors: [{ label: 'status', detail: arms.map((a) => `${a.label}: ${a.status}`).join(', ') }],
      evidence,
      alternatives: [],
    };
  }
  if (verdict.because === 'awaiting_metrics') {
    return {
      summary: `Not enough reach yet — each arm needs at least ${MIN_IMPRESSIONS} impressions before a difference means anything.`,
      factors: [{ label: 'why the floor', detail: 'a post seen 30 times can beat one seen 28 by a mile in ratio terms and mean nothing' }],
      evidence,
      alternatives: [],
    };
  }
  if (verdict.because === 'too_close') {
    return {
      summary:
        verdict.ratio === null
          ? 'One arm got no interactions at all, which is not a result — it is a reason to check the post reached anybody.'
          : `Too close to call: ${verdict.ratio}× apart, and anything under ${DECISIVE_RATIO}× on two posts is noise. The copy probably did not matter here.`,
      factors: [{ label: 'nothing recorded', detail: 'a learning arm updated from coin flips is worse than one with no data' }],
      evidence,
      alternatives: [],
    };
  }

  return {
    summary:
      `Arm ${verdict.winner} did better${verdict.ratio ? ` — ${verdict.ratio}× the engagement rate` : ''}. ` +
      'Two posts is a hint, not proof: treat it as a direction to try again in, not a settled fact.',
    factors: [
      { label: 'threshold', detail: `${DECISIVE_RATIO}× on the engagement rate, deliberately coarse — with one post per arm there is no statistic to compute` },
      learnable
        ? { label: 'next', detail: 'pass the winning post to learning.record_outcome — it scores against this brand\'s own baseline' }
        : { label: 'not learnable', detail: 'the winning arm has no pillar, so there is no mix-engine arm to credit' },
    ],
    evidence,
    alternatives: [],
  };
}
