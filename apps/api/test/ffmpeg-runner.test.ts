import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ToolError } from '@sparksocial/shared';
import { buildFinishPipeline } from '@sparksocial/finish';
import { createFfmpegRunner } from '../src/ffmpeg-runner.js';

/**
 * The runner executes the filtergraphs `pipeline.ts` builds. Those strings are
 * unit-tested in `packages/finish`; what is tested here is everything around
 * the process — argv, failure, timeout, and cleanup.
 *
 * **Not tested here: transcoding.** There is no ffmpeg binary on the
 * development machine, so nothing below proves a video comes out the other end.
 * That needs one smoke test on a machine with ffmpeg, and until it has run this
 * should be treated as wired rather than working.
 */

const plan = () =>
  buildFinishPipeline({
    trim: { startSec: 2, endSec: 20 },
    sourceWidth: 1920,
    sourceHeight: 1080,
    captions: [],
    aspects: ['9:16', '1:1'],
    transformsPath: '/tmp/t.trf',
    srtPath: '/tmp/c.srt',
    // Not optional: every playbook format opens on a hook (§5.1
    // `structure.beats[0]`), and Finish is what renders it over raw footage.
    hook: { text: 'The fade nobody notices', fontFile: '/fonts/onest.ttf', colorHex: '#FFFFFF' },
  });

const spy = () => {
  const calls: Array<{ bin: string; args: string[] }> = [];
  return { calls, exec: vi.fn(async (bin: string, args: string[]) => void calls.push({ bin, args })) };
};

describe('argument construction', () => {
  it('renders one output per requested aspect', async () => {
    const { calls, exec } = spy();
    const outputs = await createFfmpegRunner({ exec }).run(plan(), 'https://cdn.example/raw.mp4');

    expect(calls).toHaveLength(2);
    expect(Object.keys(outputs).sort()).toEqual(['1:1', '9:16']);
  });

  it('passes the source and a filtergraph', async () => {
    const { calls, exec } = spy();
    await createFfmpegRunner({ exec }).run(plan(), 'https://cdn.example/raw.mp4');

    const args = calls[0]!.args;
    expect(args[args.indexOf('-i') + 1]).toBe('https://cdn.example/raw.mp4');
    expect(args[args.indexOf('-vf') + 1]).toBeTruthy();
  });

  it('applies the shared stages before the per-aspect crop', async () => {
    // Order is not cosmetic: stabilising *after* cropping stabilises the crop
    // rather than the frame, and the result is a clip that drifts.
    const { calls, exec } = spy();
    await createFfmpegRunner({ exec }).run(plan(), 'src.mp4');

    const filter = calls[0]!.args[calls[0]!.args.indexOf('-vf') + 1]!;
    const trimAt = filter.indexOf('trim');
    const cropAt = filter.lastIndexOf('crop');
    expect(trimAt).toBeGreaterThanOrEqual(0);
    expect(cropAt).toBeGreaterThan(trimAt);
  });

  it('never prompts', async () => {
    // An interactive overwrite prompt in a container hangs until the timeout.
    const { calls, exec } = spy();
    await createFfmpegRunner({ exec }).run(plan(), 'src.mp4');
    expect(calls[0]!.args).toContain('-y');
  });

  it('writes web-playable output', async () => {
    // `+faststart` puts the moov atom first so playback starts before the file
    // has fully downloaded — the difference between a preview and a wait.
    const { calls, exec } = spy();
    await createFfmpegRunner({ exec }).run(plan(), 'src.mp4');
    expect(calls[0]!.args).toContain('+faststart');
  });

  it('honours a configured binary path', async () => {
    const { calls, exec } = spy();
    await createFfmpegRunner({ exec, ffmpegPath: '/opt/ffmpeg' }).run(plan(), 'src.mp4');
    expect(calls[0]!.bin).toBe('/opt/ffmpeg');
  });
});

describe('outputs', () => {
  it('publishes each render when a publisher is supplied', async () => {
    const { exec } = spy();
    const publish = vi.fn(async (_p: string, aspect: string) => `https://blob.example/${aspect}.mp4`);

    const outputs = await createFfmpegRunner({ exec, publish }).run(plan(), 'src.mp4');
    expect(outputs['9:16']).toBe('https://blob.example/9:16.mp4');
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('falls back to a local path with no publisher', async () => {
    const { exec } = spy();
    const outputs = await createFfmpegRunner({ exec }).run(plan(), 'src.mp4');
    expect(outputs['9:16']).toMatch(/^file:\/\//);
  });
});

describe('failure and cleanup', () => {
  it('surfaces a non-zero exit as a ToolError', async () => {
    const exec = vi.fn(async () => {
      throw new ToolError('UPSTREAM_FAILED', 'ffmpeg exited 1.');
    });
    await expect(createFfmpegRunner({ exec }).run(plan(), 'src.mp4')).rejects.toThrow(/exited 1/);
  });

  it('removes its scratch directory even when the render fails', async () => {
    /**
     * A container that renders and fails for an hour otherwise fills its disk
     * with half-written mp4s, and then stops rendering for a reason that looks
     * unrelated to the failures that caused it.
     */
    let workDir: string | undefined;
    const exec = vi.fn(async (_bin: string, args: string[]) => {
      workDir = dirname(args[args.length - 1]!);
      throw new Error('boom');
    });

    await expect(createFfmpegRunner({ exec }).run(plan(), 'src.mp4')).rejects.toThrow();
    expect(workDir).toBeDefined();
    expect(existsSync(workDir!)).toBe(false);
  });

  it('gives each invocation its own scratch directory', async () => {
    // Two concurrent renders sharing a path would overwrite each other's
    // intermediates and produce a clip built from the wrong footage — and
    // ffmpeg would exit 0 while doing it.
    const dirs: string[] = [];
    const exec = vi.fn(async (_bin: string, args: string[]) => {
      dirs.push(dirname(args[args.length - 1]!));
    });

    const runner = createFfmpegRunner({ exec });
    await Promise.all([runner.run(plan(), 'a.mp4'), runner.run(plan(), 'b.mp4')]);

    expect(new Set(dirs).size).toBeGreaterThan(1);
  });
});
