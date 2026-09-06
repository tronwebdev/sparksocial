'use client';

import { EngagementPanel } from './EngagementPanel';

/**
 * `Settings WS Engagement Start` / `… Done` / `… EI Autonomy|Platforms|Voice|
 * Boundaries|Sales` — seven prototype screens that are one panel with a step.
 *
 * The design gives this section its own card rather than the white one every
 * other section uses: 1350x943 at 337,143, filled with
 * `linear-gradient(180deg, #6CE8FF 0%, rgba(255,255,255,0) 60.18%)` on white,
 * with the illustration at 701,190 · 622x679 and the copy column at x=0..484.
 *
 * `EngagementPanel` already *is* the five-step wizard — it was built to these
 * same screens, saves each step through `brand.governance.set` on Continue, and
 * stamps `engagementConfiguredAt` on the last one, which is what switches the
 * entry between the Start and Configured states. So this contributes the card
 * the design draws around it and nothing else.
 */
export function EngagementSection() {
  return (
    <div className="overflow-hidden rounded-xl bg-set-ei">
      <div className="px-[30px] pb-[36px] pt-[28px]">
        <EngagementPanel />
      </div>
    </div>
  );
}
