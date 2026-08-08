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
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
