import { TeamGroupsPanel } from '@/components/settings/TeamGroupsPanel';
import { ApprovalFlowsPanel } from '@/components/settings/ApprovalFlowsPanel';
import { PolicyPanel } from '@/components/settings/PolicyPanel';

/**
 * `SET-WS-TEAM-*`. Groups grant capabilities; the approval policy decides what
 * still needs a person regardless. Two halves of one question — who may do
 * what, and under which rules — so they share a section.
 */
export default function TeamSettings() {
  return (
    <>
      <TeamGroupsPanel />
      {/* Directly under the groups it inverts. Groups add; these hold back — and a
          reader who conflates the two misconfigures both, so they are adjacent and
          the framing is said out loud in each. */}
      <ApprovalFlowsPanel />
      <PolicyPanel />
    </>
  );
}
