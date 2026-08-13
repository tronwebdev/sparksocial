import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolError } from '@sparksocial/shared';
import type { AspectRatio, FinishPlan } from '@sparksocial/finish';
import { envStr } from './env.js';

/**
 * FFMPEG, ACTUALLY EXECUTED — engine spec §6.3.
 *
 * `packages/finish/src/ffmpeg.ts` builds each stage of the filtergraph as a
 * string, and that is the genuinely hard part: the crop/scale/pad arithmetic
 * for a 9:16 export from 16:9 source, the two-pass stabilize sequence, hook
 * overlay timing. All of it unit-tested. None of it ever ran — `FfmpegRunner`
 * was injected and the only implementation returned `${url}#9x16`, a string
 * that looks like an output URL and is not one.
 *
 * ── Shelling out, deliberately ─────────────────────────────────────────────
 *
 * No `fluent-ffmpeg` or wrapper library. The pipeline already produces exact
 * filtergraph strings; a wrapper's job is to build those, so it would sit
 * between us and the thing we already got right, and its abstraction leaks the
 * moment a filter it does not model is needed.
 *
 * ── Where the binary comes from ────────────────────────────────────────────
 *
 * `FFMPEG_PATH` / `FFPROBE_PATH`, defaulting to whatever is on `PATH`. The
 * container installs them (`apps/api/Dockerfile`). `ffmpeg-static` would have
 * been tidier, but it downloads a ~70MB binary in a postinstall, which fails on
 * a restricted network — and a dependency that cannot install is worse than an
 * apt line that can.
 *
 * **Unverified end to end in this environment**: no ffmpeg binary is present on
 * the development machine, so what is tested here is argument construction,
 * failure handling and cleanup — not transcoding. It needs one smoke test on a
 * machine with ffmpeg before it is trusted.
 */

/** Long enough for a two-minute clip through a two-pass stabilize. */
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

export interface FfmpegRunnerOptions {
  ffmpegPath?: string;
  timeoutMs?: number;
  /**
   * Where finished renders are uploaded. Without it the runner returns `file://`
   * paths into a temp directory, which is useful in development and useless in
   * a container that is about to be recycled.
   */
  publish?: (localPath: string, aspect: AspectRatio) => Promise<string>;
  /** Injected in tests. */
  exec?: (bin: string, args: string[], timeoutMs: number) => Promise<void>;
}

export function createFfmpegRunner(opts: FfmpegRunnerOptions = {}) {
  const ffmpeg = opts.ffmpegPath ?? envStr('FFMPEG_PATH', 'ffmpeg');
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const exec = opts.exec ?? runProcess;

  return {
    async run(plan: FinishPlan, sourceUrl: string): Promise<Partial<Record<AspectRatio, string>>> {
      // One directory per invocation, removed in `finally`. Two concurrent
      // renders sharing a scratch path would overwrite each other's
      // intermediate files and produce a clip built from the wrong footage —
      // silently, because ffmpeg would succeed.
      const workDir = await mkdtemp(join(tmpdir(), 'spark-finish-'));

      try {
        const outputs: Partial<Record<AspectRatio, string>> = {};

        for (const [aspect, filter] of exports(plan)) {
          const outPath = join(workDir, `${aspect.replace(':', 'x')}.mp4`);

          await exec(
            ffmpeg,
            [
              // Overwrite without asking: the path is ours and freshly made,
              // and an interactive prompt in a container hangs until timeout.
              '-y',
              '-i', sourceUrl,
              '-vf', filter,
              '-c:v', 'libx264',
              '-preset', 'veryfast',
              // Web-friendly: moov atom first, so playback starts before the
              // whole file has downloaded.
              '-movflags', '+faststart',
              '-c:a', 'aac',
              outPath,
            ],
            timeoutMs,
          );

          outputs[aspect] = opts.publish ? await opts.publish(outPath, aspect) : `file://${outPath}`;
        }

        return outputs;
      } finally {
        // Even on failure. A container that renders and crashes for an hour
        // fills its disk with half-written mp4s and then fails to render
        // anything at all, for a reason that looks unrelated.
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}

/**
 * The plan's per-aspect filtergraphs, as one flat list.
 *
 * `FinishPlan` carries the stages and the export variants separately; the
 * runner only needs "which aspect, which filter chain".
 */
function exports(plan: FinishPlan): Array<[AspectRatio, string]> {
  const stages = plan.stages.map((s) => s.filter).filter(Boolean);

  return plan.exports.map((e) => [
    e.aspect,
    // The shared stages run first, then the per-aspect crop/scale/pad. Order
    // matters: stabilising after cropping stabilises the crop, not the frame.
    [...stages, e.filter].filter(Boolean).join(','),
  ]);
}

/**
 * Spawn, wait, and turn a non-zero exit into a `ToolError` carrying ffmpeg's
 * own diagnostics.
 *
 * ffmpeg writes everything to stderr, including progress, so stderr alone is
 * not an error signal — the exit code is. The tail is kept because ffmpeg's
 * actual complaint is always in the last few lines, under a wall of build
 * configuration nobody needs.
 */
function runProcess(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      // Bounded: a long render emits megabytes of progress, and holding all of
      // it costs more memory than the render itself.
      if (stderr.length > 8_000) stderr = stderr.slice(-4_000);
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new ToolError('UPSTREAM_FAILED', `ffmpeg timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    child.on('error', (e) => {
      clearTimeout(timer);
      reject(
        new ToolError(
          'UPSTREAM_FAILED',
          `Could not run ffmpeg (${bin}). Is it installed and on PATH? ${e.message}`,
        ),
      );
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(
        new ToolError('UPSTREAM_FAILED', `ffmpeg exited ${code}.`, { stderr: stderr.slice(-1_000) }),
      );
    });
  });
}
