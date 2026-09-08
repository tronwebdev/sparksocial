'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChatDrawer } from '@/components/command-center/ChatDrawer';
import { isSparkPinned, onAskSparkOpen, openAskSpark } from '@/lib/askSpark';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { useAgentIdentity } from '@/lib/useAgentIdentity';
import { SparkMark } from '@/components/brand/SparkMark';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { cn } from '@/lib/utils';

/**
 * ASK SPARK, from anywhere — `F2`.
 *
 * The fidelity pass got the count right and the place wrong. A persistent
 * assistant affordance appears in **48 of the 61 prototypes** — that part holds
 * — but not one of them puts it in the sidebar. Measured across every file, the
 * block is 196×70 at left 1484–1503, top 30–34: the header's top-right corner,
 * on Dashboard, Command Center, Assets, Discovery and every Settings screen. The
 * `left:102px` I read as a sidebar coordinate is the label's offset *inside* that
 * block.
 *
 * So it renders as the header control it is: the Spark orb at 70.2px with a
 * white speech bubble beside it reading "Ask Spark?" in 14px/600, the bubble
 * tail pointing back at the orb — the same notch shape the onboarding assistant
 * uses. The orb is `SparkMark`, i.e. the project logo, unchanged.
 *
 * The capability was never missing — `ChatDrawer` runs the agent perfectly well
 * — it was reachable from exactly one screen out of nineteen.
 *
 * The backlog filed it once, inside M1, as a detail of `/home`. That is the
 * mis-shaped version of the finding: closing M1 as written would have put a
 * button on the dashboard and left the other forty-seven screens without one.
 * It belongs in the shell, which is why it lives here.
 *
 * ── One drawer, every page ────────────────────────────────────────────────
 *
 * This deferred on `/agents` because `CommandCenterOverview` mounted a second
 * `ChatDrawer` of its own — so the Command Center had a drawer that only existed
 * on one of its four tabs, and the shell's Ask Spark was inert there. That
 * second drawer is gone: this one is the only one, on every route, and the
 * Command Center's own header button opens it through `openAskSpark` like any
 * other caller.
 *
 * ── The `/agents` deferral this replaced ──────────────────────────────────
 *
 * `/agents` renders `CommandCenterOverview`, which already owns a `ChatDrawer`
 * wired to its own draft panel so you can edit while chatting. A second drawer
 * from the shell would put two independent conversations one keystroke apart,
 * each unaware of the other, so the shell defers there.
 *
 * The trap this used to describe: the screen *titled* "Agent Command Center" is
 * at `/agents`, while the engagement inbox was at `/command-center` — M2's naming
 * collision. This component first suppressed itself on `/command-center`, which
 * was precisely backwards: it hid Ask Spark on the inbox, which has no chat and
 * needs it, and doubled it on the one screen that already had one.
 *
 * M2 is closed — the inbox is at `/engagement` now, matching the nav item that
 * has always pointed at it, so exactly one thing in the app is called a command
 * center and it is the screen this defers to. The suppression below is keyed on
 * `/agents` because that is where the other drawer is, which is now the only
 * reading of it.
 *
 * ── The draft handoff ─────────────────────────────────────────────────────
 *
 * A conversation can produce a draft, and `/agents`' own drawer opens it in
 * place. From anywhere else there is no draft panel to open, so this navigates
 * to `/agents?draft=<id>` — which required teaching that screen to read the
 * parameter. Worth it beyond this button: the draft panel is now addressable, so
 * a link in a notification or a bug report can point at one.
 */
/**
 * Two sizes and two wirings.
 *
 * `compact` is the Command Center's own block — 185x66.3 where the cockpit's is
 * 196x70.2, a uniform 0.944 of it (orb 66.3, bubble 118.929x44.362 at 66.1,11.3,
 * label at 96.3,24.5 in 13.21px). `Command Center.dc.html` draws it at 1491,34
 * and the cockpit at 1484,30; they are not the same control at the same size.
 *
 * `delegate` renders the button without a `ChatDrawer` and pushes the open
 * through `openAskSpark()` instead. That is what the Command Center needs: the
 * design puts this button in its chrome, and the screen already owns a drawer
 * that listens on that channel — so the button is the design's and the drawer
 * stays single.
 */
