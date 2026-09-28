import { describe, expect, it } from 'vitest';
import { byId } from '@sparksocial/playbooks';
import type { ResolvedBeat } from '@sparksocial/generate';
import { autoIllustrate } from '../src/auto-illustrate.js';

/**
 * Auto-illustration — where a post's pictures come from.
 *
 * A brand with no footage got white type on a flat ground for every post in
 * its calendar: the calendar said "video", the post said "video", and what
 * came out was a caption on a black rectangle.
 *
 * The ordering is the whole point. A brand's own photographs are true, free,
 * and better than anything a model will invent about it, so generation is the
 * fallback and never the first move.
 */

const VIDEO_PB = byId('pb_voice_over_broll')!;
const IMAGE_PB = byId('pb_generated_quote_card')!;
const TEXT_PB = byId('pb_text_update')!;

const textBeat = (id: string, text = 'some copy'): ResolvedBeat =>
  ({ kind: 'text', beatId: id, text, durationSec: 5 }) as ResolvedBeat;

function harness(
  over: {
    assets?: Array<{ assetId: string; role: string }>;
    info?: Record<string, { mediaType: string; rightsStatus: string; url: string }>;
  } = {},
) {
  const generated: string[] = [];
  const deps = {
    db: {
      assets: {
        retrieve: async () => over.assets ?? [],
        info: async () => over.info ?? {},
      },
    },
    invoke: {} as never,
    embed: { embed: async () => [0.1] },
    invokeTool: async (req: { tool: string; input: { prompt?: string } }) => {
      generated.push(req.tool);
      return { status: 'succeeded', output: { url: 'https://cdn/made.jpg' } };
    },
  } as never;
  return { deps, generated };
}

const base = {
  contentItemId: 'c1',
  genomeId: 'g1',
  ctx: { orgId: 'o1', logger: { info: () => {}, warn: () => {}, error: () => {} } } as never,
  brand: {} as never,
};

describe('autoIllustrate', () => {
  it('uses the brand’s own picture rather than making one', async () => {
    /*
     * The ordering that matters. A generated photograph of a bakery is not
     * that bakery, and the brand is paying for the invention.
     */
    const { deps } = harness({
      assets: [{ assetId: 'a1', role: 'product_shot' }],
      info: { a1: { mediaType: 'image', rightsStatus: 'cleared', url: 'https://cdn/real.jpg' } },
    });
    const { beats, result } = await autoIllustrate({
      ...base,
      beats: [textBeat('copy')],
      playbook: IMAGE_PB,
      deps,
    });

    expect(result).toEqual({ fromAssets: 1, generated: 0 });
    expect((beats[0] as { backdrop?: { urls: string[] } }).backdrop?.urls).toEqual(['https://cdn/real.jpg']);
    // The words survive — the whole reason this attaches rather than replaces.
    expect(beats[0]!.kind).toBe('text');
  });

  it('never uses the logo as a backdrop', async () => {
    /*
     * `brand_kit` is the one role guaranteed to exist — `ensureBrandKitAsset`
     * creates it whenever a logo is set — so without this every brand with no
     * photographs would reliably get its own logo blown up behind every post,
     * which is worse than the flat ground it replaced.
     */
    const { deps } = harness({
      assets: [{ assetId: 'logo', role: 'brand_kit' }],
      info: { logo: { mediaType: 'image', rightsStatus: 'cleared', url: 'https://cdn/logo.png' } },
    });
    const { beats, result } = await autoIllustrate({ ...base, beats: [textBeat('copy')], playbook: IMAGE_PB, deps });
    expect((beats[0] as { backdrop?: { urls: string[] } }).backdrop?.urls?.[0]).not.toBe('https://cdn/logo.png');
    expect(result.fromAssets).toBe(0);
  });

  it('will not put an uncleared asset into a frame', async () => {
    // Rights are the publishing gate; a restricted asset must not reach a
    // rendered frame through a side door.
    const { deps } = harness({
      assets: [{ assetId: 'a1', role: 'product_shot' }],
      info: { a1: { mediaType: 'image', rightsStatus: 'pending', url: 'https://cdn/x.jpg' } },
    });
    const { beats, result } = await autoIllustrate({ ...base, beats: [textBeat('copy')], playbook: IMAGE_PB, deps });
    expect((beats[0] as { backdrop?: { urls: string[] } }).backdrop?.urls?.[0]).not.toBe('https://cdn/x.jpg');
    expect(result.fromAssets).toBe(0);
  });

  it('leaves a post that already has visuals alone', async () => {
    // Real media means the post is illustrated; a backdrop would be a second
    // picture competing with the first.
    const { deps } = harness();
    const withMedia = [
      { kind: 'generated_image', beatId: 'b', url: 'u', prompt: 'p' } as ResolvedBeat,
      textBeat('caption'),
    ];
    const { result } = await autoIllustrate({ ...base, beats: withMedia, playbook: IMAGE_PB, deps });
    expect(result).toEqual({ fromAssets: 0, generated: 0 });
  });

  it('does nothing for a text post', async () => {
    const { deps } = harness();
    const { result } = await autoIllustrate({ ...base, beats: [textBeat('copy')], playbook: TEXT_PB, deps });
    expect(result).toEqual({ fromAssets: 0, generated: 0 });
  });

  it('prefers real footage over stills for a video post', async () => {
    // A still behind narration is a slideshow — a normal kind of post — but
    // actual footage is what the format asked for.
    const { deps } = harness({
      assets: [
        { assetId: 'still', role: 'product_shot' },
        { assetId: 'clip', role: 'physical_capture' },
      ],
      info: {
        still: { mediaType: 'image', rightsStatus: 'cleared', url: 'https://cdn/s.jpg' },
        clip: { mediaType: 'video', rightsStatus: 'cleared', url: 'https://cdn/c.mp4' },
      },
    });
    const { beats } = await autoIllustrate({ ...base, beats: [textBeat('hook')], playbook: VIDEO_PB, deps });
    expect((beats[0] as { backdrop?: { urls: string[] } }).backdrop?.urls).toEqual(['https://cdn/c.mp4']);
    expect((beats[0] as { backdrop?: { kind: string } }).backdrop?.kind).toBe('video');
  });

  it('renders without a backdrop when the asset lookup fails', async () => {
    // One failed lookup must not cost a post its render.
    const deps = {
      db: { assets: { retrieve: async () => { throw new Error('down'); }, info: async () => ({}) } },
      invoke: {} as never,
      embed: { embed: async () => [0.1] },
      invokeTool: async () => ({ status: 'failed', error: { message: 'no generator' } }),
    } as never;
    const { beats, result } = await autoIllustrate({ ...base, beats: [textBeat('copy')], playbook: IMAGE_PB, deps });
    expect(result).toEqual({ fromAssets: 0, generated: 0 });
    expect((beats[0] as { backdrop?: unknown }).backdrop).toBeUndefined();
  });
});

