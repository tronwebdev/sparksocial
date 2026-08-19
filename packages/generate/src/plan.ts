import { ToolError } from '@sparksocial/shared';
import type { Genome } from '@sparksocial/shared/genome';
import type { Playbook } from '@sparksocial/playbooks';
import { parseBeatSource, readGenomePath, type PlannedBeat, type RenderPlan } from '@sparksocial/assemble';

/**
 * Beat resolution for `synthesize`-mode playbooks — `buildRenderPlan`'s
 * counterpart in `@sparksocial/assemble`, which explicitly refuses anything
 * but `assemble` mode (`plan.mode !== 'assemble'` throws there, on purpose:
 * "Synthesize and Direct+Finish reach `compose.render` by different routes").
 * This is that different route for synthesize.
 *
 * No asset retrieval, because no synthesize playbook's beats reference one —
 * every synthesize playbook's `preconditions.required_asset_roles` is
 * `['brand_kit']` at `min_assets: 0`, i.e. optional context, not a beat
 * source. A synthesize beat is either a `genome:` literal or a `prompt_ref`
 * for the text writer to fill; an `asset:` source reaching here means a
 * playbook record is wrong, not that this function should learn to retrieve.
 */
export function buildSynthesizePlan(playbook: Playbook, genome: Genome): RenderPlan {
  if (playbook.mode !== 'synthesize') {
    throw new ToolError('INVALID_INPUT', `${playbook.playbook_id} is a ${playbook.mode} playbook, not synthesize.`, {
      playbookId: playbook.playbook_id,
      mode: playbook.mode,
    });
  }

  const beats: PlannedBeat[] = playbook.structure.beats.map((beat) => {
    if (beat.source) {
      const source = parseBeatSource(beat.source);

      if (source.kind === 'asset') {
        throw new ToolError(
          'INVALID_INPUT',
          `Beat "${beat.id}" of synthesize playbook "${playbook.playbook_id}" sources an asset — ` +
            'synthesize mode has no retrieval step. This is a playbook data error, not an input error.',
          { playbookId: playbook.playbook_id, beatId: beat.id },
        );
      }

      const text = readGenomePath(genome, source.path);
      if (!text) {
        throw new ToolError('NOT_FOUND', `The genome has no value at "${source.path}".`, {
          genomePath: source.path,
          beatId: beat.id,
        });
      }
      return { kind: 'text', beatId: beat.id, durationSec: beat.duration_sec, text, genomePath: source.path };
    }

    if (beat.prompt_ref) {
      return { kind: 'copy', beatId: beat.id, durationSec: beat.duration_sec, promptRef: beat.prompt_ref };
    }

    throw new ToolError('INVALID_INPUT', `Beat "${beat.id}" has neither a source nor a prompt_ref.`, {
      beatId: beat.id,
    });
  });

  const totalDurationSec = round1(beats.reduce((sum, b) => sum + b.durationSec, 0));

  return {
    playbookId: playbook.playbook_id,
    genomeId: genome.genome_id,
    mediaType: playbook.output.media_type,
    aspectRatios: [...playbook.output.aspect_ratios],
    beats,
    totalDurationSec,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
