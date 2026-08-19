import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { GuardrailableDraft } from './draft.js';
import { gatherAndEvaluate, ALL_GUARDRAILS, type EmbedClient } from './gather.js';

/**
 * `guard.evaluate_draft` — engine spec §10, master plan's `guard.*` family
 * ("guard.claim_grounding" through "guard.explain", collapsed into one call
 * that reports all seven and doubles as `guard.explain`).
 *
 * Deliberately does **not** declare `guardrails` on itself. `invokeTool`'s
 * middleware chain aborts on the *first* `block` and only surfaces that one
 * check's reason (see `packages/tools/src/invoke.ts` step 4) — exactly right
 * for a tool that's *producing* something and needs to be stopped, and exactly
 * wrong for a tool whose entire purpose is to report every check's result so a
 * human or SPARK can see what to fix. This tool calls the same evaluator
 * directly instead; `makeRunGuardrails` (`runGuardrails.ts`) is the adapter
 * used by tools that *do* want the middleware to enforce guardrails on them.
 */

const CheckResultSchema = z.object({
  verdict: z.enum(['pass', 'flag', 'block']),
  rule: z.string().optional(),
  evidence: z.unknown().optional(),
  fixAction: z.string().optional(),
});

export const EvaluateDraftInput = GuardrailableDraft;

export const EvaluateDraftOutput = z.object({
  overall: z.enum(['pass', 'flag', 'block']),
  checks: z.record(z.string(), CheckResultSchema),
  why: z.object({
    summary: z.string(),
    factors: z.array(z.object({ label: z.string(), detail: z.string().optional() })),
    evidence: z.array(z.object({ kind: z.enum(['rule']), id: z.string(), note: z.string().optional() })).default([]),
    alternatives: z.array(z.object({ option: z.string(), rejectedBecause: z.string() })).default([]),
  }),
});

export function makeEvaluateDraft(deps: EmbedClient) {
  return defineTool({
    name: 'guard.evaluate_draft',
    version: 1,

    summary:
      'Run every guardrail (claim grounding, compliance, brand voice, avatar saturation, ' +
      'duplicate, platform policy, rights) against a draft and report each result with a fix ' +
      'action. Call this before scheduling anything; never skip straight to publish.',

    input: EvaluateDraftInput,
    output: EvaluateDraftOutput,

    effect: 'read',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor', 'approver'],
    idempotent: true,
    surfaces: ['CAL-06', 'CC-02A'],

    async handler(input, ctx) {
      const checks = await gatherAndEvaluate(input, ctx, deps, ALL_GUARDRAILS);

      const blocked = Object.entries(checks).filter(([, r]) => r.verdict === 'block');
      const flagged = Object.entries(checks).filter(([, r]) => r.verdict === 'flag');
      const overall: 'pass' | 'flag' | 'block' = blocked.length > 0 ? 'block' : flagged.length > 0 ? 'flag' : 'pass';

      ctx.logger.info('draft evaluated', { genomeId: input.genomeId, overall, blocked: blocked.length, flagged: flagged.length });

      return {
        overall,
        checks,
        why: {
          summary:
            overall === 'pass'
              ? 'All guardrails clear — safe to schedule.'
              : `${blocked.length} blocking issue(s), ${flagged.length} flagged for review.`,
          factors: [...blocked, ...flagged].map(([guard, r]) => ({
            label: guard,
            detail: r.fixAction ?? r.rule,
          })),
          evidence: [{ kind: 'rule' as const, id: 'engine_spec.§10', note: 'Each guardrail applies its own rule.' }],
          alternatives: [],
        },
      };
    },
  });
}
