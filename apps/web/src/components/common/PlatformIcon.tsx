import { platformLabel } from '@/lib/platforms';

/**
 * A platform's own mark — the icons the prototypes use, from
 * `ui build/assets/icons`, copied into `public/icons`.
 *
 * Every screen that names a platform was drawing initials in a circle ("IN",
 * "X") because no icon asset had been imported, while all six prototypes badge
 * the real mark: the queue rows at 492/523, the calendar cells, the rail's post
 * cards, the dashboard's Upcoming rows. Same five files, one component.
 *
 * ── Which marks exist ─────────────────────────────────────────────────────
 *
 * `platforms.ts` names fourteen platforms. Instagram, Facebook, LinkedIn and X
 * came from `ui build/assets/icons`; TikTok, YouTube, Pinterest, Reddit and
 * Google Business from the Social Accounts prototype's own tiles
 * (`ui build/figma-set/assets`). The design draws nothing for Threads or
 * Bluesky, so those two fall back to initials rather than a wrong logo — a
 * missing asset, not a missing case, and visible as such.
 *
 * `alt` is empty and the label goes on `title`: the platform is already written
 * next to the icon everywhere this is used, so announcing it twice is noise.
 */

/** `instagram_story` and `youtube_long` share their parent's mark. */
const MARKS: Record<string, { src: string; label: string }> = {
  instagram: { src: '/icons/ig-color.png', label: 'Instagram' },
  instagram_story: { src: '/icons/ig-color.png', label: 'Instagram' },
  facebook: { src: '/icons/fb-color.png', label: 'Facebook' },
  facebook_group: { src: '/icons/fb-color.png', label: 'Facebook' },
  linkedin: { src: '/icons/linkedin.png', label: 'LinkedIn' },
  x: { src: '/icons/x-logo.svg', label: 'X' },
  tiktok: { src: '/icons/tiktok.png', label: 'TikTok' },
  youtube_shorts: { src: '/icons/youtube.png', label: 'YouTube' },
  youtube_long: { src: '/icons/youtube.png', label: 'YouTube' },
  pinterest: { src: '/icons/pinterest.png', label: 'Pinterest' },
  reddit: { src: '/icons/reddit.png', label: 'Reddit' },
  google_business: { src: '/icons/google-business.png', label: 'Google Business' },
};

export function PlatformIcon({
  platform,
  size = 26.5,
  className,
}: {
  platform: string | undefined;
  /** The design uses 28 on the calendar table, 26.5 on queue rows, 16 in cells. */
  size?: number;
  className?: string;
}) {
  if (!platform) return null;
  const mark = MARKS[platform];

  if (!mark) {
    /* No asset for this one — the first two letters, which is what the build
       showed everywhere before these icons existed. */
    return (
      <span
        title={platformLabel(platform)}
        className={className}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'rgba(131,131,131,0.12)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: Math.round(size * 0.4),
          fontWeight: 600,
          textTransform: 'uppercase',
          color: 'var(--ss-fg-muted)',
          flexShrink: 0,
        }}
      >
        {platform.slice(0, 2)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- a fixed-size local
    // mark; `next/image` would add a loader and a layout wrapper for nothing.
    <img
      src={mark.src}
      alt=""
      title={mark.label}
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
    />
  );
}
