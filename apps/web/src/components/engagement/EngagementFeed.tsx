'use client';

import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { WhyPopover, type Explanation } from '@/components/explain/WhyPopover';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { cn } from '@/lib/utils';
import { ReplyAction } from './ReplyAction';
import { EngagementCardActions } from './EngagementCardActions';
import { OpportunityActions } from './OpportunityActions';
import { ConversationDrawer } from './ConversationDrawer';

/**
 * `ENG-02` — the engagement inbox feed: comments, DMs and story replies,
 * sorted into the four tabs PRD §8.8 names, with the "approve & send" loop
 * (`ReplyAction`, PRD §8.8) attached to each card, plus `EngagementCardActions`
 * (`engage.escalate`/`.takeover`) on every card and `OpportunityActions`
 * (`engage.opportunity.create`/`.route`) on the Sales Opportunities tab only.
 * `ENG-02.4`'s conversation drawer (`ConversationDrawer`) opens from every card:
 * one message is not enough to judge a lead, which is the reason §8.8 asks for
 * it, and that is as true of a comment about to be replied to as of a
 * hot-classified DM. `engage.audit.query` has its own screen on `/account` —
 * this comment used to say there was no audit UI, which stopped being true.
 *
 * Each tab is a `category` filter on `engage.list`, except **Needs Review**:
 * a message SPARK hasn't classified yet has `category: null`, and there is
 * no fifth tab in the PRD for "unclassified". Rather than invent one, the
 * Needs Review tab fetches with no `category` filter and folds
 * `category == null` rows in alongside `needs_review` ones client-side —
 * the same choice documented on `engage.list`'s own input schema
 * (`packages/engage/src/list.ts`).
 */

type EngagementCategory = 'needs_review' | 'suggested_reply' | 'auto_handled' | 'sales_opportunity';

/** The shape `WhyPopover` renders — `Explanation` as it arrives over HTTP. */
type EngagementWhy = Explanation;

/** Exported for `ReplyAction`, the only other file that needs this shape. */
export interface EngagementItem {
  id: string;
  platform: string;
  kind: string;
  authorHandle: string;
  authorName?: string;
  text: string;
  receivedAt: string;
  status: string;
  category?: EngagementCategory;
  intentScore?: number;
  suggestedReply?: string;
  why?: EngagementWhy;
}

const TABS: { key: EngagementCategory; label: string }[] = [
  { key: 'needs_review', label: 'Needs Review' },
  { key: 'suggested_reply', label: 'Suggested Replies' },
  { key: 'auto_handled', label: 'Auto-Handled' },
  // The design's word. "Sales Opportunities" was mine, and the tool's
  // category is `sales_opportunity` either way.
  { key: 'sales_opportunity', label: 'Sales Leads' },
];

const KIND_LABEL: Record<string, string> = {
  comment: 'Comment',
  dm: 'DM',
  story_reply: 'Story reply',
};

