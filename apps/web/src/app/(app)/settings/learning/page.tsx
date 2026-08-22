import { LearningPanel } from '@/components/settings/LearningPanel';

/**
 * Not a section the prototypes have, and it earns one: as of 22 August the
 * outcome observer actually drives the loop, so what this panel reports changes
 * over days rather than staying at cold start forever. A screen whose numbers
 * move is a screen worth being able to link to.
 */
export default function LearningSettings() {
  return <LearningPanel />;
}
