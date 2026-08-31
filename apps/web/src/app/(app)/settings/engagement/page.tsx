import { EngagementPanel } from '@/components/settings/EngagementPanel';

/**
 * `SET-WS-EI-*` — five prototypes, one section. Split out of
 * `GovernancePanel`, which had grown to span four sections of this navigation.
 */
export default function EngagementSettings() {
  return <EngagementPanel />;
}
