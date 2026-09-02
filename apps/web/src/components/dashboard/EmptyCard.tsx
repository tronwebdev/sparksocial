import Link from 'next/link';

/**
 * The dashboard's empty state, from the Figma state the `ui build` prototypes do
 * not contain — its cards are all populated, so this had to be read off a
 * screenshot of the design.
 *
 * Centred in the card: a grey glyph, "You don't have an active campaign" at
 * 19px/600, two lines of 14px grey beneath it, and a white "+ Create Campaign"
 * button with a thin ring. Every card that has nothing to show uses the same
 * block with a different glyph and second line — the activity feed, the
 * upcoming/insights/sales tabs, and the rail's published half.
 *
 * ── Why one component rather than each card's own ─────────────────────────
 *
 * They were each their own: a left-aligned heading and a paragraph, in three
 * different sizes, with `Empty` in `CockpitTabs` doing one version and the feed
 * and rail doing two more. The design has one. Sharing it is also the only way
 * the "no campaign" story stays consistent — all five of these cards are empty
 * for exactly the same reason, and saying it five different ways implies five
 * different problems.
 */
export function EmptyCard({
  glyph = 'document',
  body,
  title = "You don't have an active campaign",
  narrow,
}: {
  glyph?: 'document' | 'plane';
  /** The second line. The only part that differs between cards. */
  body: React.ReactNode;
  title?: string;
  /** The rail is 446px wide, so its text wraps earlier and its type is smaller. */
  narrow?: boolean;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span aria-hidden className="mb-6 block">
        {glyph === 'plane' ? <PlaneGlyph /> : <DocumentGlyph />}
      </span>

      <p
        className={
          narrow
            ? 'max-w-[15ch] text-[19px] font-semibold leading-[1.3] text-ink'
            : 'text-[19px] font-semibold leading-[1.3] text-ink'
        }
      >
        {title}
      </p>

      <p className={`mt-2 text-14 leading-[1.5] text-ink-muted ${narrow ? 'max-w-[30ch]' : 'max-w-[34ch]'}`}>
        {body}
      </p>

      {/* The same outline treatment as the header's Create Campaign, at the
          smaller size the card uses. */}
      <Link
        href="/calendar?new=1"
        className="mt-6 flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-14 font-medium text-ink transition-shadow hover:shadow-card"
        style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.35)' }}
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        Create Campaign
      </Link>
    </div>
  );
}

/** The page-with-a-magnifier the activity and content cards use. */
function DocumentGlyph() {
  return (
    <svg width="44" height="46" viewBox="0 0 44 46" fill="none" aria-hidden className="block">
      <path
        d="M7 4.5A2.5 2.5 0 0 1 9.5 2h16.4L37 13.1V38a2.5 2.5 0 0 1-2.5 2.5H9.5A2.5 2.5 0 0 1 7 38V4.5Z"
        fill="#C9CDD2"
      />
      <path d="M25.6 2.4V13h10.6" fill="#AEB4BA" />
      <circle cx="15.5" cy="30" r="7" fill="#6E7883" />
      <circle cx="15.5" cy="30" r="4" fill="#EDEFF2" />
      <path d="m20.4 34.6 5.2 5.2" stroke="#6E7883" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

/** The paper plane the rail's "Post published" half uses. */
function PlaneGlyph() {
  return (
    <svg width="46" height="44" viewBox="0 0 46 44" fill="none" aria-hidden className="block">
      <path d="M43 3 3 19.5l15.2 5.6L43 3Z" fill="#3B4148" />
      <path d="M43 3 18.2 25.1l3.1 15.6L43 3Z" fill="#20252B" />
    </svg>
  );
}