export function AskSpark({ compact = false, delegate = false }: { compact?: boolean; delegate?: boolean } = {}) {
  const router = useRouter();
  const { genome } = useSelectedGenome();

  /**
   * The agent's own name on the bubble.
   *
   * It said "Ask Spark?" whatever the agent was called, which is the last place
   * naming your agent did not take effect. Unnamed — or with no brand selected,
   * which happens on the account screens — it still says Spark: that is the
   * product's agent (PRD §1), and it is the honest label when this brand's one
   * (§4) has no name yet.
   *
   * Cached per brand by the hook, because this component is mounted by the
   * shell on every screen and the name has usually been fetched already by the
   * banner or the rail. See `lib/useAgentIdentity.ts`.
   */
  const agent = useAgentIdentity(genome?.genomeId);
  const askLabel = agent.named ? `Ask ${agent.name}?` : 'Ask Spark?';
  const askTitle = genome
    ? `${agent.named ? `Ask ${agent.name}` : 'Ask Spark'} about ${genome.name}`
    : askLabel.replace(/\?$/, '');
  /**
   * A pinned drawer opens with the page.
   *
   * `useState` runs on the server too, where `localStorage` does not exist, so
   * the initial value is `false` and the effect below corrects it after mount —
   * initialising from storage directly would make the server and client
   * disagree and React would discard the markup.
   */
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isSparkPinned()) setOpen(true);
  }, []);

  /**
   * The cockpit's header lists Ask Spark as a primary action, and it opens *this*
   * drawer rather than mounting its own — see `lib/askSpark.ts` on why a second
   * `ChatDrawer` would be the wrong fix.
   *
   * Registered before the `/agents` early return would matter, because hooks
   * cannot be conditional. On that route the component returns null and never
   * renders a drawer, so the listener sets a flag nothing reads — harmless, and
   * cheaper than the alternative of hoisting the whole drawer.
   */
  useEffect(() => onAskSparkOpen(() => setOpen(true)), []);

  /*
    `/agents` used to return null outright — no Ask Spark in the Command
    Center's chrome at all, with the header collapsing from 99 to 89.7 and
    dragging the divider and page title up with it. Then it returned null unless
    the caller passed `delegate`, on the grounds that the screen owned its own
    `ChatDrawer` and two would be two conversations a keystroke apart.

    Both are gone. That second drawer was mounted by `CommandCenterOverview`, so
    it existed on one of the Command Center's four tabs and the shell's button
    was inert on the other three. This is the only drawer now, on every route,
    and `delegate` is kept only for a caller that wants the button without one.
  */

  const base = compact
    ? { block: 'h-[66.3px]', blockW: 185, orb: 'h-[66.3px] w-[66.3px]', orbPx: 66.3,
        bubbleW: 118.929, bubbleH: 44.362, bubbleLeft: 66.1, bubbleTop: 11.3,
        labelLeft: 96.3, labelTop: 24.5, labelCls: 'text-[13.21px]', charW: 7.35 }
    : { block: 'h-[70.2px]', blockW: 196, orb: 'h-[70.2px] w-[70.2px]', orbPx: 70.2,
        bubbleW: 126, bubbleH: 47, bubbleLeft: 70, bubbleTop: 12,
        labelLeft: 102, labelTop: 26, labelCls: 'text-14', charW: 7.8 };

  /**
   * The bubble grows for a longer name, and not otherwise.
   *
   * The design's bubble is a fixed 126x47 path and "Ask Spark?" very nearly
   * fills it, so a name of any length would have spilled out of the white
   * shape. Truncating to "Ask Christop…?" was the alternative and it reads
   * worse than the bug.
   *
   * `extra` is zero for a label no wider than the design's own, so the default
   * renders at exactly the measured geometry — the growth is opt-in by the
   * length of somebody's agent name. The width is estimated per character
   * rather than measured on a canvas: an estimate that can only be too generous
   * makes the bubble slightly wide in the worst case, which is invisible, while
   * a canvas measure would need the font loaded and would differ between the
   * server and the first client paint.
   */
  const DESIGN_LABEL = 'Ask Spark?';
  const extra = Math.max(0, Math.ceil((askLabel.length - DESIGN_LABEL.length) * base.charW));
  const S = {
    ...base,
    blockW: base.blockW + extra,
    bubbleW: base.bubbleW + extra,
  };

  return (
    <>
      {/*
        The bell rides with Ask Spark rather than being added to nineteen
        headers: this block is the one control every screen's chrome already
        renders, and the user's screenshot puts the bell immediately left of it.
        Right-anchored callers (Discovery pins this block to `right-35`) simply
        grow leftwards.
      */}
      <span className="flex shrink-0 items-center gap-[14px]">
      <NotificationBell compact={compact} />

      {/*
        196x70.2: the orb at 0,0 and a 126x47 bubble at 70,12, whose tail
        overlaps the orb by 0.2px — which is why the two are positioned rather
        than laid out with a gap. The label sits at 102,26 within the block, so
        32px into the bubble.
      */}
      <button
        type="button"
        onClick={() => (delegate ? openAskSpark() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={delegate ? undefined : open}
        aria-label={askTitle}
        title={askTitle}
        style={{ width: S.blockW }}
        className={cn(
          'relative shrink-0 border-0 bg-transparent p-0 text-left',
          S.block,
          'transition-transform hover:scale-[1.02] active:scale-[0.99]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          /* Below `md` the bubble is gone and the orb alone is the control, so
             the grown width must not survive into that breakpoint. */
          'max-md:!w-[52px] max-md:h-[52px]',
        )}
      >
        <span className={cn('absolute left-0 top-0 block max-md:h-[52px] max-md:w-[52px]', S.orb)}>
          <SparkMark variant="shell" size={S.orbPx} animated />
        </span>

        {/* Bubble and label drop below `md`, where the orb alone is the control. */}
        <svg
          width={S.bubbleW}
          height={S.bubbleH}
          viewBox="0 0 126 47"
          /* `none`, so the extra width lands on the flat middle of the shape
             instead of scaling the tail and the corner radii with it. */
          preserveAspectRatio="none"
          aria-hidden
          className="absolute block max-md:hidden"
          style={{ left: S.bubbleLeft, top: S.bubbleTop }}
        >
          <path
            d="M 9.159 7.596 C 9.159 3.401 12.56 0 16.755 0 L 113.493 0 C 120.4 0 126 5.6 126 12.507 L 126 34.493 C 126 41.4 120.4 47 113.493 47 L 20.305 47 C 14.181 47 9.246 41.979 9.353 35.856 L 9.361 35.382 C 9.408 32.652 8.322 30.025 6.36 28.126 C 2.742 24.623 2.345 18.956 5.439 14.982 L 7.557 12.262 C 8.596 10.929 9.159 9.286 9.159 7.596 Z"
            fill="#FFFFFF"
          />
        </svg>
        <span
          className={cn('absolute whitespace-nowrap font-semibold leading-[1.28] text-ink max-md:hidden', S.labelCls)}
          style={{ left: S.labelLeft, top: S.labelTop }}
        >
          {askLabel}
        </span>
      </button>
      </span>

      {delegate ? null : (
      <ChatDrawer
        genomeId={genome?.genomeId}
        open={open}
        onClose={() => setOpen(false)}
        onOpenDraft={(contentItemId) => {
          // Close first: the drawer is fixed-position, and leaving it mounted
          // across a route change means it animates in again over the new page.
          setOpen(false);
          // `/agents`, because that is where the draft panel lives.
          router.push(`/agents?draft=${encodeURIComponent(contentItemId)}`);
        }}
      />
      )}
    </>
  );
}
