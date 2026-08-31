import { TeamGroupsPanel } from '@/components/settings/TeamGroupsPanel';
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
      <PolicyPanel />
    </>
  );
}
