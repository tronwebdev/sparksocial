import { describe, expect, it } from 'vitest';
import {
  captionBurnFilter,
  exportAllAspects,
  exportAspectFilter,
  hookOverlayFilter,
  musicBedFilter,
  srtFromCues,
  stabilizeDetectFilter,
  stabilizeTransformFilter,
  trimFilter,
} from '../src/ffmpeg.js';

describe('trimFilter', () => {
  it('builds a trim + timeline-reset filter', () => {
    expect(trimFilter(2, 22)).toBe('trim=start=2:end=22,setpts=PTS-STARTPTS');
  });

  it('rejects an end at or before the start', () => {
    expect(() => trimFilter(10, 10)).toThrow();
    expect(() => trimFilter(10, 5)).toThrow();
  });
});

describe('stabilize (two-pass)', () => {
  it('detect pass writes the transforms file the transform pass reads', () => {
    const detect = stabilizeDetectFilter('clip.trf');
    const transform = stabilizeTransformFilter('clip.trf');
    expect(detect).toContain('result=clip.trf');
    expect(transform).toContain('input=clip.trf');
  });
});

describe('captions', () => {
  it('formats an SRT block with 1-based cue numbers and comma-millisecond timestamps', () => {
    const srt = srtFromCues([
      { text: 'Watch this.', startSec: 0, endSec: 1.5 },
      { text: 'That fast.', startSec: 1.5, endSec: 3 },
    ]);
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:01,500\nWatch this.');
    expect(srt).toContain('2\n00:00:01,500 --> 00:00:03,000\nThat fast.');
  });

  it('formats hours correctly for a long clip', () => {
    const srt = srtFromCues([{ text: 'x', startSec: 3661.25, endSec: 3662 }]);
    expect(srt).toContain('01:01:01,250 -->');
  });

  it('references the srt path in the burn-in filter', () => {
    expect(captionBurnFilter('captions_en.srt')).toContain('subtitles=captions_en.srt');
  });
});

describe('hookOverlayFilter', () => {
  it('centers the text, uses the brand font/color, and times a 3s default window', () => {
    const filter = hookOverlayFilter({ text: 'This used to take 4 hours', fontFile: 'Inter-Bold.ttf', colorHex: '#FFFFFF' });
    expect(filter).toContain("fontfile='Inter-Bold.ttf'");
    expect(filter).toContain('fontcolor=0xFFFFFF');
    expect(filter).toContain("enable='between(t,0,3)'");
  });

  it('honours a custom duration', () => {
    expect(hookOverlayFilter({ text: 'Hi', fontFile: 'f.ttf', colorHex: '#000000', durationSec: 5 })).toContain(
      "between(t,0,5)",
    );
  });

  it('escapes quotes and colons in the hook text so the filter string stays valid', () => {
    const filter = hookOverlayFilter({ text: "Don't: try this", fontFile: 'f.ttf', colorHex: '#000000' });
    expect(filter).toContain("Don\\'t\\: try this");
  });

  it('rejects a malformed color', () => {
    expect(() => hookOverlayFilter({ text: 'x', fontFile: 'f.ttf', colorHex: 'not-a-color' })).toThrow();
  });
});

describe('musicBedFilter', () => {
  it('ducks the bed under dialogue with a 3:1 weight and applies the requested dB', () => {
    const filter = musicBedFilter({ trackPath: 'bed.mp3', volumeDb: -18 });
    expect(filter).toContain("weights='3 1'");
    expect(filter).toContain('volume=-18dB');
  });
});

describe('exportAspectFilter', () => {
  it('crops the sides off a 16:9 source to make 9:16, then scales to canonical resolution', () => {
    const plan = exportAspectFilter('9:16', 1920, 1080);
    expect(plan.width).toBe(1080);
    expect(plan.height).toBe(1920);
    // Crop height stays full (1080); crop width narrows to 1080*9/16 = 607.5 -> 608.
    expect(plan.filter).toMatch(/crop=608:1080:656:0/);
  });

  it('crops top/bottom off a 9:16 source to make 16:9', () => {
    const plan = exportAspectFilter('16:9', 1080, 1920);
    expect(plan.width).toBe(1920);
    expect(plan.height).toBe(1080);
    expect(plan.filter).toMatch(/crop=1080:608(?:\.\d+)?:0:\d+/);
  });

  it('makes a square export center-cropped from a landscape source', () => {
    const plan = exportAspectFilter('1:1', 1920, 1080);
    expect(plan.filter).toContain('crop=1080:1080:420:0');
  });

  it('does not crop a source that already matches the target aspect', () => {
    const plan = exportAspectFilter('16:9', 1920, 1080);
    // 1920x1080 IS 16:9 already — crop box should equal the full frame.
    expect(plan.filter).toContain('crop=1920:1080:0:0');
  });

  it('always scales with a named resampling flag, never a bare scale', () => {
    expect(exportAspectFilter('9:16', 1920, 1080).filter).toContain('flags=lanczos');
  });
});

describe('exportAllAspects', () => {
  it('returns one plan per requested aspect, in the order requested', () => {
    const plans = exportAllAspects(1920, 1080, ['1:1', '9:16']);
    expect(plans.map((p) => p.aspect)).toEqual(['1:1', '9:16']);
  });
});
