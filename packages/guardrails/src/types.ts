import type { GuardrailId } from '@sparksocial/tools/defineTool';

export type { GuardrailId };

/**
 * The verdict every guardrail check returns. Mirrors `packages/tools/src/invoke.ts`'s
 * `GuardrailVerdict` shape exactly, so a check's return value can be handed straight
 * to the audit row without translation.
 *
 * `block` and `flag` both carry `rule` + `fixAction` — engine spec §10 requires
 * every guardrail hit to name what fired and what to do about it, not just that
 * something failed.
 */
export interface CheckResult {
  verdict: 'pass' | 'flag' | 'block';
  rule?: string;
  evidence?: unknown;
  fixAction?: string;
}

export const PASS: CheckResult = { verdict: 'pass' };
