import Link from 'next/link';

/**
 * The dashboard's empty state, from the Figma state the `ui build` prototypes do
 * not contain — its cards are all populated, so this had to be read off a
 * screenshot of the design.
 *
 * Centred in the card: a grey glyph, "You don't have an active campaign" at
 * 19px/600, two lines of 14px grey beneath it, and a white "+ Create Campaign"
 * button with a thin ring. Every card that has nothing to show uses the same
 * block with a different glyph and second line.
 *
 * ── `action`, and why every empty card has one ────────────────────────────
 *
 * The button was hardcoded to Create Campaign, which is right for the dashboard
 * and the Command Center's Overview and wrong for the two cards whose blocker
 * is something else. It is a prop now, and it is **not** optional: a card that
 * says "there is nothing here" and offers no way to change that is a dead end,
 * and the plain-text empty states this replaced were exactly that — five
 * screens where the honest next step existed and nothing linked to it.
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
  action = { label: 'Create Campaign', href: '/home?new=1' },
}: {
  glyph?: 'document' | 'plane' | 'chat' | 'chart';
  /** The second line. The only part that differs between cards. */
  body: React.ReactNode;
  title?: string;
  /** The rail is 446px wide, so its text wraps earlier and its type is smaller. */
  narrow?: boolean;
  /** The one step that changes this state. Defaults to starting a campaign. */
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span aria-hidden className="mb-6 block">
        {glyph === 'plane' ? (
          <PlaneGlyph />
        ) : glyph === 'chat' ? (
          <ChatGlyph />
        ) : glyph === 'chart' ? (
          <ChartGlyph />
        ) : (
          <DocumentGlyph />
        )}
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
        href={action.href}
        className="mt-6 flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-14 font-medium text-ink transition-shadow hover:shadow-card"
        style={{ boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.35)' }}
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {action.label}
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

/** The speech bubbles the engagement cards use. */
function ChatGlyph() {
  return (
    <svg width="46" height="44" viewBox="0 0 46 44" fill="none" aria-hidden className="block">
      <path d="M3 8.5A3.5 3.5 0 0 1 6.5 5h24A3.5 3.5 0 0 1 34 8.5v13a3.5 3.5 0 0 1-3.5 3.5H14l-8 6.5V25H6.5A3.5 3.5 0 0 1 3 21.5v-13Z" fill="#C9CDD2" />
      <path d="M18 20.5A3.5 3.5 0 0 1 21.5 17h18A3.5 3.5 0 0 1 43 20.5v10a3.5 3.5 0 0 1-3.5 3.5H38v5.5L31 34h-9.5A3.5 3.5 0 0 1 18 30.5v-10Z" fill="#6E7883" />
    </svg>
  );
}

/** Bars, for the cards that are waiting on measured performance. */
function ChartGlyph() {
  return (
    <svg width="46" height="44" viewBox="0 0 46 44" fill="none" aria-hidden className="block">
      <rect x="3" y="26" width="9" height="15" rx="2" fill="#C9CDD2" />
      <rect x="15.5" y="16" width="9" height="25" rx="2" fill="#6E7883" />
      <rect x="28" y="21" width="9" height="20" rx="2" fill="#C9CDD2" />
      <path d="M3 11 13 6l9 4 11-6" stroke="#6E7883" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
