'use client';

import { AgencyPortalScreen } from '@/components/agency/AgencyPortalScreen';

/**
 * `/agency` — `ui build/SparkSocial Agency Portal.dc.html`.
 *
 * In `(cc)` rather than `(app)`: this screen has no sidebar and no `TopBar`. It
 * carries its own wordmark, scope switch and profile pill, and unlike the other
 * full-bleed screens it is not on the shared 1698 card at all — see
 * `AgencyStage` for the geometry and why it scales rather than reflows.
 *
 * A client component at the page level because every part of this screen is
 * state: which view is showing, whether the agency has been launched, and how
 * tall the stage is as a result.
 */
export default function AgencyPortalPage() {
  return <AgencyPortalScreen />;
}
