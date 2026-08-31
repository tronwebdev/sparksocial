import { ConnectionsPanel } from '@/components/settings/ConnectionsPanel';
import { PublishHealthPanel } from '@/components/settings/PublishHealthPanel';

/**
 * `SET-WS-SOCIAL-ACCOUNTS`. What this brand is connected to, and whether those
 * connections are actually working — health beside the list rather than on
 * another screen, because "connected" and "connected and not expiring" are the
 * same question asked twice.
 */
export default function ConnectionSettings() {
  return (
    <>
      <ConnectionsPanel />
      <PublishHealthPanel />
    </>
  );
}
