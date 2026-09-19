'use client';

import { GovernancePanel } from './GovernancePanel';
import { KitSection } from './KitSection';
import { KnowledgePanel } from './KnowledgePanel';
import { OfferPanel } from './OfferPanel';
import { BrandTemplatesPanel } from './BrandTemplatesPanel';
import { ConsentPanel } from './ConsentPanel';
import { AvatarConfigPanel } from './AvatarConfigPanel';
import { LearningPanel } from './LearningPanel';
import { ApprovalModeControl } from '@/components/command-center/ApprovalModeControl';
import { AgentControlBar } from '@/components/command-center/AgentControlBar';

/**
 * `Settings WS Brand Kits` — the 3007-tall screen.
 *
 * ── The measurement that was wrong ────────────────────────────────────────
 *
 * This file used to describe the section cards as "a **dashed** r22.888
 * outline" and rendered them that way. The prototype has no dashed border
 * anywhere on the screen. Every section card is a **filled** rounded rect,
 * `rgb(243,244,248)`, radius 22.888, with no stroke — see `KitSection`, which
 * now owns that treatment and the evidence for it.
 *
 * A dashed outline reads as a placeholder or a drop target; a filled panel
 * reads as a settled group. Getting that backwards made the whole screen look
 * unfinished, and no amount of correct spacing would have fixed it.
 *
 * ── Measured, against the rendered design (page 1728 wide) ────────────────
 *
 *   content column   x367 … x1651, 1284 wide
 *   row 1            y281  626x322 at x367 and x1025 — logo · colour
 *   row 2            y630  626x272 on the same pitch — voice · type
 *   gutter 32, row gap 27
 *   knowledge        1284x822 at y1426, header 20/600 above it at y1382
 *   templates        1284x510 at y2272
 *
 * ── Why the panels inside are not rebuilt field by field ──────────────────
 *
 * Each group is a working panel with its own tool calls —
 * `brand.governance.set` for voice, colour and type, `knowledge.list` and
 * `brand.knowledge.attach*` for documents, `genome.offer.set` for the offer.
 * What the design contributes is the **grouping**, and `GovernancePanel` now
 * emits the design's four cards itself rather than one undifferentiated block,
 * because those four share a single draft and could not be split into four
 * components without four of them racing to save the same row.
 */

export function BrandKitsSection() {
  return (
    <div className="grid grid-cols-1 gap-[27px]">
      {/*
        Autonomy leads, because it decides whether anything below is reached
        without a person in the loop — the ordering the previous page argued for
        and which the design does not contradict.
      */}
      <div className="grid grid-cols-1 gap-[18px]">
        <ApprovalModeControl />
        <AgentControlBar />
      </div>

      {/*
        Not wrapped in a section: `GovernancePanel` emits the design's own four
        cards (Workspace logo · Color Theme · Brand Voice · Typography Style)
        plus Strict Compliance and Watermark. Wrapping it would put a panel
        inside a panel, which the design never does.
      */}
      <GovernancePanel />

      <KitSection
        title="Brand Knowledge"
        hint="What SPARK is allowed to claim. With nothing attached, guardrails hold every specific statement."
      >
        <div className="grid grid-cols-1 gap-[22px]">
          <KnowledgePanel />
          <OfferPanel />
        </div>
      </KitSection>

      <KitSection title="Templates" hint="The layouts a post is built into.">
        <BrandTemplatesPanel />
      </KitSection>

      <KitSection
        title="People and likeness"
        hint="Whose face and voice SPARK may use, and the consent behind it."
      >
        <div className="grid grid-cols-1 gap-[22px]">
          <ConsentPanel />
          <AvatarConfigPanel />
        </div>
      </KitSection>

      {/*
        Learning had its own `/settings/learning` route, which the design's seven
        sections have no slot for. Freezing what the mix has learned is a
        statement about how this brand's content behaves, so it belongs with the
        rest of that — the alternative was a section the design does not draw, or
        dropping a real control to make the nav match.
      */}
      <KitSection
        title="What this brand has learned"
        hint="The mix adapts from measured outcomes. Freezing it stops that without losing what is already known."
      >
        <LearningPanel />
      </KitSection>
    </div>
  );
}
