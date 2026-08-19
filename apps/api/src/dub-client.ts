import { createDubClient, type DubClient } from '@sparksocial/publish';
import { envSet, envStr } from './env.js';

/**
 * The real Dub client when `DUB_API_KEY` is configured, `undefined`
 * otherwise — same "unset → not registered" rule as `avatarClient()`/
 * `voiceClient()`. Unlike a face or a voice, a fake short link would not be
 * *harmful*, just pointless: it would 404 forever, which is worse than the
 * tool simply not existing until there's a real workspace to create links in.
 */
let memo: DubClient | undefined | null = null;

export function dubClient(): DubClient | undefined {
  if (memo === null) memo = buildDubClient();
  return memo;
}

function buildDubClient(): DubClient | undefined {
  if (!envSet('DUB_API_KEY')) {
    console.warn('[warn] DUB_API_KEY unset — link.shorten is not registered.');
    return undefined;
  }
  return createDubClient({
    apiKey: envStr('DUB_API_KEY', ''),
    ...(envSet('DUB_DOMAIN') ? { domain: envStr('DUB_DOMAIN', '') } : {}),
  });
}
