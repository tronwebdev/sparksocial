import { AutomationScreen } from '@/components/automation/AutomationScreen';

/**
 * `AUTO-01`→`AUTO-04.4` — `ui build/SparkSocial Automation.dc.html`.
 *
 * The page is the screen and nothing else. It used to be a `TopBar` over a
 * heading and `AutomationRecipes`, which had the right capability and none of
 * the design: the prototype has no top bar, and its card carries a starfield
 * hero, three recipe cards and the output queue in one frame.
 *
 * `components/automation/AutomationRecipes.tsx` is left in place with no
 * caller. It holds one thing this design has nowhere to put — the per-field
 * edit form over `recipe.update` — and deleting a working editor to match a
 * screen that never drew one would lose capability rather than fidelity.
 */
export default function AutomationPage() {
  return <AutomationScreen />;
}
