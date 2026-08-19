'use client';

import { cn } from '@/lib/utils';

/**
 * "Or continue with" — Google, Facebook, X.
 *
 * These require the matching providers to be enabled in the Clerk dashboard;
 * without that, Clerk returns a 400 and the button appears broken. The screens
 * surface that failure rather than swallowing it.
 */
export type OAuthStrategy = 'oauth_google' | 'oauth_facebook' | 'oauth_x';

const PROVIDERS: Array<{ strategy: OAuthStrategy; label: string; icon: React.ReactNode }> = [
  {
    strategy: 'oauth_google',
    label: 'Google',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
        <path fill="#4285F4" d="M19.6 10.23c0-.68-.06-1.34-.18-1.96H10v3.72h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.74 2.98-4.3 2.98-7.28Z" />
        <path fill="#34A853" d="M10 20c2.7 0 4.96-.9 6.62-2.43l-3.24-2.5c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.76-5.6-4.12H1.07v2.58A10 10 0 0 0 10 20Z" />
        <path fill="#FBBC05" d="M4.4 11.9a6 6 0 0 1 0-3.82V5.5H1.07a10 10 0 0 0 0 9l3.33-2.6Z" />
        <path fill="#EA4335" d="M10 3.96c1.47 0 2.79.5 3.83 1.5l2.87-2.87C14.96.99 12.7 0 10 0A10 10 0 0 0 1.07 5.5L4.4 8.08C5.2 5.72 7.4 3.96 10 3.96Z" />
      </svg>
    ),
  },
  {
    strategy: 'oauth_facebook',
    label: 'Facebook',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
        <path
          fill="#1877F2"
          d="M20 10a10 10 0 1 0-11.56 9.88v-6.99H5.9V10h2.54V7.8c0-2.5 1.49-3.89 3.77-3.89 1.1 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V10h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 20 10Z"
        />
      </svg>
    ),
  },
  {
    strategy: 'oauth_x',
    label: 'X',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
        <path
          fill="#0C0C0C"
          d="M18.9 1.15h3.68l-8.05 9.2L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.46l8.6-9.83L0 1.15h7.6l5.24 6.93ZM17.6 20.64h2.04L6.49 3.24H4.3Z"
        />
      </svg>
    ),
  },
];

/**
 * Which providers this Clerk instance can actually complete.
 *
 * Rendering a button for a provider the instance has not enabled produces a
 * dead control: the click reaches Clerk and fails, and the user has no way to
 * know it was never going to work. The prototype draws three; only the ones
 * turned on in **Clerk → User & Authentication → Social Connections** function.
 *
 * Read from the environment rather than hardcoded so enabling Facebook or X in
 * the Clerk dashboard is a one-line config change here, not a code change.
 * Defaults to Google alone, which is the only provider a fresh Clerk
 * development instance ships enabled.
 */
const ENABLED: ReadonlySet<string> = new Set(
  (process.env.NEXT_PUBLIC_SOCIAL_PROVIDERS ?? 'google')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

export function SocialRow({
  onSelect,
  disabled,
  className,
}: {
  onSelect: (strategy: OAuthStrategy) => void;
  disabled?: boolean;
  className?: string;
}) {
  const providers = PROVIDERS.filter((p) => ENABLED.has(p.strategy.replace(/^oauth_/, '')));

  // Nothing enabled: drop the whole row rather than leave a bare "Or continue
  // with" divider above no buttons.
  if (providers.length === 0) return null;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[14px] text-ink-muted">Or continue with</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="flex gap-3">
        {providers.map((p) => (
          <button
            key={p.strategy}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(p.strategy)}
            aria-label={`Continue with ${p.label}`}
            className={cn(
              'flex h-[56px] flex-1 items-center justify-center gap-2 rounded-lg bg-input',
              'text-[16px] font-medium text-ink transition-colors hover:bg-surface-muted',
              'focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            {p.icon}
            <span className="max-sm:hidden">{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
