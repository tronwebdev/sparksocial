'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { PanelSkeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';

/**
 * `SET-WS-OVERVIEW` — the section the settings navigation needed and did not
 * have.
 *
 * The prototype's Overview shows brand identity, a compliance status and a
 * publishing-connection health line. It is a *summary* screen, which is a shape
 * worth being careful about: a summary that restates what the next screen says
 * anyway is a screen people learn to skip.
 *
 * So this answers only the questions you would otherwise have to open three
 * sections to ask — is my voice configured, is anything guarding what SPARK
 * says, and can it actually reach a platform — and links to the section that
 * changes each one rather than duplicating its controls.
 *
 * Every field comes from `brand.governance.get` and `integration.health`, both
 * reads that already existed and neither previously rendered together.
 */

/**
 * Every array is optional here even though `brand.governance.get`'s schema makes
 * them required.
 *
 * Not defensive coding for its own sake: an older API build genuinely answers
 * without the newer fields, and a *summary* screen that throws on one absent
 * key takes down the whole settings index — which is how this was found. The
 * screen's job is to report what it can see, including "I could not see this".
 */
interface Governance {
  brandId: string;
  restrictedTopics?: string[];
  claimsToAvoid?: string[];
  strictMode?: boolean;
  toneVector?: { formal: number; playful: number; technical: number; bold: number };
  bannedPhrases?: string[];
  logoUrl?: string;
  brandColors?: string[];
  timezone?: string;
  postingWindows?: number[];
  usingDefaultWindows?: boolean;
  engagementAutonomy?: 'off' | 'suggest' | 'auto';
  /** Set once the Engagement Intelligence flow has been walked to the end. */
  engagementConfiguredAt?: string;
  salesEscalationKeywords?: string[];
  /** Derived on read — see `packages/shared/src/agentIdentity.ts`. */
  agentIdentity?: { name: string; named: boolean; voice: string[]; riskTolerance: string; riskBecause: string };
}

interface Health {
  /** `integration.health` calls these `platforms`, and takes no input. */
  platforms?: { platform: string; connected: boolean; status: string }[];
}

const AUTONOMY_WORDS: Record<string, string> = {
  off: 'drafts only — you send every reply',
  suggest: 'queues replies for your approval',
  auto: 'sends the replies it judges safe',
};

