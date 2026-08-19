import { createAyrshareAnalyticsClient, type AnalyticsSource } from '@sparksocial/analytics';
import { envSet, envStr } from './env.js';

/**
 * The real analytics source when `AYRSHARE_API_KEY` is configured, `undefined`
 * otherwise — same "unset → not registered" rule as `dubClient()`. Reads the
 * same key `.env.example` already reserves for #78's real aggregator publish
 * adapter: one credential unlocks both, since they're the same Ayrshare
 * account.
 */
let memo: AnalyticsSource | undefined | null = null;

export function analyticsClient(): AnalyticsSource | undefined {
  if (memo === null) memo = buildAnalyticsClient();
  return memo;
}

function buildAnalyticsClient(): AnalyticsSource | undefined {
  if (!envSet('AYRSHARE_API_KEY')) {
    console.warn('[warn] AYRSHARE_API_KEY unset — analytics.sync is not registered.');
    return undefined;
  }
  return createAyrshareAnalyticsClient({ apiKey: envStr('AYRSHARE_API_KEY', '') });
}
