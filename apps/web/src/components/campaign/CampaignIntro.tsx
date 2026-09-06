'use client';

import { AgentOrb, PANEL_CLIP } from './campaignChrome';

/**
 * The entry state of `SparkSocial Create Campaign.dc.html` — its `isPopup`
 * branch, and the prototype's default screen.
 *
 * Geometry, on the 1728 stage: orb at 757.5,100 · 212.891²; card at
 * 590,322 · 548×335 with the notch the orb sits in; title 35/600 centred with
 * the first sentence in `#838383` and the second in black; button
 * 178,214 · 192×48 r9.82.
 *
 * ── Why this is a state of the wizard and not a screen ────────────────────
 *
 * The prototype's "Setup Later" leaves for the Command Center, which makes this
 * look like a route. It is not: nothing here writes anything, and the only two
 * exits are "start the wizard" and "don't". So it is the wizard's step 0, shown
 * only where a caller asks for it — the calendar mounts the wizard directly on
 * a button press, where an "are you sure you want to begin" card would be a
 * second click for nothing.
 */
export function CampaignIntro({ onStart, onLater }: { onStart: () => void; onLater: () => void }) {
  return (
    <div className="absolute left-0 top-0 h-[1117px] w-[1728px] overflow-hidden">
      <div aria-hidden className="absolute inset-0 bg-cmp-backdrop" style={{ backdropFilter: 'blur(10px)' }} />

      <AgentOrb size={212.891} className="left-[757.5px] top-[100px]" />

      <div className="absolute left-[590px] top-[322px] h-[335px] w-[548px]">
        <div aria-hidden className="absolute inset-0 bg-white" style={{ backdropFilter: 'blur(45.794px)', clipPath: PANEL_CLIP.popup }} />

        <h2
          className="absolute left-[35px] top-[55px] w-[478px] text-center text-[35px] font-semibold leading-[1.21]"
          style={{ color: 'rgb(131,131,131)' }}
        >
          Your agent is ready! <span className="text-black">Let&rsquo;s create your first campaign.</span>
        </h2>

        <p
          className="absolute left-[91px] top-[151px] w-[367px] text-center text-[18px] font-medium leading-[1.31]"
          style={{ color: 'rgb(131,131,131)' }}
        >
          Reach your audience in just a few clicks and see your campaign take off.
        </p>

        <button
          type="button"
          onClick={onStart}
          className="absolute left-[178px] top-[214px] h-[48px] w-[192px] cursor-pointer rounded-[9.82px] bg-white transition-colors hover:bg-surface-200 active:scale-[0.98]"
          style={{ boxShadow: 'inset 0 0 0 1px rgb(131,131,131)' }}
        >
          <svg width="13.854" height="13.814" viewBox="0 0 13.854 13.814" fill="rgb(0,0,0)" className="absolute left-[20px] top-[17px] block" aria-hidden>
            <path d="M 5.423 5.383 L 5.423 0 L 8.471 0 L 8.471 5.383 L 13.854 5.383 L 13.854 8.471 L 8.471 8.471 L 8.471 13.814 L 5.423 13.814 L 5.423 8.471 L 0 8.471 L 0 5.383 L 5.423 5.383 Z" />
          </svg>
          <span className="absolute left-[39.854px] top-[14px] whitespace-nowrap text-[16px] font-semibold leading-none text-black">
            Create Campaign
          </span>
        </button>

        <button
          type="button"
          onClick={onLater}
          className="absolute left-[224px] top-[283px] w-[101px] cursor-pointer whitespace-nowrap text-center text-[18px] font-medium leading-[1.35] transition-colors hover:text-ink"
          style={{ color: 'rgb(131,131,131)' }}
        >
          Setup Later
        </button>
      </div>
    </div>
  );
}
