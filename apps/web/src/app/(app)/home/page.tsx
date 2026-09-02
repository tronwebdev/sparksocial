import { BrandHome } from '@/components/dashboard/BrandHome';

/**
 * `DASH-B-01` — Brand Home (PRD §8.3), the screen `SparkSocial Dashboard.dc.html`
 * describes.
 *
 * `/` redirected to `/agents`, the Command Center, so a brand with no campaign
 * landed on a supervision screen for an agent that was not doing anything. §8.3
 * asks the opposite: lead with the one action that unblocks everything else, and
 * preview the rest.
 *
 * The header used to be assembled here — a `TopBar` with the brand switcher and
 * a user menu — while `BrandHome` rendered a second heading with the same
 * brand's name below it. `BrandHome` owns the whole header now, because every
 * part of it but the switcher is data this server component cannot see. The user
 * menu is gone from the header entirely: the prototypes reach account and
 * organization through the workspace switcher's "Account Home" row, not a second
 * avatar beside it.
 */
export default function BrandHomePage() {
  return <BrandHome />;
}
