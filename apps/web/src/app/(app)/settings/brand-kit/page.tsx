import { GovernancePanel } from '@/components/settings/GovernancePanel';
import { BrandTemplatesPanel } from '@/components/settings/BrandTemplatesPanel';
import { KnowledgePanel } from '@/components/settings/KnowledgePanel';
import { OfferPanel } from '@/components/settings/OfferPanel';
import { ConsentPanel } from '@/components/settings/ConsentPanel';
import { AvatarConfigPanel } from '@/components/settings/AvatarConfigPanel';

/**
 * `SET-WS-BRAND-KITS`. Everything that decides what a post *sounds and looks*
 * like: voice, guardrails, logo and colours, what SPARK knows, what it may
 * offer, and whose face and voice it may use.
 *
 * `GovernancePanel` leads because it is the one that changes what SPARK is
 * allowed to say. `KnowledgePanel` sits second because it changes what SPARK is
 * allowed to *claim*: with nothing attached, `guard.claim_grounding` holds every
 * specific statement.
 *
 * Consent sits here rather than under Team Roles on purpose — a consent record
 * is about a person appearing *in the brand's media*, not about their access.
 */
export default function BrandKitSettings() {
  return (
    <>
      <GovernancePanel />
      {/*
        Straight after governance, because the watermark control lives there and
        these are the other half of the same screen: governance decides how a
        post looks, templates decide the lines it reuses.
      */}
      <BrandTemplatesPanel />
      <KnowledgePanel />
      <OfferPanel />
      <ConsentPanel />
      <AvatarConfigPanel />
    </>
  );
}
