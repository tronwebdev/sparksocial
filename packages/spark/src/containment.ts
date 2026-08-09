import { isUntrusted } from '@sparksocial/shared';
import type { Effect } from '@sparksocial/shared';

/**
 * PROMPT-INJECTION CONTAINMENT — master plan §10:
 *
 *   *"Content fetched from the web, from crawled customer sites, from RSS, and
 *   from social inboxes is wrapped as untrusted data and can never authorise a
 *   tool call. Enforced in the runtime, tested adversarially in the eval suite."*
 *
 * `untrusted()` in `@sparksocial/shared` is the *marker*. This module is the
 * *enforcement*, and it is two mechanisms, because either alone is insufficient:
 *
 *  1. **Delimiter containment (`renderUntrusted`).** Untrusted text is rendered
 *     inside a fenced block whose closing tag the content cannot forge. Without
 *     escaping, a crawled page containing the literal closing tag would end the
 *     data block early and have everything after it read as trusted instruction —
 *     which is the entire attack.
 *
 *  2. **Authority denial (`containmentFlags`).** Delimiters reduce the odds a
 *     model obeys injected text; they do not make it impossible. So a turn that
 *     ingested untrusted content cannot *silently* take a consequential action:
 *     publishes, spends, outbound messages and destructive calls are flagged,
 *     and the policy engine escalates a flag to approval (PRD §9). The result is
 *     that injected text can at most cost a human one rejected review item —
 *     never an unattended publish.
 *
 * Both halves are pure and tested against real injection payloads
 * (`test/containment.test.ts`).
 */

/**
 * The delimiter half now lives in `@sparksocial/shared` and is re-exported here
 * so existing importers are unchanged. It moved because `packages/genome`'s
 * inference pass builds a prompt over crawled text too, and genome sits before
 * spark in the build order — a second copy of the fencing is how one prompt
 * ends up weaker than the other.
 */
export { renderUntrusted, renderUntrustedCorpus, type RenderOptions } from '@sparksocial/shared';

/* ── Authority denial ──────────────────────────────────────────────── */

/**
 * Effects that reach the public, a human, or a bank balance. A turn that ingested
 * untrusted content may not take one of these unattended.
 */
const CONSEQUENTIAL: ReadonlySet<Effect> = new Set<Effect>(['publish', 'spend', 'external', 'destructive']);

export interface ContainmentInput {
  /** True when anything in this turn's context came through `untrusted()`. */
  turnIngestedUntrusted: boolean;
  /** The effect class of the tool the agent is trying to call. */
  effect: Effect;
  toolName: string;
}

export interface ContainmentFlag {
  code: 'untrusted_context_consequential_action';
  detail: string;
}

/**
 * Returns the guardrail flags this call should carry. Feeding these into
 * `invokeTool`'s `runGuardrails` port escalates the call to approval via the
 * existing policy path (`guardrail.flagged`) rather than inventing a second,
 * parallel governance mechanism.
 */
export function containmentFlags(input: ContainmentInput): ContainmentFlag[] {
  if (!input.turnIngestedUntrusted) return [];
  if (!CONSEQUENTIAL.has(input.effect)) return [];

  return [
    {
      code: 'untrusted_context_consequential_action',
      detail:
        `"${input.toolName}" is a ${input.effect} action and this turn read untrusted external ` +
        `content, so it needs a human before it fires. Untrusted content can never authorise a tool call.`,
    },
  ];
}

/** True if any value in the turn's inputs carries the untrusted marker. */
export function turnIngestedUntrusted(values: readonly unknown[]): boolean {
  return values.some((v) => isUntrusted(v));
}
