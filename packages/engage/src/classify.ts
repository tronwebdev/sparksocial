import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError, Explanation } from '@sparksocial/shared';
import { EngagementCategory, type EngagementClassifier } from './classifier.js';
import { matchEscalationKeyword } from './escalation.js';

/**
 * `engage.classify` — sorts one inbox message into the feed's tabs
 * (`ENG-02.1`→`.4`: Needs Review / Suggested Replies / Auto-Handled / Sales
 * Opportunities). Invariant 4: this is an agent-visible decision a user
 * sees SPARK make, so the output carries a structured `why`, not just a
 * label.
 */

export const EngageClassifyInput = z.object({
  genomeId: z.string().min(1),
  messageId: z.string().min(1),
});

export const EngageClassifyOutput = z.object({
  messageId: z.string(),
  category: EngagementCategory,
  intentScore: z.number(),
  suggestedReply: z.string().optional(),
  why: Explanation,
});

export interface EngageClassifyDeps {
  classifier: EngagementClassifier;
}

export function makeEngageClassify(deps: EngageClassifyDeps) {
  return defineTool({
    name: 'engage.classify',
    version: 1,

    summary: 'Classify an inbox message into Needs Review / Suggested Replies / Auto-Handled / Sales Opportunity, with a suggested reply where safe.',

    input: EngageClassifyInput,
    output: EngageClassifyOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    // Re-classifying the same message is a refresh, not a new decision —
    // same reasoning `analytics.sync` gives for its own upsert.
    idempotent: true,
    // One Claude call per message. An inbox is high-volume by nature, so this
    // is the line item most likely to surprise someone at the end of a month.
    estimateCents: () => 1,

    async handler(input, ctx) {
      if (ctx.genomeId && input.genomeId !== ctx.genomeId) {
        throw new ToolError('ISOLATION_VIOLATION', 'That genome is not the one selected.', {
          claimed: input.genomeId,
          selected: ctx.genomeId,
        });
      }

      const message = await ctx.db.engagement.get(input.messageId, input.genomeId, ctx.orgId);
      if (!message) {
        throw new ToolError('NOT_FOUND', 'No inbox message with that id in this genome.');
      }

      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      if (!genome) {
        throw new ToolError('NOT_FOUND', 'No genome with that id in this org.');
      }

      const result = await deps.classifier.classify({
        genome,
        kind: message.kind,
        authorHandle: message.authorHandle,
        text: message.text,
      });

      /**
       * `Settings WS EI Sales`'s escalation list overrides the classifier.
       *
       * Deterministic and after the fact, on purpose — see `escalation.ts`. The
       * classifier still runs, so the intent score and its reasoning survive for
       * whoever triages the message; only the routing changes. A brand with no
       * list configured is unaffected, which is why the check is a no-op rather
       * than a branch around the whole handler.
       */
      const brand = ctx.brandId ? await ctx.db.brands.get(ctx.brandId, ctx.orgId) : undefined;
      const escalated = matchEscalationKeyword(message.text, brand?.salesEscalationKeywords);
      const category = escalated ? 'needs_review' : result.category;

      const why = {
        summary: escalated
          ? `Escalated to a person: this message contains "${escalated}", which this brand always escalates. ` +
            `The classifier read it as ${result.category} — ${result.reason}`
          : result.reason,
        factors: [
          ...(escalated ? [{ label: `Escalation keyword "${escalated}"`, weight: 1 }] : []),
          { label: `Classified as ${result.category}`, weight: result.intentScore },
        ],
        evidence: [{ kind: 'metric' as const, id: message.id, note: message.text.slice(0, 200) }],
        alternatives: escalated
          ? [
              {
                option: result.category,
                rejectedBecause:
                  'A sensitive keyword on this brand’s escalation list always sends the message to a person.',
              },
            ]
          : [],
      };

      const updated = await ctx.db.engagement.classify({
        id: input.messageId,
        genomeId: input.genomeId,
        orgId: ctx.orgId,
        category,
        intentScore: result.intentScore,
        /**
         * No suggested reply on an escalated message. Offering one next to "a
         * person must handle this" invites exactly the one-click send the
         * escalation exists to prevent.
         */
        ...(result.suggestedReply && !escalated ? { suggestedReply: result.suggestedReply } : {}),
        why,
      });

      if (!updated) {
        throw new ToolError('NOT_FOUND', 'No inbox message with that id in this genome.');
      }

      return {
        messageId: updated.id,
        category,
        intentScore: result.intentScore,
        ...(updated.suggestedReply ? { suggestedReply: updated.suggestedReply } : {}),
        why,
      };
    },
  });
}
