import { ToolError } from '@sparksocial/shared';
import type { ResolvedBeat } from '@sparksocial/generate';

/**
 * `content.draft`'s `ResolvedBeat[]` (persisted on `content_items.copy`) knows
 * *what* each beat is — an asset reference, written text, a generated image/
 * video/audio URL — but not *how long* it plays; duration lives on the
 * playbook record, not the draft. This module re-joins the two by `beatId`,
 * the same "derive, don't duplicate" rule `assemble/src/plan.ts` already
 * follows for beat resolution.
 *
 * The other join `compose.render` needs: an `asset`-kind beat carries only an
 * `assetId`, not a URL — the Asset Graph's own storage location. That comes
 * from `ctx.db.assets.info()`, passed in already resolved so this module stays
 * pure and testable without a store.
 */

export type TimedBeat =
  | { kind: 'image'; beatId: string; durationSec: number; url: string; caption?: string }
  | { kind: 'video'; beatId: string; durationSec: number; url: string; caption?: string }
  | { kind: 'text'; beatId: string; durationSec: number; text: string }
  /** A narration track meant to underlay the composition, not its own visual slot — see the module comment on `generated_audio`. */
  | { kind: 'audio'; beatId: string; durationSec: number; url: string };

export interface AssetLookup {
  url: string;
  mediaType: string;
}

export function zipTimeline(args: {
  resolvedBeats: ResolvedBeat[];
  playbookBeats: Array<{ id: string; duration_sec: number }>;
  assetInfo: Record<string, AssetLookup>;
}): TimedBeat[] {
  const durationByBeatId = new Map(args.playbookBeats.map((b) => [b.id, b.duration_sec]));

  return args.resolvedBeats.map((beat): TimedBeat => {
    const durationSec = durationByBeatId.get(beat.beatId);
    if (durationSec === undefined) {
      // The draft and the playbook have drifted — e.g. the playbook record
      // changed after this draft was written. Not something to guess a
      // duration for.
      throw new ToolError('INVALID_INPUT', `Beat "${beat.beatId}" is not in this playbook's current beat list.`, {
        beatId: beat.beatId,
      });
    }

    if (beat.kind === 'text') {
      return { kind: 'text', beatId: beat.beatId, durationSec, text: beat.text };
    }

    if (beat.kind === 'generated_image') {
      return { kind: 'image', beatId: beat.beatId, durationSec, url: beat.url };
    }

    if (beat.kind === 'generated_video' || beat.kind === 'generated_broll') {
      return { kind: 'video', beatId: beat.beatId, durationSec, url: beat.url };
    }

    if (beat.kind === 'generated_audio') {
      return { kind: 'audio', beatId: beat.beatId, durationSec, url: beat.url };
    }

    if (beat.kind === 'dubbed_media') {
      return { kind: beat.mediaType, beatId: beat.beatId, durationSec, url: beat.url };
    }

    // kind === 'asset'
    const info = args.assetInfo[beat.assetId];
    if (!info) {
      throw new ToolError('NOT_FOUND', `Asset "${beat.assetId}" for beat "${beat.beatId}" is gone from the Asset Graph.`, {
        beatId: beat.beatId,
        assetId: beat.assetId,
      });
    }
    if (info.mediaType === 'audio') {
      throw new ToolError('INVALID_INPUT', `Beat "${beat.beatId}" points at an audio asset — beats render visually.`, {
        beatId: beat.beatId,
        assetId: beat.assetId,
      });
    }
    return {
      kind: info.mediaType === 'video' ? 'video' : 'image',
      beatId: beat.beatId,
      durationSec,
      url: info.url,
      ...(beat.caption ? { caption: beat.caption } : {}),
    };
  });
}

/** Standard export dimensions per aspect ratio — Remotion needs literal pixels, not a ratio string. */
export const ASPECT_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};

export function dimensionsFor(aspect: string): { width: number; height: number } {
  const dims = ASPECT_DIMENSIONS[aspect];
  if (!dims) {
    throw new ToolError('INVALID_INPUT', `No export dimensions defined for aspect ratio "${aspect}".`, { aspect });
  }
  return dims;
}

const FPS = 30;

/** Total frames for a beat list at the render fps — the composition's duration and, for a still (`image`/`carousel` media type), which single frame to render (0). */
export function framesFor(beats: Array<{ durationSec: number }>, fps = FPS): number {
  return Math.max(1, Math.round(beats.reduce((sum, b) => sum + b.durationSec, 0) * fps));
}
