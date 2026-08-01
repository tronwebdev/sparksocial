import { z } from 'zod';

/**
 * The shape any tool must produce to have its output run through the guardrail
 * layer. `guard.evaluate_draft` (`tool.ts`) is the reference caller; a future
 * `draft.copy.write`/`publish.now` would carry this same shape in its own
 * output.
 */
export const GuardrailableDraft = z.object({
  genomeId: z.string(),
  playbookId: z.string(),
  platform: z.string(),
  text: z.string(),
  referencedAssetIds: z.array(z.string()).default([]),
});
export type GuardrailableDraft = z.infer<typeof GuardrailableDraft>;