export function EngagementFeed() {
  const { genome, loading, error: genomeError } = useSelectedGenome();
  const genomeId = genome?.genomeId;
  const [tab, setTab] = useState<EngagementCategory>('needs_review');
  /** `ENG-02.4`'s drawer. The message whose conversation is open, or undefined. */
  const [openThread, setOpenThread] = useState<string | undefined>();
  const [items, setItems] = useState<EngagementItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!genomeId) return;
    let cancelled = false;
    setItems(null);
    setError(null);
    void (async () => {
      // Needs Review also carries every unclassified row — see the module
      // comment above — so that one tab omits the `category` filter and
      // narrows client-side instead of on the server.
      const input =
        tab === 'needs_review' ? { genomeId, limit: 50 } : { genomeId, category: tab, limit: 50 };
      const res = await invoke<{ items: EngagementItem[] }>('engage.list', input);
      if (cancelled) return;
      if (res.status !== 'succeeded') {
        setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
        setItems([]);
        return;
      }
      const rows =
        tab === 'needs_review'
          ? res.output.items.filter((i) => !i.category || i.category === 'needs_review')
          : res.output.items;
      setItems(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [genomeId, tab]);

  // Once sent — or escalated, or taken over — a message no longer needs
  // anyone's attention in this feed: drop it from whichever tab it was
  // sitting in rather than leaving a stale card behind. A hard refetch would
  // do the same thing less directly and cost a round trip `ReplyAction`/
  // `EngagementCardActions` already know the answer to.
  function handleResolved(messageId: string) {
    setItems((prev) => prev?.filter((i) => i.id !== messageId) ?? prev);
  }

  if (loading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (genomeError || !genomeId) {
    return (
      <section className="rounded-xl border border-border bg-surface p-6">
        <p className="text-[14px] text-ink-muted">{genomeError ?? 'No brand selected.'}</p>
      </section>
    );
  }

  /*
    Three columns, filled round-robin.

    The design lays the cards out as `eiCols` — three 364px columns with a 12px
    gutter and a 16px stack inside each. CSS `columns` would do it in one line
    and cannot: these cards contain buttons and a popover, and a column break
    through the middle of one is a card split across two columns. So the split
    is explicit.
  */
  const columns: EngagementItem[][] = [[], [], []];
  (items ?? []).forEach((item, i) => {
    columns[i % 3]!.push(item);
  });

  return (
    /*
      1140-wide white panel at radius 20 — the tab's own card, not the shell's.

        heading   36,44   24px/600 "Command Center", with an info glyph
        tabs      390,32  49px tall at radius 12, 18px/500, the active one
                          underlined by a 3.5px cyan-pink-purple gradient
        filters   32,114  196x58 at radius 12 in a `rgba(131,131,131,0.35)` ring
        divider   0,196
        cards     16,216  three 364px columns, 12px apart, 16px stack
    */
    <section className="rounded-xl bg-white px-[32px] pb-[24px] pt-[36px]">
      <div className="flex flex-wrap items-center gap-x-[38px] gap-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-[24px] font-semibold leading-[1.27] text-ink">Command Center</h2>
          <span
            title="Comments, DMs and story replies from the audience, sorted by what each one needs."
            className="flex h-[18px] w-[18px] cursor-help items-center justify-center rounded-full text-[11px] text-ink-muted"
            style={{ boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.6)' }}
          >
            i
          </span>
        </div>

        <div role="tablist" aria-label="Engagement categories" className="flex flex-wrap items-center">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'relative flex h-[49px] items-center rounded-xl px-[30px] text-18 font-medium transition-colors',
                tab === t.key ? 'text-ink' : 'text-ink-muted hover:text-ink',
              )}
              style={tab === t.key ? { background: 'rgba(108,232,255,0.14)' } : undefined}
            >
              {t.label}
              {tab === t.key ? (
                <span
                  aria-hidden
                  className="absolute -bottom-[6px] left-0 h-[3.5px] w-full rounded"
                  style={{ background: 'linear-gradient(90deg,#6CE8FF 0%,#F56BFF 40%,#A341FF 100%)' }}
                />
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/*
        Five 196x58 filter boxes. None of them can work: `engage.message.list`
        takes a genome and a category, and there is no date, channel, kind,
        status or account filter on it. Drawn because the design draws them,
        disabled and saying which field is missing — the design toasts all five
        as mocks.
      */}
      <div className="mt-[26px] flex flex-wrap gap-[19px]">
        {(
          [
            ['Date', 'There is no date range on engage.message.list.'],
            ['Channels', 'There is no channel filter on engage.message.list.'],
            ['Content type', 'There is no content-type filter on engage.message.list.'],
            ['By Status', 'The four tabs above are the status filter.'],
            ['By Account', 'There is no per-account filter on engage.message.list.'],
          ] as const
        ).map(([label, why]) => (
          <button
            key={label}
            type="button"
            disabled
            title={why}
            className="flex h-[58px] w-[196px] cursor-not-allowed items-center gap-3 rounded-xl px-[18px] opacity-60"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)' }}
          >
            {label === 'Date' ? (
              <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden>
                <rect x="2.4" y="3.6" width="15.2" height="14" rx="2.4" stroke="#0C0C0C" strokeWidth="1.5" />
                <path d="M2.4 7.8h15.2M6.6 2v3M13.4 2v3" stroke="#0C0C0C" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            ) : null}
            <span className="flex-1 text-left text-[17px] font-medium text-ink">{label}</span>
            <svg width="11" height="7" viewBox="0 0 12 8" fill="none" aria-hidden>
              <path d="m1 1 5 5 5-5" stroke="#0C0C0C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
      </div>

      <div className="mt-[20px] h-px" style={{ background: 'rgba(131,131,131,0.15)' }} />

      {items === null ? (
        <div className="mt-[20px] grid grid-cols-1 gap-3 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56 w-full rounded-[19.14px]" />
          ))}
        </div>
      ) : error ? (
        <p className="mt-[20px] text-16 text-ink-muted">{error}</p>
      ) : items.length === 0 ? (
        <p className="mt-[20px] text-16 text-ink-muted">Nothing here yet.</p>
      ) : (
        <div className="mt-[20px] flex flex-col gap-3 lg:flex-row lg:items-start">
          {columns.map((col, ci) => (
            <div key={ci} className="flex min-w-0 flex-1 flex-col gap-4">
              {col.map((item) => (
                <article
                  key={item.id}
                  className="flex flex-col rounded-[19.14px] px-[26px] pb-[14px] pt-[17px]"
                  style={{
                    background: 'rgba(131,131,131,0.04)',
                    boxShadow: 'inset 0 0 0 1px rgba(12,12,12,0.2)',
                  }}
                >
                  <div className="flex items-start gap-2.5">
                    {/* 36.2px avatar with the platform badged onto its corner. No
                        author photo on a message, so it is the initial. */}
                    <span className="relative block h-[41px] w-[41px] shrink-0">
                      <span
                        className="flex h-[36.2px] w-[36.2px] items-center justify-center rounded-full text-[14px] font-semibold uppercase text-ink"
                        style={{ background: '#F8F8F8' }}
                      >
                        {(item.authorName || item.authorHandle || '?').slice(0, 1)}
                      </span>
                      <span
                        className="absolute bottom-0 right-0 flex h-[17px] w-[17px] items-center justify-center rounded-full bg-white text-[8px] font-semibold uppercase text-ink"
                        style={{ boxShadow: '0 0 0 0.8px rgba(12,12,12,0.12)' }}
                      >
                        {(item.platform ?? '').slice(0, 2)}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">
                      {item.authorName || item.authorHandle}
                    </span>
                    <span className="shrink-0 text-14 text-ink-muted">
                      {new Date(item.receivedAt).toLocaleTimeString('en', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <p className="mt-3 text-18 font-semibold leading-[1.27] text-black">{item.text}</p>

                  {item.suggestedReply ? (
                    <>
                      <div className="mt-[14px] flex flex-col items-end gap-[3px]">
                        <span className="text-[12.73px] text-ink-muted">Agent recommended response</span>
                        <span className="text-[14.55px] font-semibold text-ink">
                          {KIND_LABEL[item.kind] ?? item.kind}
                        </span>
                      </div>
                      <div
                        className="mt-2 self-end rounded-[15px] bg-white px-[14px] py-[13px]"
                        style={{ maxWidth: 263.5, boxShadow: 'inset 0 0 0 0.65px rgba(131,131,131,0.2)' }}
                      >
                        <span className="text-16 font-medium leading-[1.37] text-ink-muted">
                          &ldquo;{item.suggestedReply}&rdquo;
                        </span>
                      </div>
                    </>
                  ) : null}

                  {/* The design's "Safe ✅" chip. It is the classifier saying this
                      one can go without a person, which is exactly what
                      `auto_handled` means — so it shows on that tab rather than
                      being decoration. */}
                  {item.category === 'auto_handled' ? (
                    <span
                      className="mt-[14px] inline-flex h-11 w-fit items-center gap-2 rounded-xl bg-white px-[18px]"
                      style={{ boxShadow: 'inset 0 0 0 0.65px rgba(131,131,131,0.2)' }}
                    >
                      <span className="text-16 font-medium text-ink">Safe</span>
                      <span
                        className="inline-flex h-[17px] w-[17px] items-center justify-center rounded"
                        style={{ background: '#3EC332' }}
                      >
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden>
                          <path d="m1 4 2.6 2.5L9 1" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </span>
                  ) : null}

                  {/* §7.3 names engagement classification as something that must
                      be explainable, and the classifier returns its factors. */}
                  <WhyPopover why={item.why} />

                  {/* The footer's own white tray, which is what carries the two
                      buttons in the design. `ReplyAction` is Approve & Send and
                      Edit; the rest are this build's, and they stay. */}
                  <div className="mt-[14px] rounded-[17.86px] bg-white px-[14px] py-[12px]">
                    <ReplyAction item={item} genomeId={genomeId} onReplied={handleResolved} />
                    <EngagementCardActions item={item} genomeId={genomeId} onResolved={handleResolved} />
                    {tab === 'sales_opportunity' ? (
                      <OpportunityActions item={item} genomeId={genomeId} />
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setOpenThread(item.id)}
                      className="mt-2 text-[12px] font-medium text-brand-purple underline decoration-dotted underline-offset-2 hover:no-underline"
                    >
                      See the conversation
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ))}
        </div>
      )}

      <ConversationDrawer genomeId={genomeId} messageId={openThread} onClose={() => setOpenThread(undefined)} />
    </section>
  );
}
