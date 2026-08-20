import type { SVGProps } from 'react';

/**
 * Lifted verbatim from `ui build/SparkSocial Dashboard.dc.html:540-547`.
 *
 * Every stroke and fill is `currentColor`, which is why active/inactive state in
 * `SidebarNav` is a single `text-*` class rather than two icon variants.
 */

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 26,
  height: 26,
  fill: 'none',
  'aria-hidden': true,
  ...props,
});

export function AgentsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 26 26" {...base(props)}>
      <circle cx="10" cy="6.5" r="3" stroke="currentColor" strokeWidth="2" />
      <path d="M4.4 15c1.6-1.6 3.5-2.4 5.6-2.4s4 .8 5.6 2.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M2.5 20h9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="m19.5 13.5 1.1 3 3 1.1-3 1.1-1.1 3-1.1-3-3-1.1 3-1.1 1.1-3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DiscoveryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 26 26" {...base(props)}>
      <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
      <path d="m17 17 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="m7.5 12.8 2.4-2.7 2 1.7 2.6-3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.5 8.8h1.6v1.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CalendarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 26 26" {...base(props)}>
      <rect x="2.8" y="4.4" width="20.4" height="19" rx="4" stroke="currentColor" strokeWidth="2" />
      <path d="M3 10.2h20M8.4 2v4M17.6 2v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="m13 13.2.9 1.9 2.1.3-1.5 1.5.4 2.1-1.9-1-1.9 1 .4-2.1-1.5-1.5 2.1-.3.9-1.9Z" fill="currentColor" />
    </svg>
  );
}

export function AutomationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 27 27" {...base(props)}>
      <path d="M14.5 12.5 22 5c1.4-1.4 3.6.8 2.2 2.2l-7.5 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M13 14 5.5 21.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <rect
        x="11.4"
        y="11.4"
        width="4.6"
        height="4.6"
        rx="1.4"
        transform="rotate(45 13.7 13.7)"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M5 3.5v3.4M3.3 5.2h3.4M22 18.5v3M20.5 20h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function EngagementIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 26 26" {...base(props)}>
      <path
        d="M21.6 13.5a8.6 8.6 0 1 1-2.5-6.1M21.9 3.5v4.2h-4.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="m12.6 9.4.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" fill="currentColor" />
    </svg>
  );
}

export function AssetsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 26 25" {...base(props)}>
      <path
        d="M2.5 6.7c0-1.6 1.3-2.9 2.9-2.9h4.3l2.6 2.9h8.3c1.6 0 2.9 1.3 2.9 2.9v9.7c0 1.6-1.3 2.9-2.9 2.9H5.4a2.9 2.9 0 0 1-2.9-2.9V6.7Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M13 11v6M10 14h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 26 26" {...base(props)}>
      <circle cx="13" cy="13" r="4.4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M13 2v3.2M13 20.8V24M24 13h-3.2M5.2 13H2M20.8 5.2l-2.3 2.3M7.5 18.5l-2.3 2.3M20.8 20.8l-2.3-2.3M7.5 7.5 5.2 5.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * `DASH-B-01`'s nav icon. Same 26×26 grid and `currentColor` convention as the
 * icons lifted from the prototype — the prototype has no Home row, because the
 * screen it leads to did not exist.
 */
export function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 26 26" {...base(props)}>
      <path
        d="M4 11 13 4l9 7v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 4 20v-9Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M10.5 21.5v-6h5v6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

/** `DASH-A-01`'s nav icon — the org level, drawn as a set of workspaces rather than a person. */
export function AccountIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 26 26" {...base(props)}>
      <rect x="3.5" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <rect x="14.5" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <rect x="3.5" y="14.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <path d="M18.5 15v7M15 18.5h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