export function OverviewPanel() {
  const { genome } = useSelectedGenome();
  const [gov, setGov] = useState<Governance | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const res = await invoke<Governance>('brand.governance.get', {});
      setLoading(false);
      if (res.status === 'succeeded') setGov(res.output);
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const res = await invoke<Health>('integration.health', {});
      if (res.status === 'succeeded') setHealth(res.output);
    })();
  }, [genome]);

  /**
   * "Guarded" needs all three of the things that actually stop a bad post:
   * something restricted, something claimed-against, and strict mode deciding
   * whether a hit blocks or merely flags. Reporting "compliant" on an empty
   * ruleset would be the most misleading line on the screen.
   */
  const voiceCount = gov?.agentIdentity?.voice.length ?? 0;
  const ruleCount = gov
    ? (gov.restrictedTopics?.length ?? 0) + (gov.claimsToAvoid?.length ?? 0) + (gov.bannedPhrases?.length ?? 0)
    : 0;
  const connected = health?.platforms?.filter((p) => p.connected).length ?? 0;
  // Expiring and expired are counted together here on purpose: on a summary the
  // actionable fact is "a connection needs you", and the section itself keeps
  // them visually distinct because "act soon" and "already broken" differ.
  const troubled =
    health?.platforms?.filter((p) => p.status === 'expiring' || p.status === 'expired').length ?? 0;

  return (
    <section aria-busy={loading} className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">Overview</h2>
      <p className="mt-1 max-w-2xl text-[13px] text-ink-muted">
        What is true of this brand right now. Each line links to the section that changes it.
      </p>

      {loading ? (
        // `aria-busy` on the section is what announces this; the skeleton itself
        // is decoration and is hidden from assistive tech.
        <PanelSkeleton rows={3} />
      ) : !gov ? (
        <p className="mt-4 text-[13px] text-ink-muted">
          Pick a brand from the switcher above to see its settings.
        </p>
      ) : (
        <dl className="mt-5 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
          {/* Spans both columns: it is the subject every row below describes. */}
          <div className="bg-surface p-4 sm:col-span-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-[13px] font-medium text-ink">
                {gov.agentIdentity?.named ? gov.agentIdentity.name : 'Your agent'}
              </dt>
              <Badge variant="neutral">{gov.agentIdentity?.riskTolerance ?? 'Moderate'} risk</Badge>
            </div>
            <dd className="mt-1 text-[12.5px] leading-snug text-ink-muted">
              {gov.agentIdentity?.voice.length
                ? `${gov.agentIdentity.voice.join(', ')}. `
                : 'No voice set, so it writes from the midpoint of every axis. '}
              {/* The risk level is a rendering of the approval mode, so saying
                  why keeps it from reading like a dial somebody can turn here. */}
              {gov.agentIdentity?.riskBecause ?? 'It publishes on its own once the first week is reviewed'}.{' '}
              <Link
                href="/settings/brand-kit"
                className="font-medium text-primary underline decoration-dotted underline-offset-2 hover:no-underline"
              >
                {gov.agentIdentity?.named ? 'Rename' : 'Give it a name'}
              </Link>
            </dd>
          </div>

          <Row
            label="Guardrails"
            href="/settings/brand-kit"
            badge={
              ruleCount === 0
                ? { text: 'Nothing set', tone: 'warn' }
                : { text: gov.strictMode ? 'Strict' : 'Flagging', tone: 'ok' }
            }
          >
            {ruleCount === 0
              ? 'No restricted topics, claims or banned phrases — nothing is checked before a post goes out.'
              : `${ruleCount} rule${ruleCount === 1 ? '' : 's'}, ${
                  gov.strictMode ? 'blocking a post that breaks one' : 'flagging a post that breaks one for review'
                }.`}
          </Row>

          {/* Decisiveness, not presence. A `toneVector` of four midpoints is a
              non-null object that says nothing, so testing for the object made
              this row claim "Set" while the identity above it said "No voice
              set" — two rows on one screen disagreeing about the same field.
              Both now read the derived words. */}
          <Row
            label="Voice"
            href="/settings/brand-kit"
            badge={
              voiceCount > 0
                ? { text: `${voiceCount} of 4 axes`, tone: 'ok' }
                : { text: 'Default', tone: 'warn' }
            }
          >
            {voiceCount > 0
              ? `${gov.agentIdentity?.voice.join(', ')} — and the copy writer reads these on every draft.`
              : 'Every slider is at its midpoint, so drafts use the default voice.'}
          </Row>

          <Row
            label="Brand kit"
            href="/settings/brand-kit"
            badge={
              gov.logoUrl || (gov.brandColors?.length ?? 0)
                ? { text: `${(gov.brandColors?.length ?? 0)} colour${(gov.brandColors?.length ?? 0) === 1 ? '' : 's'}`, tone: 'ok' }
                : { text: 'Defaults', tone: 'warn' }
            }
          >
            {gov.logoUrl || (gov.brandColors?.length ?? 0)
              ? 'Reaches actual pixels — rendered images and video use it.'
              : 'Rendered posts will use the default palette and carry no logo.'}
          </Row>

          <Row
            label="Answering your audience"
            href="/settings/engagement"
            /**
             * Two different facts, and the badge shows the one the owner is
             * asking about on an overview: have I set this up. The sentence below
             * still says what SPARK will actually do, because an unconfigured
             * brand is not an inert one — it drafts replies for a person to send.
             */
            badge={
              gov.engagementConfiguredAt
                ? { text: gov.engagementAutonomy ?? 'off', tone: gov.engagementAutonomy === 'off' ? 'neutral' : 'ok' }
                : { text: 'not set up', tone: 'neutral' }
            }
          >
            SPARK {AUTONOMY_WORDS[gov.engagementAutonomy ?? 'off'] ?? gov.engagementAutonomy ?? 'off'}
            {(gov.salesEscalationKeywords?.length ?? 0)
              ? `, and always escalates ${(gov.salesEscalationKeywords?.length ?? 0)} word${
                  (gov.salesEscalationKeywords?.length ?? 0) === 1 ? '' : 's'
                }.`
              : '. No escalation words set.'}
          </Row>

          <Row
            label="Publishing"
            href="/settings/connections"
            badge={
              !health
                ? { text: 'Unknown', tone: 'neutral' }
                : troubled > 0
                  ? { text: `${troubled} need${troubled === 1 ? 's' : ''} attention`, tone: 'warn' }
                  : connected > 0
                    ? { text: `${connected} connected`, tone: 'ok' }
                    : { text: 'None connected', tone: 'warn' }
            }
          >
            {!health
              ? 'Connection health could not be read.'
              : connected === 0
                ? 'Nothing is connected, so nothing can publish.'
                : troubled > 0
                  ? 'A token is expiring or expired. Scheduled posts will start failing silently.'
                  : 'Every connection is healthy.'}
          </Row>

          <Row label="Posting window" href="/settings/brand-kit" badge={{ text: gov.timezone ?? 'unknown', tone: 'neutral' }}>
            {gov.usingDefaultWindows
              ? `Default hours, in ${gov.timezone ?? 'UTC'}. Set your own if your audience is not typical.`
              : `${(gov.postingWindows?.length ?? 0)} chosen hour${(gov.postingWindows?.length ?? 0) === 1 ? '' : 's'}, in ${gov.timezone ?? 'UTC'}.`}
          </Row>
        </dl>
      )}
    </section>
  );
}

function Row({
  label,
  href,
  badge,
  children,
}: {
  label: string;
  href: string;
  badge: { text: string; tone: 'ok' | 'warn' | 'neutral' };
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <dt className="text-[13px] font-medium text-ink">{label}</dt>
        <Badge variant={badge.tone === 'ok' ? 'success' : badge.tone === 'warn' ? 'warn' : 'neutral'}>
          {badge.text}
        </Badge>
      </div>
      <dd className="mt-1 text-[12.5px] leading-snug text-ink-muted">
        {children}{' '}
        <Link
          href={href}
          className={cn(
            'font-medium text-primary underline decoration-dotted underline-offset-2 hover:no-underline',
          )}
        >
          Change
        </Link>
      </dd>
    </div>
  );
}
