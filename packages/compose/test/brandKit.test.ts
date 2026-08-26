import { describe, expect, it } from 'vitest';
import { DEFAULT_WATERMARK } from '@sparksocial/shared/brandKit';
import { resolveKit, zipTimeline } from '../src/timeline.js';
import type { ResolvedBeat } from '@sparksocial/generate';

/**
 * The watermark and the lower-third — `SET-WS-BRAND-KITS`, at the layer that
 * decides what a frame actually shows.
 *
 * The watermark half is the one worth guarding hardest. Before it existed, both
 * renderers stamped the logo onto every frame whenever `brands.logo_url` was
 * set; the toggle the Brand Kits screen draws had nothing behind it. A
 * regression here does not throw and does not fail a render — it silently puts a
 * mark on (or takes one off) every post a brand publishes, which is the kind of
 * change nobody notices until a customer does.
 */

describe('resolveKit — watermark', () => {
  it('defaults to the behaviour every brand rendered with before the column existed', () => {
    // The important assertion in the whole file: absent must mean "as before",
    // not "off". A default of off would silently drop the mark from every
    // existing brand's output on deploy.
    expect(resolveKit(undefined).watermark).toEqual(DEFAULT_WATERMARK);
    expect(resolveKit({ colors: [] }).watermark).toEqual(DEFAULT_WATERMARK);
    expect(DEFAULT_WATERMARK).toEqual({ enabled: true, opacity: 1, scale: 0.12 });
  });

  it('honours a brand that has turned the mark off', () => {
    const kit = resolveKit({ colors: [], logoUrl: 'https://x.example/logo.png', watermark: { enabled: false, opacity: 1, scale: 0.12 } });
    // The logo survives — it is still the brand's logo, used elsewhere. Only the
    // decision to stamp it on frames changes.
    expect(kit.logoUrl).toBe('https://x.example/logo.png');
    expect(kit.watermark.enabled).toBe(false);
  });

  it('carries opacity and scale through rather than re-hardcoding 12%', () => {
    const kit = resolveKit({ colors: [], watermark: { enabled: true, opacity: 0.35, scale: 0.2 } });
    expect(kit.watermark).toEqual({ enabled: true, opacity: 0.35, scale: 0.2 });
  });
});

describe('zipTimeline — lower-third', () => {
  const playbookBeats = [{ id: 'take', duration_sec: 20 }];

  it('carries a beat’s lower-third onto the timed beat', () => {
    const beats: ResolvedBeat[] = [
      { kind: 'text', beatId: 'take', text: 'The take.', durationSec: 20, lowerThird: 'What most people get wrong' },
    ];
    const [timed] = zipTimeline({ resolvedBeats: beats, playbookBeats, assetInfo: {} });
    expect(timed).toMatchObject({ kind: 'text', lowerThird: 'What most people get wrong' });
  });

  it('leaves the field absent rather than empty when there is no lower-third', () => {
    const beats: ResolvedBeat[] = [{ kind: 'text', beatId: 'take', text: 'The take.', durationSec: 20 }];
    const [timed] = zipTimeline({ resolvedBeats: beats, playbookBeats, assetInfo: {} });
    // Absent, not `''`. An empty string would make every renderer test truthiness
    // on a value that is present, which is how an empty strip gets drawn.
    expect(timed).not.toHaveProperty('lowerThird');
  });

  it('keeps a lower-third and an asset caption as separate values', () => {
    // The two are drawn in different places on purpose — a caption describes the
    // asset, a lower-third names the point. If they ever collapsed into one
    // field, one would silently overwrite the other on any beat carrying both.
    const beats: ResolvedBeat[] = [
      {
        kind: 'asset',
        beatId: 'take',
        assetId: 'a1',
        role: 'product_screen',
        caption: 'the scheduler screen',
        durationSec: 20,
        lowerThird: 'Mistake 1',
      },
    ];
    const [timed] = zipTimeline({
      resolvedBeats: beats,
      playbookBeats,
      assetInfo: { a1: { url: 'https://x.example/a.png', mediaType: 'image' } },
    });
    expect(timed).toMatchObject({ caption: 'the scheduler screen', lowerThird: 'Mistake 1' });
  });

  it('carries it across every visual kind', () => {
    const kinds: ResolvedBeat[] = [
      { kind: 'generated_image', beatId: 'take', url: 'u', prompt: 'p', durationSec: 20, lowerThird: 'L' },
      { kind: 'generated_broll', beatId: 'take', url: 'u', prompt: 'p', durationSec: 20, lowerThird: 'L' },
      { kind: 'dubbed_media', beatId: 'take', url: 'u', targetLanguage: 'es', mediaType: 'video', durationSec: 20, lowerThird: 'L' },
    ];
    for (const beat of kinds) {
      const [timed] = zipTimeline({ resolvedBeats: [beat], playbookBeats, assetInfo: {} });
      expect(timed, `${beat.kind} lost its lower-third`).toMatchObject({ lowerThird: 'L' });
    }
  });

  it('does not put one on an audio beat', () => {
    // A narration track has no frame to superimpose onto. The type forbids it;
    // this asserts the runtime agrees rather than passing the field through.
    const beats: ResolvedBeat[] = [{ kind: 'generated_audio', beatId: 'take', url: 'u', script: 's', durationSec: 20 }];
    const [timed] = zipTimeline({ resolvedBeats: beats, playbookBeats, assetInfo: {} });
    expect(timed!.kind).toBe('audio');
    expect(timed).not.toHaveProperty('lowerThird');
  });
});
