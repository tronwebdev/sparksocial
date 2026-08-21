import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import type { ResolvedBeat } from '@sparksocial/generate';
import { dimensionsFor, framesFor, zipTimeline, resolveKit, DEFAULT_GROUND, DEFAULT_TYPE } from '../src/timeline.js';

const playbookBeats = [
  { id: 'hook', duration_sec: 3 },
  { id: 'demo', duration_sec: 10 },
  { id: 'cta', duration_sec: 4 },
];

describe('zipTimeline', () => {
  it('joins an asset-kind beat to its Asset Graph url/mediaType and the playbook duration', () => {
    const resolvedBeats: ResolvedBeat[] = [
      { kind: 'asset', beatId: 'demo', assetId: 'a1', role: 'product_screen', caption: 'the scheduler view' },
    ];
    const [beat] = zipTimeline({
      resolvedBeats,
      playbookBeats,
      assetInfo: { a1: { url: 'https://blob/a1.mp4', mediaType: 'video' } },
    });

    expect(beat).toEqual({ kind: 'video', beatId: 'demo', durationSec: 10, url: 'https://blob/a1.mp4', caption: 'the scheduler view' });
  });

  it('treats an image-mediaType asset beat as an image kind, and drops caption when the beat has none', () => {
    const resolvedBeats: ResolvedBeat[] = [{ kind: 'asset', beatId: 'hook', assetId: 'a2', role: 'work_artifact', caption: null }];
    const [beat] = zipTimeline({
      resolvedBeats,
      playbookBeats,
      assetInfo: { a2: { url: 'https://blob/a2.jpg', mediaType: 'image' } },
    });

    expect(beat).toEqual({ kind: 'image', beatId: 'hook', durationSec: 3, url: 'https://blob/a2.jpg' });
  });

  it('passes a text-kind beat through with its written copy', () => {
    const resolvedBeats: ResolvedBeat[] = [{ kind: 'text', beatId: 'cta', text: 'Start your free trial today.' }];
    const [beat] = zipTimeline({ resolvedBeats, playbookBeats, assetInfo: {} });
    expect(beat).toEqual({ kind: 'text', beatId: 'cta', durationSec: 4, text: 'Start your free trial today.' });
  });

  it('maps generated_image/generated_video/generated_audio beats to image/video/audio kinds', () => {
    const resolvedBeats: ResolvedBeat[] = [
      { kind: 'generated_image', beatId: 'hook', url: 'https://gen/hook.png', prompt: 'a workshop' },
      { kind: 'generated_video', beatId: 'demo', url: 'https://gen/demo.mp4', script: 'here is the workflow' },
      { kind: 'generated_audio', beatId: 'cta', url: 'https://gen/cta.mp3', script: 'call to action voiceover' },
    ];
    const timeline = zipTimeline({ resolvedBeats, playbookBeats, assetInfo: {} });

    expect(timeline).toEqual([
      { kind: 'image', beatId: 'hook', durationSec: 3, url: 'https://gen/hook.png' },
      { kind: 'video', beatId: 'demo', durationSec: 10, url: 'https://gen/demo.mp4' },
      { kind: 'audio', beatId: 'cta', durationSec: 4, url: 'https://gen/cta.mp3' },
    ]);
  });

  it('maps a generated_broll beat to a video kind, same as generated_video', () => {
    const resolvedBeats: ResolvedBeat[] = [
      { kind: 'generated_broll', beatId: 'demo', url: 'https://gen/broll.mp4', prompt: 'a factory floor at dawn' },
    ];
    const [beat] = zipTimeline({ resolvedBeats, playbookBeats, assetInfo: {} });
    expect(beat).toEqual({ kind: 'video', beatId: 'demo', durationSec: 10, url: 'https://gen/broll.mp4' });
  });

  it('maps a dubbed_media beat to its own mediaType (video or audio), same beatId as the original', () => {
    const resolvedBeats: ResolvedBeat[] = [
      { kind: 'dubbed_media', beatId: 'demo', url: 'https://gen/demo-es.mp4', targetLanguage: 'es', mediaType: 'video' },
    ];
    const [beat] = zipTimeline({ resolvedBeats, playbookBeats, assetInfo: {} });
    expect(beat).toEqual({ kind: 'video', beatId: 'demo', durationSec: 10, url: 'https://gen/demo-es.mp4' });
  });

  it('throws when a resolved beat no longer exists in the playbook (drift between the draft and the playbook record)', () => {
    const resolvedBeats: ResolvedBeat[] = [{ kind: 'text', beatId: 'gone', text: 'x' }];
    expect(() => zipTimeline({ resolvedBeats, playbookBeats, assetInfo: {} })).toThrow(ToolError);
  });

  it('throws when an asset-kind beat references an asset no longer in the Asset Graph', () => {
    const resolvedBeats: ResolvedBeat[] = [{ kind: 'asset', beatId: 'hook', assetId: 'gone', role: 'product_screen', caption: null }];
    expect(() => zipTimeline({ resolvedBeats, playbookBeats, assetInfo: {} })).toThrow(ToolError);
  });

  it('throws rather than silently rendering an audio asset as a visual beat', () => {
    const resolvedBeats: ResolvedBeat[] = [{ kind: 'asset', beatId: 'hook', assetId: 'a3', role: 'product_screen', caption: null }];
    expect(() =>
      zipTimeline({ resolvedBeats, playbookBeats, assetInfo: { a3: { url: 'https://blob/a3.mp3', mediaType: 'audio' } } }),
    ).toThrow(ToolError);
  });
});

