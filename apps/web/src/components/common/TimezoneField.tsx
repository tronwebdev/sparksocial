'use client';

import type { ReactElement } from 'react';
import { regionOf, timezoneRegions, zoneLabel, zonesIncluding, zonesInRegion } from '@sparksocial/shared';

/**
 * REGION + ZONE, covering every zone the runtime knows.
 *
 * ── What this replaces ───────────────────────────────────────────────────
 *
 * Four screens each held their own eighteen-entry array. Between them they
 * reached five regions, and the first select was labelled **Country** while
 * its options were IANA region prefixes — so a brand in Karachi, Jakarta,
 * Mexico City, Istanbul or Seoul had no way to say where it was, and everyone
 * else was answering a question the label was not asking.
 *
 * This is not cosmetic. `campaign.calendar` passes the stored zone straight to
 * `Intl` as `timeZone`, so it is the zone every scheduled post is placed in:
 * a brand that could not state its own zone had its week laid out in somebody
 * else's.
 *
 * ── Why it still says Region ─────────────────────────────────────────────
 *
 * Because a correct country-to-zone mapping is a dataset, and the platform API
 * that would supply it (`Intl.Locale.prototype.getTimeZones`) is missing from
 * Safari and from the Node this repo builds on. See `packages/shared/src/
 * timezones.ts` for the full reasoning. The design's two-select shape is kept;
 * the label is corrected to the question the control actually asks.
 */
export function TimezoneField({
  value,
  onChange,
  Select,
  regionLabel = 'Region',
  zoneLabelText = 'Timezone',
}: {
  value: string;
  onChange: (zone: string) => void;
  /**
   * The screen's own select, passed in rather than imported.
   *
   * Onboarding's `SmallSelect` and Settings' field are measured off different
   * designs at different sizes. Sharing the *logic* without forcing one screen
   * into the other's dimensions is the whole point; a shared control that
   * carried its own styling would have been rejected by whichever design it
   * did not match.
   */
  Select: (props: {
    value: string;
    onChange: (v: string) => void;
    options: ReadonlyArray<{ value: string; label: string }>;
    ariaLabel: string;
    placeholder?: string;
  }) => ReactElement;
  regionLabel?: string;
  zoneLabelText?: string;
}) {
  // `zonesIncluding` so a stored `Etc/*` alias — which `supportedValuesOf`
  // omits but `resolvedOptions()` returns — is still selectable rather than
  // leaving the control blank and rewriting the brand's zone on first touch.
  const zones = zonesIncluding(value || undefined);
  const regions = timezoneRegions(zones);
  const region = value ? regionOf(value) : (regions[0] ?? 'UTC');
  const inRegion = zonesInRegion(region, zones);

  return (
    <>
      <Select
        ariaLabel={regionLabel}
        value={region}
        onChange={(next) => {
          /*
           * Move to the first zone in the new region, so the pair is never
           * left describing two different places.
           *
           * `UTC` is the awkward one: it is a zone with no region members, so
           * selecting it must store `UTC` itself. The previous version
           * searched for something starting `UTC/`, found nothing, and fell
           * back to the old value — the option was visibly offered and
           * silently unselectable.
           */
          const members = zonesInRegion(next, zones);
          onChange(members[0] ?? next);
        }}
        options={regions.map((r) => ({ value: r, label: r }))}
      />
      <Select
        ariaLabel={zoneLabelText}
        value={value}
        placeholder="Select"
        onChange={onChange}
        /* A region with no sub-zones is itself the only choice. */
        options={(inRegion.length > 0 ? inRegion : [region]).map((z) => ({
          value: z,
          label: zoneLabel(z),
        }))}
      />
    </>
  );
}
