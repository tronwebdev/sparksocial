'use client';

import type { ReactNode } from 'react';
import { GovernancePanel } from './GovernancePanel';
import { KnowledgePanel } from './KnowledgePanel';
import { OfferPanel } from './OfferPanel';
import { BrandTemplatesPanel } from './BrandTemplatesPanel';
import { ConsentPanel } from './ConsentPanel';
import { AvatarConfigPanel } from './AvatarConfigPanel';
import { LearningPanel } from './LearningPanel';
import { ApprovalModeControl } from '@/components/command-center/ApprovalModeControl';
import { AgentControlBar } from '@/components/command-center/AgentControlBar';

/**
 * `Settings WS Brand Kits` — the 3007-tall screen, and the one whose structure
 * matters more than its internals.
 *
 * Measured off the prototype, relative to the 1350 content card:
 *
 *   rules        y 111 / 785 / 1208 · 1350x1
 *   row 1        y138 — "Workspace logo" 626 wide at x30, "Color Theme" at x688
 *   row 2        y487 — "Brand Voice" and "Typography Style" on the same pitch
 *   section box  626x322 (and 626x272 on row 2), a **dashed** r22.888 outline
 *   title        20/500 at +23,+19 inside each box
 *   knowledge    header 20/600 at 53,1239; its own dashed 1284x822 box at 30,1283
 *   templates    header 20/600 at 58,2151
 *
 * ── Why the panels inside are not rebuilt ─────────────────────────────────
 *
 * Each of these groups is already a working panel with its own tool calls —
 * `brand.governance.set` for voice, colours and fonts, `knowledge.list` and
 * `brand.knowledge.attach*` for documents, `genome.offer.set` for the offer.
 * The design's contribution here is the **grouping**: four named areas in
 * dashed cards, in a fixed order, rather than one undifferentiated stack of ten
 * panels — which is what this screen was.
 *
 * So this supplies the design's section shell and the order, and leaves each
 * panel's internals alone. Rebuilding a working `GovernancePanel` field by
 * field to move its heading 3px would trade real behaviour for a screenshot.
 */

/** The design's dashed section box: r22.888, a 1px dashed hairline, 20/500 title. */
function KitSection({
  title,
  hint,
  className,
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={className}
      style={{
        borderRadius: 22.888,
        border: '1px dashed rgba(131,131,131,0.45)',
        padding: '19px 23px 23px',
      }}
    >
      <h3 className="text-20 font-medium leading-[1.3] text-ink">{title}</h3>
      {hint ? (
        <p className="mt-[6px] text-16" style={{ color: 'rgb(131,131,131)' }}>
          {hint}
        </p>
      ) : null}
      <div className="mt-[18px]">{children}</div>
    </section>
  );
}

/** The design's full-width rule between groups. */
function KitRule() {
  return <div aria-hidden className="h-px w-full" style={{ background: 'rgba(131,131,131,0.25)' }} />;
}

export function BrandKitsSection() {
  return (
    <div className="grid grid-cols-1 gap-[28px]">
      {/*
        Autonomy leads, because it decides whether anything below is reached
        without a person in the loop — the ordering the previous page argued for
        and which the design does not contradict.
      */}
      <div className="grid grid-cols-1 gap-[18px]">
        <ApprovalModeControl />
        <AgentControlBar />
      </div>

      <KitRule />

      {/*
        Rows 1 and 2 of the design are four dashed boxes two-up. `GovernancePanel`
        owns the logo, the colours, the voice and the fonts in one component, so
        it fills this group rather than being split four ways — splitting it
        would mean four components sharing one `brand.governance.set` draft.
      */}
      <KitSection
        title="Workspace logo, colour and voice"
        hint="How every post looks and sounds — the logo, the palette, the type, and the tone SPARK writes in."
      >
        <GovernancePanel />
      </KitSection>

      <KitRule />

      <KitSection
        title="Brand Knowledge"
        hint="What SPARK is allowed to claim. With nothing attached, guardrails hold every specific statement."
      >
        <div className="grid grid-cols-1 gap-[22px]">
          <KnowledgePanel />
          <OfferPanel />
        </div>
      </KitSection>

      <KitRule />

      <KitSection title="Templates" hint="The layouts a post is built into.">
        <BrandTemplatesPanel />
      </KitSection>

      <KitRule />

      <KitSection
        title="People and likeness"
        hint="Whose face and voice SPARK may use, and the consent behind it."
      >
        <div className="grid grid-cols-1 gap-[22px]">
          <ConsentPanel />
          <AvatarConfigPanel />
        </div>
      </KitSection>

      <KitRule />

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