describe('dimensionsFor', () => {
  it('resolves every aspect ratio the playbook library actually declares', () => {
    expect(dimensionsFor('9:16')).toEqual({ width: 1080, height: 1920 });
    expect(dimensionsFor('16:9')).toEqual({ width: 1920, height: 1080 });
    expect(dimensionsFor('1:1')).toEqual({ width: 1080, height: 1080 });
    expect(dimensionsFor('4:5')).toEqual({ width: 1080, height: 1350 });
  });

  it('throws on an aspect ratio with no defined export dimensions', () => {
    expect(() => dimensionsFor('n/a')).toThrow(ToolError);
  });
});

describe('framesFor', () => {
  it('rounds total beat duration to frames at the given fps', () => {
    expect(framesFor([{ durationSec: 3 }, { durationSec: 10 }, { durationSec: 4 }], 30)).toBe(510);
  });

  it('never returns fewer than 1 frame, even for a zero-duration beat list', () => {
    expect(framesFor([], 30)).toBe(1);
  });
});

describe('resolveKit — §8.6\'s brand kit', () => {
  it('reads the palette positionally: ground, type, accent', () => {
    const out = resolveKit({ colors: ['#101820', '#F2AA4C', '#00A3AD'] });
    expect(out).toMatchObject({ ground: '#101820', type: '#F2AA4C', accent: '#00A3AD' });
  });

  it('keeps the default type colour when the brand named only one', () => {
    // Deriving a readable type colour from an arbitrary ground is a real
    // algorithm, and a wrong guess is white on cream — worse than the default
    // and silently so.
    const out = resolveKit({ colors: ['#F5F0E6'] });
    expect(out.ground).toBe('#F5F0E6');
    expect(out.type).toBe(DEFAULT_TYPE);
  });

  it('falls back entirely with no kit at all', () => {
    expect(resolveKit(undefined)).toEqual({ ground: DEFAULT_GROUND, type: DEFAULT_TYPE });
  });

  it('ignores colours past the third rather than blending them', () => {
    const out = resolveKit({ colors: ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff'] });
    expect(out.accent).toBe('#ff0000');
    expect(Object.values(out)).not.toContain('#00ff00');
  });

  it('omits the logo rather than reporting an empty string', () => {
    expect(resolveKit({ colors: [] }).logoUrl).toBeUndefined();
    expect(resolveKit({ colors: [], logoUrl: 'https://cdn/logo.png' }).logoUrl).toBe('https://cdn/logo.png');
  });
});
