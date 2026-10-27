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
 * ── Three of the five stay on this screen ───────────────────────────────
 *
 * Drafts, the Agent Calendar and Performance are all part of the Command
 * Center — the draft panel on its list, and two of its tabs — so those three
 * change what this screen shows rather than leaving it. Chat opens the drawer;
 * Active campaigns goes to the Calendar, where the campaign list lives.
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
}

/*
  ── Where they go, measured on production ─────────────────────────────────

  "Drafts list" and "Performance & learning" were `#drafts` and
  `#performance` — anchors to panels on this page. Neither id exists: the
  drafts list lives in the draft panel and Performance is its own Command
  Center tab. So one jumped to the top of the page and the other did nothing.
  They now name the real place: the panel opened on its list, and the tab.
  "Agent calendar" is the Command Center's own Agent Calendar tab, which is
  what the label says, rather than the separate Calendar screen.
*/
const ACTIONS: Action[] = [
  { label: 'Chat', href: '#chat', hint: 'Ask it to do something' },
  { label: 'Drafts list', href: '/agents?drafts=list', hint: 'Everything in flight' },
  { label: 'Agent calendar', href: '/agents?tab=calendar', hint: 'The month it has planned' },
  { label: 'Performance & learning', href: '/agents?tab=performance', hint: 'What it learned' },
  { label: 'Active campaigns', href: '/calendar', hint: 'What it is working toward' },
];

export function QuickActions({ onOpenChat, agentName = 'Spark' }: { onOpenChat: () => void; agentName?: string }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-18 font-semibold text-ink">Quick actions</h2>
      <p className="mt-1 text-13 text-ink-muted">The five things people come here to do.</p>

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
                  {/* The agent's own name — "Chat with Bean", not "with Spark". */}
                  <ActionLabel {...a} label={`Chat with ${agentName}`} />
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
      <span className="block text-14 font-medium text-ink">{label}</span>
      <span className="mt-0.5 block text-12 text-ink-muted">{hint}</span>
    </>
  );
}