describe('autoIllustrate — generation as the fallback', () => {
  it('generates only when the brand has nothing usable', async () => {
    const { deps, generated } = harness({ assets: [] });
    const { beats, result } = await autoIllustrate({
      ...base,
      beats: [textBeat('cinnamon buns on saturday')],
      playbook: IMAGE_PB,
      deps,
    });

    expect(result).toEqual({ fromAssets: 0, generated: 1 });
    expect(generated).toEqual(['content.generate_image']);
    expect((beats[0] as { backdrop?: { urls: string[] } }).backdrop?.urls).toEqual(['https://cdn/made.jpg']);
    // Still the copy. Generating *into* the beat would have thrown it away.
    expect(beats[0]!.kind).toBe('text');
  });

  it('asks for a clip, not a still, on a video post', async () => {
    const { deps, generated } = harness({ assets: [] });
    await autoIllustrate({ ...base, beats: [textBeat('why we bake at 4am')], playbook: VIDEO_PB, deps });
    expect(generated).toEqual(['content.generate_broll']);
  });
});

describe('autoIllustrate — long beats are split', () => {
  it('makes enough clips to cover the beat rather than looping one', async () => {
    /*
     * The generator caps at ten seconds. A fifty-second narration given one
     * clip is the same five seconds looping ten times, which reads as a broken
     * video rather than as footage.
     */
    const { deps, generated } = harness({ assets: [] });
    const long = { kind: 'text', beatId: 'analysis', text: 'why we bake at 4am', durationSec: 50 } as ResolvedBeat;
    const { beats, result } = await autoIllustrate({ ...base, beats: [long], playbook: VIDEO_PB, deps });

    expect(generated.length).toBeGreaterThan(1);
    expect((beats[0] as { backdrop?: { urls: string[] } }).backdrop!.urls.length).toBeGreaterThan(1);
    expect(result.generated).toBe(generated.length);
  });

  it('does not split a short beat', async () => {
    const { deps, generated } = harness({ assets: [] });
    const short = { kind: 'text', beatId: 'hook', text: 'a hook', durationSec: 3 } as ResolvedBeat;
    await autoIllustrate({ ...base, beats: [short], playbook: VIDEO_PB, deps });
    expect(generated).toHaveLength(1);
  });

  it('never spends more clips on one post than the ceiling allows', async () => {
    // Splitting multiplies cost, so the ceiling is per post: without it one
    // video playbook could outspend the rest of a brand's month.
    const { deps, generated } = harness({ assets: [] });
    const longs = ['a', 'b', 'c'].map(
      (id) => ({ kind: 'text', beatId: id, text: 'narration', durationSec: 50 }) as ResolvedBeat,
    );
    await autoIllustrate({ ...base, beats: longs, playbook: VIDEO_PB, deps });
    expect(generated.length).toBeLessThanOrEqual(6);
  });
});
