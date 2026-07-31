import { serve } from '@hono/node-server';
import { createApp, memoryInvokeDeps } from './app.js';
import { registerAlphaTools } from './tools.js';
import { devResolveCtx, devBrandGovernance } from './dev-auth.js';

/**
 * Entrypoint. Azure Container Apps runs this behind Front Door.
 *
 * `PORT` is supplied by the platform; default 8080 matches the Container Apps
 * ingress convention. `REVISION` is stamped by the deploy workflow from the
 * commit SHA so `/health` can confirm which build is actually live — the cheapest
 * possible answer to "did the deploy land?".
 */

const port = Number(process.env.PORT ?? 8080);
const env = process.env.NODE_ENV ?? 'development';

registerAlphaTools();

if (env === 'production' && process.env.ALLOW_DEV_AUTH !== 'true') {
  // The dev resolver trusts request headers for tenancy. Shipping that to
  // production would make genome isolation forgeable by any caller, so refuse to
  // start rather than serve something that looks like it works.
  throw new Error(
    'Refusing to start: production requires a real auth resolver (Clerk). ' +
      'Set ALLOW_DEV_AUTH=true only for a throwaway environment.',
  );
}

const app = createApp({
  resolveCtx: devResolveCtx,
  loadBrandGovernance: devBrandGovernance,
  invokeDeps: memoryInvokeDeps(),
  ...(process.env.REVISION ? { revision: process.env.REVISION } : {}),
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`SparkSocial API listening on :${info.port} (${env})`);
});
