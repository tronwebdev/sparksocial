import { describe, expect, it } from 'vitest';
import { buildFinishPipeline } from '../src/pipeline.js';

const baseArgs = {
  trim: { startSec: 2, endSec: 22 },
  sourceWidth: 1920,
  sourceHeight: 1080,
  captions: [{ text: 'Watch this.', startSec: 0, endSec: 2 }],
  hook: { text: 'This used to take 4 hours', fontFile: 'Inter-Bold.ttf', colorHex: '#FFFFFF' },
  aspects: ['9:16', '1:1'] as ('9:16' | '1:1')[],
  transformsPath: 'clip.trf',
  srtPath: 'clip.srt',
};

describe('buildFinishPipeline', () => {
  it('orders stages exactly per §6.3: trim, stabilize (detect, transform), captions, hook, then music if present', () => {
    const plan = buildFinishPipeline({ ...baseArgs, music: { trackPath: 'bed.mp3', volumeDb: -18 } });
    expect(plan.stages.map((s) => s.name)).toEqual([
      'trim',
      'stabilize_detect',
      'stabilize_transform',
      'caption_burn',
      'hook_overlay',
      'music_bed',
    ]);
  });

  it('omits caption_burn when there are no cues, without disturbing the rest of the order', () => {
    const plan = buildFinishPipeline({ ...baseArgs, captions: [] });
    expect(plan.stages.map((s) => s.name)).toEqual(['trim', 'stabilize_detect', 'stabilize_transform', 'hook_overlay']);
  });

  it('omits music_bed when no track is supplied', () => {
    const plan = buildFinishPipeline(baseArgs);
    expect(plan.stages.some((s) => s.name === 'music_bed')).toBe(false);
  });

  it('the hook overlay is never optional, even with no captions and no music', () => {
    const plan = buildFinishPipeline({ ...baseArgs, captions: [] });
    expect(plan.stages.some((s) => s.name === 'hook_overlay')).toBe(true);
  });

  it('produces one export plan per requested aspect', () => {
    const plan = buildFinishPipeline(baseArgs);
    expect(plan.exports.map((e) => e.aspect)).toEqual(['9:16', '1:1']);
  });

  it('rejects an empty aspect list rather than silently producing nothing', () => {
    expect(() => buildFinishPipeline({ ...baseArgs, aspects: [] })).toThrow();
  });

  it('the trim filter reflects the requested cut points', () => {
    const plan = buildFinishPipeline(baseArgs);
    expect(plan.stages[0]!.filter).toContain('start=2:end=22');
  });

  it('generates matching SRT content when captions are present', () => {
    const plan = buildFinishPipeline(baseArgs);
    expect(plan.srtContent).toContain('Watch this.');
  });

  it('the stabilize detect and transform stages reference the same transforms path', () => {
    const plan = buildFinishPipeline(baseArgs);
    const detect = plan.stages.find((s) => s.name === 'stabilize_detect')!;
    const transform = plan.stages.find((s) => s.name === 'stabilize_transform')!;
    expect(detect.filter).toContain('clip.trf');
    expect(transform.filter).toContain('clip.trf');
  });
});
