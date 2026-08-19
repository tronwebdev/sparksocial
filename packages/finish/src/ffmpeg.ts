/**
 * FFMPEG FILTERGRAPH BUILDERS — engine spec §6.3:
 *
 *   *"Raw phone footage → publishable post. Auto-trim dead space, stabilize,
 *   caption burn-in (with locale-correct language), hook overlay in brand kit
 *   typography, licensed audio bed, export 9:16 / 1:1 / 16:9."*
 *
 * Each function here builds one stage of the filtergraph as a **string**, not
 * an executed command — running ffmpeg is I/O and belongs behind the injected
 * `FfmpegRunner` in `pipeline.ts` (same seam as `crawl()`/`inferGenome()`).
 * What's real and testable here is the actual filter construction: the
 * two-pass stabilize sequence, the crop/scale/pad math for a 9:16 export from
 * a 16:9 source, and the timing on a hook overlay. This is the part of a
 * Finish pipeline that is genuinely engineering, not orchestration — an ffmpeg
 * binary shelled out to with the wrong crop math is worse than not finishing
 * the clip at all.
 */

export interface CaptionCue {
  text: string;
  startSec: number;
  endSec: number;
}

export interface HookOverlaySpec {
  text: string;
  fontFile: string;
  colorHex: string;
  /** Seconds the hook stays on screen from the start of the clip. */
  durationSec?: number;
}

export interface MusicBedSpec {
  trackPath: string;
  /** Negative dB — music sits under dialogue/ambient, never over it. */
  volumeDb: number;
}

export type AspectRatio = '9:16' | '1:1' | '16:9';

const ASPECT_DIMENSIONS: Record<AspectRatio, { w: number; h: number }> = {
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 },
  '16:9': { w: 1920, h: 1080 },
};

/* ── Trim ──────────────────────────────────────────────────────────── */

export function trimFilter(startSec: number, endSec: number): string {
  if (endSec <= startSec) {
    throw new Error(`trim end (${endSec}s) must be after start (${startSec}s)`);
  }
  // setpts resets the timeline to 0 after the cut, so every later filter
  // (captions, hook overlay) can be timed from the clip's own start.
  return `trim=start=${startSec}:end=${endSec},setpts=PTS-STARTPTS`;
}

/* ── Stabilize (two-pass: detect, then transform) ─────────────────── */

/**
 * vidstab is inherently two-pass: the detect pass writes a transforms file
 * that the transform pass reads. Modeling it as two stages rather than one
 * filter is what makes the pipeline order in `pipeline.ts` match how this
 * would actually run — collapsing it to one call would be a lie about how
 * ffmpeg's stabilization filters work.
 */
export function stabilizeDetectFilter(transformsPath: string): string {
  return `vidstabdetect=shakiness=5:accuracy=15:result=${transformsPath}`;
}

export function stabilizeTransformFilter(transformsPath: string): string {
  return `vidstabtransform=smoothing=10:input=${transformsPath}:zoom=0:optzoom=1`;
}

/* ── Caption burn-in ───────────────────────────────────────────────── */

/** SRT is generated as plain content here — writing it to disk is the runner's job. */
export function srtFromCues(cues: CaptionCue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${srtTimestamp(c.startSec)} --> ${srtTimestamp(c.endSec)}\n${c.text}\n`)
    .join('\n');
}

function srtTimestamp(totalSec: number): string {
  const ms = Math.round((totalSec % 1) * 1000);
  const s = Math.floor(totalSec) % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

/**
 * `locale` is burned into the filter reference only for traceability in
 * generated ffmpeg commands (`captions_en.srt` vs `captions_pt-BR.srt`) —
 * the actual locale-correct translation of `cues[].text` happens upstream,
 * before this function ever sees them.
 */
export function captionBurnFilter(srtPath: string): string {
  return `subtitles=${srtPath}:force_style='Alignment=2,MarginV=80,FontSize=20,BorderStyle=3,Outline=1,Shadow=0'`;
}

/* ── Hook overlay (brand kit typography) ─────────────────────────── */

export function hookOverlayFilter(spec: HookOverlaySpec): string {
  const escaped = spec.text.replace(/([\\':])/g, '\\$1');
  const duration = spec.durationSec ?? 3;
  return (
    `drawtext=text='${escaped}':fontfile='${spec.fontFile}':fontcolor=${normalizeHex(spec.colorHex)}` +
    `:fontsize=64:x=(w-text_w)/2:y=h*0.12:box=1:boxcolor=black@0.35:boxborderw=16` +
    `:enable='between(t,0,${duration})'`
  );
}

function normalizeHex(hex: string): string {
  const h = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`hook overlay colorHex "${hex}" is not a 6-digit hex color`);
  return `0x${h}`;
}

/* ── Music bed ─────────────────────────────────────────────────────── */

export function musicBedFilter(spec: MusicBedSpec): string {
  // amix with dialogue given full presence (weight 3) and the bed heavily
  // ducked (weight 1) — a licensed track under a barbershop's ambient sound
  // is atmosphere, never the point of the clip.
  return `[0:a][1:a]amix=inputs=2:duration=first:weights='3 1',volume=${spec.volumeDb}dB`;
}

/* ── Aspect export ─────────────────────────────────────────────────── */

export interface ExportPlan {
  aspect: AspectRatio;
  width: number;
  height: number;
  filter: string;
}

/**
 * Crop-to-fill then scale to the target aspect's canonical resolution. Center
 * crop, never letterbox — a padded 9:16 export from 16:9 source footage reads
 * as an obviously-repurposed clip, and center-crop is what every export in
 * the format library (§5.3) actually expects to receive.
 */
export function exportAspectFilter(aspect: AspectRatio, sourceWidth: number, sourceHeight: number): ExportPlan {
  const { w: targetW, h: targetH } = ASPECT_DIMENSIONS[aspect];
  const targetRatio = targetW / targetH;
  const sourceRatio = sourceWidth / sourceHeight;

  let cropW = sourceWidth;
  let cropH = sourceHeight;
  if (sourceRatio > targetRatio) {
    // Source is wider than target — crop the sides.
    cropW = Math.round(sourceHeight * targetRatio);
  } else if (sourceRatio < targetRatio) {
    // Source is taller/narrower than target — crop top and bottom.
    cropH = Math.round(sourceWidth / targetRatio);
  }
  const x = Math.round((sourceWidth - cropW) / 2);
  const y = Math.round((sourceHeight - cropH) / 2);

  return {
    aspect,
    width: targetW,
    height: targetH,
    filter: `crop=${cropW}:${cropH}:${x}:${y},scale=${targetW}:${targetH}:flags=lanczos`,
  };
}

export function exportAllAspects(sourceWidth: number, sourceHeight: number, aspects: AspectRatio[]): ExportPlan[] {
  return aspects.map((a) => exportAspectFilter(a, sourceWidth, sourceHeight));
}
