import { DiscoveryScreenChrome } from '@/components/discovery/DiscoveryScreenChrome';
import { DiscoveryFeed } from '@/components/discovery/DiscoveryFeed';

/**
 * Discovery (PRD §8.9, `DISC-01`/`DISC-02`) — trends worth acting on, per
 * `trend.rank`'s ranking and `trend.repurpose`'s suggestions.
 *
 * In `(cc)` rather than `(app)`: `SparkSocial Discovery.dc.html` is full-bleed
 * on the same 1698-wide card as the Calendar and Command Center, with no
 * sidebar and no `TopBar`. The route group changes no URL — this is still
 * `/discovery`.
 */
export default function DiscoveryPage() {
  return (
    <DiscoveryScreenChrome
      title="Trend Discovery"
      subtitle="Easily uncover the latest trends with our intuitive Trend Discovery feature."
    >
      <DiscoveryFeed />
    </DiscoveryScreenChrome>
  );
}
