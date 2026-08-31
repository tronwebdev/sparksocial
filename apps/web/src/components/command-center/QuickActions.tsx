'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * QUICK ACTIONS — part of `F1`'s shell.
 *
 * The Command Center prototype keeps a persistent cluster beside the agent:
 * Chat with Spark, Drafts List, Agent Calendar, Performance & Learning, Active
 * Campaigns. Every destination already exists in the build; what was missing was
 * one place that offers them, which is why eighteen draft-panel prototypes all
 * render it.
 *
 * ── Two of the five are on this page, and that is the point ───────────────
 *
 * Drafts and Performance are panels further down this same screen, and it would
 * be reasonable to leave them out on the grounds that scrolling exists. The
 * prototype includes them, and it is right to: this screen is long, and "where
 * is the draft I was working on" should not be answered by scrolling past a
 * campaign card and two queues. They scroll to the panel; the rest navigate.
 *
 * ── Why anchors rather than buttons ───────────────────────────────────────
 *
 * Everything here is a destination, so everything here is a link — which means
 * middle-click, open-in-new-tab and the browser's own back button all work
 * without this component knowing about any of them. A cluster of `onClick`
 * handlers would silently break all three.
 */

interface Action {
  label: string;
  href: string;
  hint: string;
  /** Set for the two that live on this page — see the header. */
  local?: boolean;
}

const ACTIONS: Action[] = [
  { label: 'Chat with Spark', href: '#chat', hint: 'Ask it to do something', local: true },
  { label: 'Drafts list', href: '#drafts', hint: 'Everything in flight', local: true },
  { label: 'Agent calendar', href: '/calendar', hint: 'The month it has planned' },
  { label: 'Performance & learning', href: '#performance', hint: 'What it learned', local: true },
  { label: 'Active campaigns', href: '/calendar', hint: 'What it is working toward' },
];

export function QuickActions({ onOpenChat }: { onOpenChat: () => void }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">Quick actions</h2>
      <p className="mt-1 text-[13px] text-ink-muted">The five things people come here to do.</p>

      <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {ACTIONS.map((a) => {
          const chat = a.href === '#chat';
          const className = cn(
            'block rounded-lg border border-border px-3.5 py-2.5 text-left transition-colors',
            'hover:bg-surface-muted focus-visible:outline focus-visible:outline-2',
            'focus-visible:outline-offset-2 focus-visible:outline-primary',
          );

          return (
            <li key={a.label}>
              {chat ? (
                /* The one that is not a destination: the drawer is state on the
                   page, so it is genuinely a button and is marked up as one. */
                <button type="button" onClick={onOpenChat} className={cn(className, 'w-full')}>
                  <ActionLabel {...a} />
                </button>
              ) : (
                <Link href={a.href} className={className}>
                  <ActionLabel {...a} />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ActionLabel({ label, hint }: Action) {
  return (
    <>
      <span className="block text-[13.5px] font-medium text-ink">{label}</span>
      <span className="mt-0.5 block text-[11.5px] text-ink-muted">{hint}</span>
    </>
  );
}
