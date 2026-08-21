/**
 * One name per platform, for every screen that shows one.
 *
 * This existed three times — in `PublishHealthPanel`, `CampaignWizard` and
 * `ConnectAccountsStep` — and two of the copies covered only the five native
 * platforms. `integration.health` returns all fourteen, so Settings listed
 * `youtube_long`, `facebook_group` and `google_business` as raw enum values
 * beside a properly-named "YouTube Shorts", and onboarding's refusal message
 * read "instagram is not connected". The map itself was never wrong; having
 * three of it was.
 *
 * Kept as a hand-written record rather than derived from `Platform`, because
 * `apps/web` imports `@sparksocial/shared` and nothing else from `packages/`
 * (CLAUDE.md) and the enum lives in `packages/publish`. `platformLabel` is
 * therefore the seam that has to fail well: a platform added to the enum and
 * not to this map should read as words, not as a token.
 */
const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  instagram_story: 'Instagram Stories',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  x: 'X',
  youtube_shorts: 'YouTube Shorts',
  youtube_long: 'YouTube',
  facebook: 'Facebook',
  facebook_group: 'Facebook Groups',
  threads: 'Threads',
  pinterest: 'Pinterest',
  google_business: 'Google Business',
  reddit: 'Reddit',
  bluesky: 'Bluesky',
};

/**
 * The name to show a person for a `content_items.platform` value.
 *
 * Unknown values are prettified rather than passed through: `snake_case` in a
 * sentence is the tell that a screen is printing a database value, and a new
 * platform reaching the UI before this map is a missing name, not an error
 * worth blanking the row for.
 */
export function platformLabel(platform: string): string {
  const known = PLATFORM_LABEL[platform];
  if (known) return known;
  return platform
    .split('_')
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}
