import type { NotificationTopic } from '@/lib/notifications';

/**
 * One icon and one colour per topic, shared by the toast and the centre.
 *
 * There is no `.dc.html` for either surface — the screens the user supplied are
 * the design source, and the Account Home prototype's bell only toasts
 * "Notification center — mock". So the tiles are built to those screenshots:
 * a 44px rounded square, a tint of the topic's colour behind a line glyph, and
 * red reserved for the one topic that is a failure.
 *
 * `generic` exists so a message written before topics did still renders as
 * something, rather than as a hole where an icon should be.
 */

export interface TopicVisual {
  tint: string;
  ink: string;
  icon: React.ReactNode;
  /** Whether this topic is worth an action button when it carries a target. */
  actionable: boolean;
}

const bell = (
  <>
    <path d="M9 2.6a5 5 0 0 0-5 5c0 3.2-1.2 4.2-1.2 4.2h12.4S14 10.8 14 7.6a5 5 0 0 0-5-5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M10.5 14.4a1.7 1.7 0 0 1-3 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </>
);

export const TOPIC: Record<NotificationTopic, TopicVisual> = {
  content_ready: {
    tint: 'rgba(108,232,255,0.20)',
    ink: '#2F8291',
    actionable: true,
    icon: (
      <>
        <rect x="2" y="3" width="14" height="12" rx="3" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="6.4" cy="7.2" r="1.4" stroke="currentColor" strokeWidth="1.3" />
        <path d="m3.4 13 3.6-3.6a1.6 1.6 0 0 1 2.2 0l4.2 4.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
  },
  published: {
    tint: 'rgba(34,177,76,0.16)',
    ink: '#1E8C42',
    actionable: true,
    icon: (
      <>
        <path d="M16 2 8.4 9.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M16 2l-5 14-2.6-6.4L2 7l14-5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </>
    ),
  },
  failed: {
    tint: 'rgba(243,85,37,0.14)',
    ink: '#C23E14',
    actionable: true,
    icon: (
      <>
        <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5" />
        <path d="M9 5.4v4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="9" cy="12.4" r="0.95" fill="currentColor" />
      </>
    ),
  },
  queued: {
    tint: 'rgba(131,131,131,0.16)',
    ink: '#4A4A4A',
    actionable: false,
    icon: (
      <>
        <path d="M3 5h12M3 9h12M3 13h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
  },
  connection: {
    tint: 'rgba(180,118,42,0.16)',
    ink: '#B4762A',
    actionable: false,
    icon: (
      <>
        <path d="M7 11 5.2 12.8a2.9 2.9 0 0 1-4.1-4.1L3 6.8M11 7l1.8-1.8a2.9 2.9 0 0 1 4.1 4.1L15 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" transform="translate(0 -0.5)" />
        <path d="m6.6 11.4 4.8-4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
  },
  generic: {
    tint: 'rgba(131,131,131,0.14)',
    ink: '#5B5B5B',
    actionable: false,
    icon: bell,
  },
};

export function TopicTile({ topic, size = 44 }: { topic: NotificationTopic; size?: number }) {
  const v = TOPIC[topic] ?? TOPIC.generic;
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-[12px]"
      style={{ width: size, height: size, background: v.tint, color: v.ink }}
    >
      <svg width={size * 0.43} height={size * 0.43} viewBox="0 0 18 18" fill="none">
        {v.icon}
      </svg>
    </span>
  );
}
