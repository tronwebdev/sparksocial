'use client';

import { useRouter } from 'next/navigation';
import { CampaignWizard } from '@/components/campaign/CampaignWizard';
import { useSelectedGenome } from '@/lib/useSelectedGenome';

/**
 * `/campaign/new` — `ui build/SparkSocial Create Campaign.dc.html`, entered at
 * its own default state: the "Your agent is ready!" card.
 *
 * In `(cc)` rather than `(app)`: the prototype is a full-bleed modal over a
 * blurred backdrop with no sidebar and no page header, and its own Back button
 * is the only navigation. The route group changes no URL.
 *
 * The same component is mounted from the calendar without `showIntro`, which is
 * the one difference between the two ways in — there, a person has already
 * pressed "New campaign" and does not need to be asked again.
 *
 * Both exits go to the Command Center, as the prototype's do: "Setup Later" and
 * Back leave without writing anything, and activating hands over the campaign
 * that was just created.
 */
export default function NewCampaignPage() {
  const router = useRouter();
  const { genome, loading, error } = useSelectedGenome();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-16 text-ink-muted">Loading your brand…</p>
      </main>
    );
  }

  if (!genome) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <p className="max-w-md text-center text-16 text-ink-muted">
          {error ?? 'A brand has to exist before it can run a campaign.'}
        </p>
      </main>
    );
  }

  return (
    <CampaignWizard
      genomeId={genome.genomeId}
      showIntro
      onActivated={() => router.push('/agents')}
      onCancel={() => router.push('/agents')}
    />
  );
}
