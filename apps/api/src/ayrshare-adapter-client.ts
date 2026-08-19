import { createAyrshareAdapter, type PlatformAdapter } from '@sparksocial/publish';
import { envSet, envStr } from './env.js';

/**
 * The real aggregator adapter when `AYRSHARE_API_KEY` is configured,
 * `undefined` otherwise — same "unset → not registered" rule as
 * `dubClient()`/`analyticsClient()`, except here the fallback is not "no
 * tool at all" but `createStubAdapter()` (see `tools.ts`): publishing must
 * keep working end to end in development without a vendor account, per
 * `adapter.ts`'s own reasoning for why the stub exists.
 */
let memo: PlatformAdapter | undefined | null = null;

export function ayrshareAdapterClient(): PlatformAdapter | undefined {
  if (memo === null) memo = buildAyrshareAdapter();
  return memo;
}

function buildAyrshareAdapter(): PlatformAdapter | undefined {
  if (!envSet('AYRSHARE_API_KEY')) {
    console.warn('[warn] AYRSHARE_API_KEY unset — publishing uses the in-memory stub adapter, not a real platform.');
    return undefined;
  }
  return createAyrshareAdapter({ apiKey: envStr('AYRSHARE_API_KEY', '') });
}
