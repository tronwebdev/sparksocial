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
};

export default nextConfig;
