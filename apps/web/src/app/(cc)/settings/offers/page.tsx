import { SettingsShell } from '@/components/settings/SettingsShell';
import { OffersSection } from '@/components/settings/OffersSection';

/**
 * `/settings/offers` — what the brand sells, and the line that asks for it.
 *
 * Not one of the prototype's seven brand sections. It is here because the data
 * has always had room for it and nothing could reach it: `GenomeOffer.products`
 * is an array no screen could write, and `primary_cta` was only settable from
 * the campaign wizard's missing-facts prompt — which appears mid-wizard and is
 * gone once answered.
 */
export default function OffersPage() {
  return (
    <SettingsShell heading="Offers & CTA">
      <OffersSection />
    </SettingsShell>
  );
}
