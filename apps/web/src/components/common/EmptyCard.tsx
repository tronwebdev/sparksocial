import { SparkMark } from '@/components/brand/SparkMark';
import Link from 'next/link';

/**
 * The dashboard's empty state, from the Figma state the `ui build` prototypes do
 * not contain — its cards are all populated, so this had to be read off a
 * screenshot of the design.
 *
 * Centred in the card: SPARK asleep (it was a grey glyph until the mark gained
 * moods, then the mark with that glyph on a badge), "You don't have an active campaign" at
 * 19px/600, two lines of 14px grey beneath it, and a white "+ Create Campaign"
 * button with a thin ring. Every card that has nothing to show uses the same
 * block with its own title and second line.
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
 * and rail doing two more. The design has one.
 *
 * ── `title` is required, and that is the point ────────────────────────────
 *
 * It used to default to "You don't have an active campaign", on the reasoning
 * that all of these cards are empty for the same reason. They are not. The
 * calendar is the only one that actually tests for a campaign; the others test
 * for agent runs, scheduled posts, published posts and leads. A brand with a
 * live campaign, a generated calendar and drafted posts saw four panels telling
 * it to create the campaign it already had — and pointing at a button that
 * would do nothing about the real cause.
 *
 * Reported by an owner whose campaign was running. The headline was the only
 * part of the card that was wrong, which is what made it convincing.
 *
 * So the caller must say what is empty. Inheriting a headline is how one card's
 * sentence ended up asserting something false on four screens that never
 * checked it.
 */
export function EmptyCard({
  body,
  title,
  narrow,
  action = { label: 'Create Campaign', href: '/home?new=1' },
}: {
  /** The second line — what will fill this card, and how. */
  body: React.ReactNode;
  /** What is actually empty. Required: see the note above on inherited headlines. */
  title: string;
  /** The rail is 446px wide, so its text wraps earlier and its type is smaller. */
  narrow?: boolean;
  /** The one step that changes this state. Defaults to starting a campaign. */
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {/* SPARK, asleep — there is nothing here for it to do yet. The mark
          alone: it used to carry a white badge with the card's glyph on it,
          and two pictures side by side read as clutter rather than as one
          state. The title says what is missing. */}
      <SparkMark size={84} mood="asleep" decorative className="mb-6" />

      <p
        className={
          narrow
            ? 'max-w-[15ch] text-19 font-semibold leading-[1.3] text-ink'
            : 'text-19 font-semibold leading-[1.3] text-ink'
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
