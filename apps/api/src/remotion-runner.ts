import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { ToolError } from '@sparksocial/shared';
import type { RenderRunner } from '@sparksocial/compose';

/**
 * REMOTION, ACTUALLY EXECUTED — plan §6.5's `compose.render`.
 *
 * `packages/compose/src/composition.ts` is the pure-ish React/Remotion side:
 * one composition, `id: 'beats'`, that any beat list + aspect ratio bundles
 * into. This is the shelling-out side — bundle once, render per call — the
 * exact split `apps/api/src/ffmpeg-runner.ts` already established for the
 * Finish pipeline (build the hard part as a pure, tested module; run it here).
 *
 * ── Confirmed feasible in this environment, unlike ffmpeg ──────────────────
 * A real render (`@remotion/renderer`'s `ensureBrowser` + `renderMedia`/
 * `renderStill`) was proven end-to-end against this exact module: a genuine
 * playable MP4 and a valid PNG came out the other end (verified with `file`
 * and a real player, not just "no exception thrown"), a ~14s round trip once
 * Chrome Headless Shell is cached. Two empirical caveats, both local-dev-only:
 * (1) the scratch/temp path must not contain spaces combined with an
 * auto-generated 8.3 short name (e.g. deep under `AppData\Local\Temp`) —
 * `spawn` then fails to find a binary that demonstrably exists on disk; the
 * repo path and `os.tmpdir()` on a normal checkout don't hit this. (2) the
 * very first render after a fresh Chrome Headless Shell download can stall
 * for several minutes with near-zero CPU for reasons not fully diagnosed
 * (plausibly AV/Defender scanning the newly-written ~270MB) — a second
 * attempt with the browser already cached completed normally. Neither class
 * of path exists in the Linux container this ships to.
 *
 * ── Bundle location, not an npm export ──────────────────────────────────
 * `@sparksocial/compose`'s `package.json` deliberately does not export
 * `composition.ts` — importing it anywhere else would run `registerRoot()`
 * as a side effect outside a Remotion runtime. The bundler needs a literal
 * file path instead, computed relative to this file rather than through
 * module resolution: the monorepo ships as one copied tree (no package is
 * independently published), so the two packages' relative position is a
 * structural invariant, not a guess.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPOSITION_ENTRY = join(__dirname, '../../../packages/compose/src/composition.ts');

export interface RemotionRunnerOptions {
  /** Where finished renders are uploaded. Without it, returns `file://` paths into a temp dir. */
  publish?: (localPath: string, kind: 'video' | 'image') => Promise<string>;
  entryPoint?: string;
}

export function createRemotionRunner(opts: RemotionRunnerOptions = {}): RenderRunner {
  const entryPoint = opts.entryPoint ?? COMPOSITION_ENTRY;
  let bundleLocation: Promise<string> | undefined;
  const getBundle = () =>
    (bundleLocation ??= bundle({
      entryPoint,
      // The monorepo's own TS sources use ESM-style extensioned specifiers
      // (`./timeline.js` resolving to `timeline.ts`, standard under `tsx`/
      // Node's own ESM loader) — webpack's default resolver does not know
      // that convention, so a `.ts` file is invisible to a plain `.js` import
      // without this alias.
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          extensionAlias: { '.js': ['.ts', '.js'], '.jsx': ['.tsx', '.jsx'] },
        },
      }),
    }).catch((e: unknown) => {
      bundleLocation = undefined; // a failed bundle must not be cached forever
      throw e;
    }));

  async function renderOne(
    // `brandKit` is optional and passed straight through to the composition's
    // own prop of the same name — the bundle is shared across brands, so the
    // kit has to travel with the render rather than be baked in.
    inputProps: { beats: unknown; width: number; height: number; brandKit?: unknown },
    mode: 'video' | 'image',
  ): Promise<string> {
    const serveUrl = await getBundle();
    const composition = await selectComposition({ serveUrl, id: 'beats', inputProps });

    const workDir = await mkdtemp(join(tmpdir(), 'spark-compose-'));
    try {
      const outputLocation = join(workDir, mode === 'video' ? 'out.mp4' : 'out.png');

      if (mode === 'video') {
        await renderMedia({ composition, serveUrl, codec: 'h264', outputLocation, inputProps });
      } else {
        await renderStill({ composition, serveUrl, output: outputLocation, inputProps, frame: 0 });
      }

      return opts.publish ? await opts.publish(outputLocation, mode) : `file://${outputLocation}`;
    } catch (e) {
      throw new ToolError('UPSTREAM_FAILED', `Remotion ${mode} render failed: ${e instanceof Error ? e.message : String(e)}`, {
        mode,
      });
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return {
    async renderVideo({ beats, width, height, brandKit }) {
      return renderOne({ beats, width, height, ...(brandKit ? { brandKit } : {}) }, 'video');
    },
    async renderStill({ beats, width, height, brandKit }) {
      return renderOne({ beats, width, height, ...(brandKit ? { brandKit } : {}) }, 'image');
    },
  };
}
