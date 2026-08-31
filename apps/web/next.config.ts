import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

/**
 * `standalone` because this deploys to Azure Container Apps (CLAUDE.md §
 * Infrastructure), not Vercel — the plan's original target. Standalone emits a
 * self-contained server bundle a container can run without the monorepo around it.
 *
 * `transpilePackages` is load-bearing, not a nicety: workspace packages ship raw
 * TypeScript with no build step (see apps/api, which runs via `tsx`), so Next has
 * to compile `@sparksocial/shared` itself. Without this the build fails on the
 * first `.ts` import with a confusing parse error.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@sparksocial/shared'],
  /**
   * `fileURLToPath`, not `.pathname`. On Windows a file URL's `.pathname` is
   * `/C:/Users/Osarumwense%20Destiny/...` — leading slash, percent-encoded
   * spaces — which is not a path any filesystem call can resolve. File tracing
   * then finds nothing, and because tracing failing is not a build error,
   * `output: 'standalone'` silently emits no `standalone/` directory at all.
   *
   * That is invisible locally and fatal in the container: the Azure image runs
   * `server.js` from `standalone/`, so the deploy fails on an image that built
   * cleanly. `fileURLToPath` gives a real path on both platforms.
   */
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  eslint: { ignoreDuringBuilds: true },

  /**
   * `next build` and `next dev` both write to `.next` by default, so running a
   * build while a dev server is up silently replaces the chunks that server is
   * mid-flight serving. The page then 404s on its own stylesheet and script
   * bundles — it looks exactly like "the styling broke", with nothing in the
   * terminal to say why.
   *
   * `npm run build:web` sets `NEXT_DIST_DIR=.next-build` so the two can never
   * collide. Verifying a production build no longer takes down local dev.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',

  /**
   * Lets webpack resolve the `.js` specifiers in workspace TypeScript.
   *
   * `transpilePackages` above makes Next *compile* `@sparksocial/shared`, but
   * compiling is not resolving: that package's own imports are written
   * `./types.js` — correct for Node's ESM resolution, and correct for `tsx`,
   * which is how `apps/api` runs. webpack takes them literally, finds no
   * `types.js` on disk, and fails with
   *
   *   Module not found: Can't resolve './types.js'
   *
   * so CLAUDE.md's rule that `apps/web` may import `@sparksocial/shared` was
   * documented but false — every attempt broke the build, and every reference in
   * `apps/web` was a comment explaining that the values were mirrored by hand
   * instead. Mirrored constants drift; that is how the asset-role labels ended
   * up saying "Physical capture" in a dropdown two lines above
   * "physical_capture" in a sentence.
   *
   * `extensionAlias` tells webpack to try `.ts`/`.tsx` for a `.js` request. The
   * `.js` fallback stays last so genuine JavaScript still resolves.
   */
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
