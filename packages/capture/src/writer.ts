import { randomUUID } from 'node:crypto';
import type { Genome } from '@sparksocial/shared';
import { ToolError } from '@sparksocial/shared';
import type { Playbook } from '@sparksocial/playbooks';
import { validateBrief } from './validate.js';
import type { CaptureBrief, DraftCaptureBrief } from './schema.js';

/**
 * Shared brief-generation core, used by both `direct.brief.generate` and
 * `direct.session.batch` so the retry-and-validate logic exists in one place.
 *
 * Injected rather than imported at module scope — same pattern as
 * `genome/bootstrap.ts` — so neither tool depends on which model writes briefs.
 */
export interface BriefWriter {
  /**
   * Propose a brief for one playbook. `feedback` carries the previous attempt's
   * rejection reasons on a retry, so the writer can fix specifically what failed
   * rather than regenerating blind.
   */
  write(args: { playbook: Playbook; genome: Genome; feedback?: string[] }): Promise<DraftCaptureBrief>;
}

/** Master plan §9: corrective retries are capped at 2 before surfacing to the user. */
const MAX_ATTEMPTS = 3;

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // one week — matches the weekly session cadence (§6.3)

/**
 * Write a brief for one playbook and hold it to the §6.2 quality bar before
 * returning it. A brief that never gets there in `MAX_ATTEMPTS` throws rather
 * than shipping something vague — sending "post a video of your work" is worse
 * than not sending anything, because it burns the one weekly ask this business
 * owner will tolerate.
 */
export async function generateValidatedBrief(
  writer: BriefWriter,
  playbook: Playbook,
  genome: Genome,
  now: () => Date = () => new Date(),
): Promise<{ brief: CaptureBrief; attempts: number }> {
  const durationBoundsSec = playbook.output.duration_sec;
  let feedback: string[] | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const draft = await writer.write({ playbook, genome, feedback });
    const result = validateBrief(draft, durationBoundsSec ? { durationBoundsSec } : {});

    if (result.verdict === 'pass') {
      return {
        attempts: attempt,
        brief: {
          ...draft,
          brief_id: randomUUID(),
          expires_at: new Date(now().getTime() + DEFAULT_TTL_MS).toISOString(),
        },
      };
    }
    feedback = result.reasons;
  }

  throw new ToolError(
    'UPSTREAM_FAILED',
    `Could not produce a filmable brief for "${playbook.name}" in ${MAX_ATTEMPTS} attempts: ${feedback!.join('; ')}`,
    { playbookId: playbook.playbook_id, reasons: feedback },
  );
}
