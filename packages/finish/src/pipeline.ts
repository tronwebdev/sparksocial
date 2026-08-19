import {
  captionBurnFilter,
  exportAllAspects,
  hookOverlayFilter,
  musicBedFilter,
  srtFromCues,
  stabilizeDetectFilter,
  stabilizeTransformFilter,
  trimFilter,
  type AspectRatio,
  type CaptionCue,
  type ExportPlan,
  type HookOverlaySpec,
  type MusicBedSpec,
} from './ffmpeg.js';

/**
 * PIPELINE ORCHESTRATION — engine spec §6.3's stage order, made explicit and
 * testable: *"auto-trim dead space, stabilize, caption burn-in, hook overlay,
 * licensed audio bed, export 9:16 / 1:1 / 16:9."*
 *
 * This module decides **which stages run, in what order, with what
 * parameters** — it does not execute ffmpeg (see `FfmpegRunner` in `ingest.ts`
 * for that seam). Keeping the ordering logic pure and separate from execution
 * means a wrong stage order is a unit-test failure, not a bug discovered by
 * watching a rendered clip come out wrong.
 */

export interface FinishStage {
  name: 'trim' | 'stabilize_detect' | 'stabilize_transform' | 'caption_burn' | 'hook_overlay' | 'music_bed';
  filter: string;
}

export interface FinishPlan {
  stages: FinishStage[];
  exports: ExportPlan[];
  srtContent: string;
}

export interface BuildFinishPipelineArgs {
  trim: { startSec: number; endSec: number };
  sourceWidth: number;
  sourceHeight: number;
  captions: CaptionCue[];
  hook: HookOverlaySpec;
  /** Omit to ship without a music bed — not every clip needs one (§6.3 doesn't mandate it). */
  music?: MusicBedSpec;
  aspects: AspectRatio[];
  /** Working paths the runner will read/write — this module only references them. */
  transformsPath: string;
  srtPath: string;
}

export function buildFinishPipeline(args: BuildFinishPipelineArgs): FinishPlan {
  if (args.aspects.length === 0) {
    throw new Error('buildFinishPipeline: at least one export aspect ratio is required.');
  }

  const srtContent = srtFromCues(args.captions);

  const stages: FinishStage[] = [
    { name: 'trim', filter: trimFilter(args.trim.startSec, args.trim.endSec) },
    { name: 'stabilize_detect', filter: stabilizeDetectFilter(args.transformsPath) },
    { name: 'stabilize_transform', filter: stabilizeTransformFilter(args.transformsPath) },
  ];

  // Captions are optional — a craft-capture clip that's deliberately silent
  // (§6.2's "don't talk, we'll add captions" briefs) may still have none if
  // there's nothing to transcribe.
  if (args.captions.length > 0) {
    stages.push({ name: 'caption_burn', filter: captionBurnFilter(args.srtPath) });
  }

  // The hook overlay is not optional: every format recipe in the playbook
  // library opens on a hook (§5.1's `structure.beats[0]`), and Finish is what
  // puts it in brand typography over raw footage that has none.
  stages.push({ name: 'hook_overlay', filter: hookOverlayFilter(args.hook) });

  if (args.music) {
    stages.push({ name: 'music_bed', filter: musicBedFilter(args.music) });
  }

  const exports = exportAllAspects(args.sourceWidth, args.sourceHeight, args.aspects);

  return { stages, exports, srtContent };
}
