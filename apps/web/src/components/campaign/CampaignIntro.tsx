'use client';

import { AgentOrb, PANEL_CLIP } from './campaignChrome';
import { FLATTEN_NARROW } from '@/components/shell/narrowStage';

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
  /*
    ── Below `canvas` ──────────────────────────────────────────────────

    This file positions with classes rather than inline styles, which is why
    it converts with variants where the wizard needed a branch. Two things go
    rather than move: the orb, because the card's notch is cut for it and the
    notch cannot be re-cut at an arbitrary width, and the clip-path wash it
    sits in — the card becomes a plain rounded rectangle instead.
  */
  return (
    <div className="absolute left-0 top-0 h-[1117px] w-[1728px] overflow-hidden max-canvas:static max-canvas:flex max-canvas:h-full max-canvas:min-h-full max-canvas:w-full max-canvas:items-center max-canvas:justify-center max-canvas:p-[20px]">
      {/*
        `-z-10` and `pointer-events-none`, because of what the line above does
        to this one. Below `canvas` the wrapper turns `static`, so this backdrop
        re-anchors to the dialog root — and the card, now a flow item, paints
        *before* it. A decorative blur ended up on top of the only two controls
        on the screen: "Create Campaign" and "Setup Later" were unclickable at
        every width under 1300, which is a laptop. `elementFromPoint` over the
        button returned this div.

        Neither an overflow audit nor a sibling-overlap test can see it — the
        backdrop is meant to cover everything. The rule it wants is: an
        `inset-0` decoration inside a wrapper that flattens must say it is
        decoration, in both senses.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-cmp-backdrop"
        style={{ backdropFilter: 'blur(10px)' }}
      />

      <AgentOrb size={212.891} className="left-[757.5px] top-[100px] max-canvas:hidden" />

      <div className="absolute left-[590px] top-[322px] h-[335px] w-[548px] max-canvas:static max-canvas:flex max-canvas:h-auto max-canvas:w-full max-canvas:max-w-[440px] max-canvas:flex-col max-canvas:items-center max-canvas:gap-[16px] max-canvas:rounded-[20px] max-canvas:bg-white max-canvas:p-[24px]">
        <div aria-hidden className="absolute inset-0 bg-white max-canvas:hidden" style={{ backdropFilter: 'blur(45.794px)', clipPath: PANEL_CLIP.popup }} />

        <h2
          className="absolute left-[35px] top-[55px] w-[478px] text-center text-36 font-semibold leading-[1.21] max-canvas:static max-canvas:w-full"
          style={{ color: 'rgb(131,131,131)' }}
        >
          Your agent is ready! <span className="text-black">Let&rsquo;s create your first campaign.</span>
        </h2>

        <p
          className="absolute left-[91px] top-[151px] w-[367px] text-center text-18 font-medium leading-[1.31] max-canvas:static max-canvas:w-full"
          style={{ color: 'rgb(131,131,131)' }}
        >
          Reach your audience in just a few clicks and see your campaign take off.
        </p>

        <button
          type="button"
          onClick={onStart}
          /*
            `max-canvas:static` on its own emptied this button. Its icon and its
            label are both absolutely positioned inside it, so dropping the
            button's positioning handed them to the dialog root: the word
            "Create Campaign" rendered in the top-left corner of the screen and
            the button itself was a blank outlined box. Below `canvas` it
            becomes an ordinary flex row and its children come back into flow.
          */
          className={`absolute left-[178px] top-[214px] h-[48px] w-[192px] cursor-pointer rounded-[9.82px] bg-white transition-colors hover:bg-surface-200 active:scale-[0.98] max-canvas:static max-canvas:flex max-canvas:items-center max-canvas:justify-center max-canvas:gap-[8px] ${FLATTEN_NARROW}`}
          style={{ boxShadow: 'inset 0 0 0 1px rgb(131,131,131)' }}
        >
          <svg width="13.854" height="13.814" viewBox="0 0 13.854 13.814" fill="rgb(0,0,0)" className="absolute left-[20px] top-[17px] block" aria-hidden>
            <path d="M 5.423 5.383 L 5.423 0 L 8.471 0 L 8.471 5.383 L 13.854 5.383 L 13.854 8.471 L 8.471 8.471 L 8.471 13.814 L 5.423 13.814 L 5.423 8.471 L 0 8.471 L 0 5.383 L 5.423 5.383 Z" />
          </svg>
          <span className="absolute left-[39.854px] top-[14px] whitespace-nowrap text-16 font-semibold leading-none text-black">
            Create Campaign
          </span>
        </button>

        <button
          type="button"
          onClick={onLater}
          className="absolute left-[224px] top-[283px] w-[101px] cursor-pointer whitespace-nowrap text-center text-18 font-medium leading-[1.35] transition-colors hover:text-ink max-canvas:static"
          style={{ color: 'rgb(131,131,131)' }}
        >
          Setup Later
        </button>
      </div>
    </div>
  );
}
