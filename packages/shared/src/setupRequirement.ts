import { z } from 'zod';
import { genomeRequirement } from './genomeRequirements.js';

/**
 * SETUP REQUIREMENTS — a refusal that a person can fix on the spot.
 *
 * Some actions stop because a piece of setup is missing: a post that ends on a
 * call to action the brand never wrote, a publish to a platform nobody
 * connected, a fan-out through a Canva account that is not linked, an avatar
 * with no recorded consent. Each used to throw a sentence ending "…in Settings",
 * and the person had to leave the trend, the draft or the calendar they were
 * working in, find the field, and come back to start over.
 *
 * The tool now also says *what* is missing, in this shape, under
 * `ToolError.meta.requires`. `apps/api/src/app.ts` passes exactly this field to
 * the browser — validated, so nothing else in `meta` leaks — and the web client
 * opens a small dialog to fill it in, then runs the action again.
 *
 * The message stays a full sentence regardless: SPARK's own runtime, the
 * scheduler and the audit log read the message, not this.
 */
export const SetupRequirement = z.discriminatedUnion('kind', [
  /** A genome text field — `offer.primary_cta` today, any `offer.*` / `identity.*` string. */
  z.object({
    kind: z.literal('genome_field'),
    genomeId: z.string().min(1),
    path: z.string().min(1),
    label: z.string(),
    hint: z.string(),
  }),
  /** A publishing account for one platform. */
  z.object({ kind: z.literal('connection'), genomeId: z.string().min(1), platform: z.string().min(1) }),
  /** The brand's own Canva account. */
  z.object({ kind: z.literal('canva'), genomeId: z.string().min(1) }),
  /** Recorded permission to use a real person's likeness or voice. */
  z.object({ kind: z.literal('consent'), consent: z.enum(['avatar_clone', 'voice_clone']) }),
]);
export type SetupRequirement = z.infer<typeof SetupRequirement>;

/** The `genome_field` requirement for a path, with the words a person reads. */
export function genomeFieldRequirement(genomeId: string, path: string): SetupRequirement {
  const { label, hint } = genomeRequirement(path);
  return { kind: 'genome_field', genomeId, path, label, hint };
}

/** `meta.requires`, if it is one — anything malformed is treated as absent. */
export function readSetupRequirement(meta: unknown): SetupRequirement | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const parsed = SetupRequirement.safeParse((meta as { requires?: unknown }).requires);
  return parsed.success ? parsed.data : undefined;
}
