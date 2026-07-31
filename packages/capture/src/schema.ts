import { z } from 'zod';

/**
 * THE CAPTURE BRIEF — engine spec §6.2.
 *
 * A brief is useless if it is vague:
 *
 *   Bad:  "Post a video of your work today."
 *   Good: "Film 20 seconds of the fade from behind the chair. Vertical. Don't
 *         talk — we'll add captions. Face a window. Keep the clippers in frame
 *         the whole time."
 *
 * Every field below exists because the bad example is missing it. A brief
 * lacking any one of subject / framing / orientation / duration / motion /
 * audio / lighting / do_not is exactly the failure mode this schema rules out
 * by construction — see `validateBrief` in `validate.ts` for the runtime gate.
 */

export const CaptureBrief = z.object({
  brief_id: z.string(),
  playbook_id: z.string(),
  subject: z.string(),
  framing: z.string(),
  orientation: z.enum(['vertical', 'horizontal', 'square']),
  duration_sec: z.number().min(1).max(180),
  motion: z.string(),
  audio: z.string(),
  lighting: z.string(),
  do_not: z.array(z.string()).min(1),
  /**
   * §6.3: a weekly capture session totals ~5 minutes across 3–5 briefs. One
   * brief this long would already blow the budget, which is what bounds it.
   */
  estimated_effort_sec: z.number().min(1).max(90),
  expires_at: z.string().datetime(),
});
export type CaptureBrief = z.infer<typeof CaptureBrief>;

/** What a brief-writer proposes before it is assigned an id/expiry and validated. */
export const DraftCaptureBrief = CaptureBrief.omit({ brief_id: true, expires_at: true });
export type DraftCaptureBrief = z.infer<typeof DraftCaptureBrief>;
