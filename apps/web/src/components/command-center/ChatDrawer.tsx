'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@/lib/tools';
import { startAgentRun } from '@/lib/agent';
import { isSparkPinned, setSparkPinned } from '@/lib/askSpark';
import { humaniseGoal } from '@/lib/runGoal';
import { relativeTime } from '@/lib/relativeTime';

/**
 * ASK SPARK — the chat drawer, built to `ui build/Spark Chat.dc.html`
 * (`data-screen-label="Spark Chat Drawer"`), which is the component every
 * screen's Ask Spark imports (`<dc-import name="Spark Chat">`).
 *
 * The panel and its parts, from that file:
 *
 *   panel        541x982, radius 30, white, with
 *                `0 32px 90px -20px rgba(12,12,12,.3)` over a
 *                `rgba(131,131,131,.12)` hairline, entering on
 *                `ss-drawer-in .3s cubic-bezier(.22,1,.36,1)` — a 36px slide
 *                from the right plus a fade
 *   tab strip    18,15 · 505x48 at radius 99.27 on `rgba(131,131,131,.08)`,
 *                with a **sliding white pill** behind the active tab
 *                (`left`/`width` over .25s ease) carrying
 *                `0 4px 14px -6px rgba(12,12,12,.18)`
 *   New Chat     17.77,13.7 — 18.2px icon, 15.68/500 label
 *   Conversations 164.77,12.9 — 22.2px icon, same type
 *   pin, close   447,23 and 488,23 — 31x31 hit areas
 *   messages     27,88 · 496x734, `justify-end`, gap 18
 *     user       self-end, max 340, radius 14.6 on `#F3F4F8`, 15/24 padding,
 *                16/500 ink
 *     spark      a 26.4px outlined orb, then max 367 of 16/500 `#838383`
 *     draft      496x166 radius 14.6 on `110.436deg #FEEBFF → #C2F4FE` in a
 *                `rgba(131,131,131,.2)` ring — a 142px black thumb at 10,12,
 *                the title at 167,12, the body at 167,62, and an "Edit draft"
 *                button at 167,123 · 101x31
 *     typing     the orb and three 7px dots on `ss-dot` staggered 0/.18/.36
 *   suggestions  16,719 · 509x50.6 and a 299.76 + 202.43 pair at 780
 *   composer     16,844 · 509x121.65 at radius 19.46 — the input at 15.57,8,
 *                a mic at 477.86, the orb at 15.17,77.27, attach at 59.11, and
 *                a 38px black send circle at 462,74
 *
 * The drawer is rendered at the design's own 541x982 rather than the 0.82
 * transform the Discovery stage applies to it, because that scale belongs to
 * the 1728-wide mock, not to the component: at 0.82 the 16px type would render
 * at 13 and the 38px send button at 31.
 *
 * ── What is real behind each control ─────────────────────────────────────
 *
 * **Chat** is `POST /v1/agent/runs` — the 'spark' orchestrator, run to
 * completion. Real, and unchanged from the previous version of this drawer.
 *
 * **My conversations** is `agent.run.list`: every SPARK run for this brand,
 * newest first, with its goal as the title and its status. The prototype's rows
 * are "Campaign post draft / Today" and this is the same shape from real data —
 * a run *is* a conversation here, because each send is one run. Opening one
 * replays it into the thread rather than pretending to resume it, which is the
 * honest thing: `runAgent` has no resumable session, so a "continue" would be a
 * new run with no memory of the last.
 *
 * **The draft suggestion** is a direct `content.draft` call on a playbook
 * `playbook.resolve` ranked, not a chat message. `packages/spark/src/loop.ts`
 * still has no delegation, so 'spark' cannot hand off to Producer mid-run and
 * "draft me three posts" would get a reply rather than three drafts. The
 * design's "Create a Post" chip is therefore wired to the capability that
 * exists, which is the same trade the previous version made.
 *
 * **Pin** keeps the drawer open across navigation and stops Escape closing it,
 * stored per-browser in `localStorage` (see `lib/askSpark.ts` on why not the
 * database). Every mounting site reads the flag for its initial `open`, so a
 * pinned conversation survives walking from Discovery to the Calendar.
 *
 * **Mic and attach** still have nothing behind them and say so on hover: no
 * speech-to-text tool is registered, and `asset.upload` puts a file in the
 * Asset Graph, which is where drafts retrieve media from — a different thing
 * from an attachment on a message. They are drawn because removing them would
 * leave the design's composer visibly missing two controls, and disabled
 * because a control that looks live and does nothing is worse than one that
 * admits it.
 */

interface ChatMessage {
  id: string;
  role: 'user' | 'spark' | 'system';
  text: string;
  contentItemId?: string;
  /** Set on the card the design draws for a produced draft. */
  draft?: { title: string; body: string };
}

interface RankedPlaybook {
  playbook_id: string;
  name: string;
  mode: 'synthesize' | 'assemble' | 'direct_finish';
}

interface RunSummary {
  runId: string;
  goal: string;
  status: string;
  startedAt: string;
  costCents: number;
}

/** The design's two tabs, and the pill geometry it slides between them. */
const TABS = [
  { key: 'chat' as const, label: 'New Chat', left: 8, width: 146 },
  { key: 'convos' as const, label: 'My conversations', left: 156, width: 182 },
];

const SPARK_ORB = (size: number) => {
  const s = size / 26.4;
  return (
    <span aria-hidden className="relative block shrink-0" style={{ width: size, height: size }}>
      <span className="absolute inset-0 rounded-full" style={{ boxShadow: `inset 0 0 0 ${1.2 * s}px #838383` }} />
      <span
        className="absolute rounded-[6px]"
        style={{ left: 5 * s, top: 9.5 * s, width: 16.4 * s, height: 7.4 * s, boxShadow: `inset 0 0 0 ${1 * s}px #838383` }}
      />
      <span className="absolute rounded-full bg-[#838383]" style={{ left: 8.4 * s, top: 12.2 * s, width: 2.2 * s, height: 2.2 * s }} />
      <span className="absolute rounded-full bg-[#838383]" style={{ left: 15.8 * s, top: 12.2 * s, width: 2.2 * s, height: 2.2 * s }} />
    </span>
  );
};

const DEAD_CONTROL = {
  mic: 'No speech-to-text tool is registered. AssemblyAI transcribes uploaded media (finish.transcribe); it is not wired to a live microphone.',
  attach:
    'No upload path reaches a chat turn. asset.upload puts a file in the Asset Graph, which is where drafts retrieve media from — attach it there and SPARK will find it.',
} as const;

export function ChatDrawer({
  genomeId,
  open,
  onClose,
  onOpenDraft,
}: {
  genomeId: string | undefined;
  open: boolean;
  onClose: () => void;
  /** Hands off to the Draft Panel — owned by the parent, since both it and this drawer need to be open at once (edit while chatting). */
  onOpenDraft: (contentItemId: string) => void;
}) {
  const [tab, setTab] = useState<'chat' | 'convos'>('chat');
  const [pinned, setPinned] = useState(false);
  /**
   * The conversation being read **inside the conversations tab**.
   *
   * Opening one used to overwrite the chat thread and switch to New Chat, which
   * is exactly backwards: New Chat is where a new conversation starts and it
   * must stay empty and ready. A past run is a different thing to look at, so
   * it opens where it lives, with a way back to the list.
   */
  const [openRun, setOpenRun] = useState<RunSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [playbooks, setPlaybooks] = useState<RankedPlaybook[] | null>(null);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  /** contentItemId → its summary, for `humaniseGoal`. */
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const nextId = () => `m${++seq.current}`;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  /* Read once on open rather than subscribed: the only thing that changes this
     is the button below, which sets both at the same time. */
  useEffect(() => {
    if (open) setPinned(isSparkPinned());
  }, [open]);

  /**
   * Escape closes, as everywhere else in this app — **unless pinned**, which is
   * the point of pinning. The prototype has no keyboard at all.
   */
  useEffect(() => {
    if (!open || pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, pinned, onClose]);

  const append = useCallback((role: ChatMessage['role'], text: string, extra?: Partial<ChatMessage>) => {
    setMessages((m) => [...m, { id: nextId(), role, text, ...extra }]);
  }, []);

  const loadRuns = useCallback(async () => {
    const res = await invoke<{ runs: RunSummary[] }>('agent.run.list', { limit: 20 });
    setRuns(res.status === 'succeeded' ? res.output.runs : []);

    /* One extra read so a goal can name the post it was about. Skipped without
       a brand in scope, where there is nothing to name it from. */
    if (!genomeId) return;
    const items = await invoke<{ items: Array<{ contentItemId: string; summary: string }> }>('content.list', {
      genomeId,
      limit: 100,
    });
    if (items.status === 'succeeded') {
      setTitles(
        new Map(
          items.output.items
            .filter((i) => i.summary && i.summary !== '(no copy yet)')
            .map((i) => [i.contentItemId.toLowerCase(), i.summary]),
        ),
      );
    }
  }, [genomeId]);

  useEffect(() => {
    if (open && tab === 'convos' && runs === null) void loadRuns();
  }, [open, tab, runs, loadRuns]);

  async function send(text?: string) {
    const goal = (text ?? draft).trim();
    if (!goal || busy) return;
    setDraft('');
    append('user', goal);
    setBusy(true);

    const outcome = await startAgentRun(goal);
    setBusy(false);
    if (outcome.status !== 'succeeded') {
      append('system', `Couldn't reach SPARK: ${outcome.error.message}`);
      return;
    }
    append('spark', outcome.run.text || '(no reply)');
    /* The run just made is a new row in My conversations. */
    setRuns(null);
  }

  async function loadDraftPackOptions() {
    if (!genomeId || playbooks !== null) return;
    const res = await invoke<{ ranked: RankedPlaybook[] }>('playbook.resolve', { genomeId });
    setPlaybooks(res.status === 'succeeded' ? res.output.ranked.filter((p) => p.mode !== 'direct_finish').slice(0, 5) : []);
  }

  async function draftOne(pb: RankedPlaybook) {
    if (!genomeId || busy) return;
    setBusy(true);
    /**
     * A fresh key per press, matching the three other `content.draft` call
     * sites. Without one the tool is refused before the handler runs, which is
     * what made every button in this drawer answer "content.draft is not
     * idempotent and requires an idempotency key".
     *
     * Fresh rather than derived from the playbook: drafting the same playbook
     * twice is a legitimate request, so a stable key would silently hand back
     * the first draft the second time.
     */
    const res = await invoke<{ contentItemId: string; beats?: Array<{ text?: string }> }>(
      'content.draft',
      { genomeId, playbookId: pb.playbook_id },
      crypto.randomUUID(),
    );
    setBusy(false);
    if (res.status !== 'succeeded') {
      append('system', res.status === 'failed' ? `Couldn't draft that: ${res.error.message}` : 'That draft was gated.');
      return;
    }
    append('spark', `Here is a ${pb.name} draft.`, {
      contentItemId: res.output.contentItemId,
      draft: {
        title: pb.name,
        body:
          res.output.beats?.map((b) => b.text).filter(Boolean).join(' ').slice(0, 160) ||
          'Open it to add media and publish.',
      },
    });
  }

  if (!open) return null;

  const activeTab = TABS.find((t) => t.key === tab)!;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Ask Spark"
      className="fixed right-[24px] top-[78px] z-50 flex w-[541px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[30px] bg-white animate-chat-in motion-reduce:animate-none"
      style={{
        height: 'min(982px, calc(100vh - 102px))',
        boxShadow: '0 32px 90px -20px rgba(12,12,12,0.3), 0 0 0 1px rgba(131,131,131,0.12)',
      }}
    >
      {/* ── tab strip: 18,15 · 505x48 ───────────────────────────────── */}
      <div className="relative mx-[18px] mt-[15px] h-[48px] shrink-0 rounded-[99.27px]" style={{ background: 'rgba(131,131,131,0.08)' }}>
        {/* The sliding pill. `left`/`width` transition, not opacity swaps —
            the design animates the pill itself. */}
        <span
          aria-hidden
          className="absolute top-0 h-[48px] rounded-[99.27px] bg-white transition-[left,width] duration-[250ms] ease-in-out motion-reduce:transition-none"
          style={{ left: activeTab.left, width: activeTab.width, boxShadow: '0 4px 14px -6px rgba(12,12,12,0.18)' }}
        />

        <button
          type="button"
          onClick={() => setTab('chat')}
          aria-pressed={tab === 'chat'}
          className="absolute left-[17.77px] top-[13.7px] flex items-center gap-[7px]"
        >
          <svg width="18.2" height="17.4" viewBox="0 0 19 18" fill="none" aria-hidden className="shrink-0">
            <rect x="0.8" y="0.8" width="17.4" height="13.4" rx="4.2" stroke={tab === 'chat' ? '#0C0C0C' : '#838383'} strokeWidth="1.5" />
            <path d="m5 14.6.1 2.2a.55.55 0 0 0 .92.44L9 14.6" stroke={tab === 'chat' ? '#0C0C0C' : '#838383'} strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M9.5 4.6v5.2M6.9 7.2h5.2" stroke={tab === 'chat' ? '#0C0C0C' : '#838383'} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span
            className="whitespace-nowrap text-[15.68px] font-medium leading-none"
            style={{ color: tab === 'chat' ? '#0C0C0C' : '#838383' }}
          >
            New Chat
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setTab('convos');
            setOpenRun(null);
          }}
          aria-pressed={tab === 'convos'}
          className="absolute left-[164.77px] top-[12.9px] flex items-center gap-[7px]"
        >
          <svg width="22.2" height="22.2" viewBox="0 0 22 22" fill="none" aria-hidden className="shrink-0">
            <rect x="2" y="2.6" width="18" height="13.6" rx="4.4" stroke={tab === 'convos' ? '#0C0C0C' : '#838383'} strokeWidth="1.5" />
            <path d="m6.4 16.6.1 2.4a.6.6 0 0 0 1 .47l3.3-2.87" stroke={tab === 'convos' ? '#0C0C0C' : '#838383'} strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M6.6 7.4h8.8M6.6 11h5.6" stroke={tab === 'convos' ? '#0C0C0C' : '#838383'} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span
            className="whitespace-nowrap text-[15.68px] font-medium leading-none"
            style={{ color: tab === 'convos' ? '#0C0C0C' : '#838383' }}
          >
            My conversations
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            const next = !pinned;
            setPinned(next);
            setSparkPinned(next);
          }}
          aria-pressed={pinned}
          aria-label={pinned ? 'Unpin this drawer' : 'Pin this drawer'}
          title={
            pinned
              ? 'Pinned — this drawer stays open as you move between screens, and Escape will not close it. Press to unpin.'
              : 'Pin this drawer so it stays open as you move between screens. Remembered in this browser only.'
          }
          className="absolute right-[53px] top-[8px] flex h-[31px] w-[31px] items-center justify-center rounded-lg transition-colors hover:bg-[rgba(131,131,131,0.12)]"
          style={pinned ? { background: 'rgba(108,232,255,0.28)' } : undefined}
        >
          <svg width="19" height="19" viewBox="0 0 19 19" fill="none" aria-hidden>
            <path
              d="m11.6 1.6 5.8 5.8c.5.5.3 1.4-.45 1.6l-2.4.75a1.1 1.1 0 0 0-.65.5l-2.1 3.7c-.35.6-1.2.7-1.7.2L4.9 9c-.5-.5-.4-1.35.2-1.7l3.7-2.1c.27-.15.45-.4.5-.65l.74-2.4c.22-.76 1.1-.97 1.6-.45Z"
              stroke={pinned ? '#0C0C0C' : '#838383'}
              strokeWidth="1.4"
              strokeLinejoin="round"
              fill={pinned ? '#0C0C0C' : 'none'}
              fillOpacity={pinned ? 0.12 : 0}
            />
            <path d="M6.9 12.1 2 17" stroke={pinned ? '#0C0C0C' : '#838383'} strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-[14px] top-[8px] flex h-[31px] w-[31px] items-center justify-center transition-opacity hover:opacity-65"
        >
          <svg width="15.2" height="15.2" viewBox="0 0 15 15" fill="none" aria-hidden>
            <path d="m1.5 1.5 12 12m0-12-12 12" stroke="#838383" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {tab === 'convos' ? (
        /* ── conversations: rows at 16,88, h50.6 r14.6, gap 12 ──────── */
        <div className="mx-[16px] mt-[25px] flex-1 overflow-y-auto pb-[16px]">
          {openRun ? (
            /*
              One conversation, read **inside this tab**. It used to write itself
              into the chat thread and switch tabs, which took New Chat — the
              place a new conversation starts — and filled it with an old one.
            */
            <div className="flex flex-col gap-[14px]">
              <button
                type="button"
                onClick={() => setOpenRun(null)}
                className="flex w-fit items-center gap-[8px] text-[14.5px] font-semibold text-ink"
              >
                <svg width="8" height="15" viewBox="0 0 8 16" fill="none" aria-hidden>
                  <path d="M7 1 1 8l6 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                All conversations
              </button>

              <p
                className="max-w-[340px] self-end rounded-[14.6px] px-[24px] py-[15px] text-16 font-medium leading-[1.25] text-ink"
                style={{ background: '#F3F4F8' }}
              >
                {humaniseGoal(openRun.goal, titles)}
              </p>

              <div className="flex items-start gap-[10px]">
                {SPARK_ORB(26.4)}
                <p className="max-w-[367px] text-16 font-medium leading-[1.25]" style={{ color: '#838383' }}>
                  This run {openRun.status} {relativeTime(openRun.startedAt)}
                  {openRun.costCents ? ` and cost ${(openRun.costCents / 100).toFixed(2)}` : ''}. Replies are not
                  stored per run, so the request above is what SPARK was given — the Timeline on Performance &amp;
                  Learning has its full step-by-step.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  /* Deliberately *starts* a new chat rather than continuing
                     this one: `runAgent` has no resumable session, so a
                     "continue" would be a fresh run with no memory of it. The
                     text is carried over so the user does not retype it. */
                  setDraft(humaniseGoal(openRun.goal, titles));
                  setOpenRun(null);
                  setTab('chat');
                }}
                className="flex h-[44px] w-fit items-center rounded-xl bg-ink px-[18px] text-[15px] font-semibold text-white transition-colors hover:bg-[#242424]"
              >
                Ask this again in a new chat
              </button>
            </div>
          ) : runs === null ? (
            <p className="px-[17px] text-16 font-medium text-ink-muted">Loading…</p>
          ) : runs.length === 0 ? (
            <p className="px-[17px] text-16 font-medium text-ink-muted">
              No runs yet. Every message you send here is one SPARK run, and they appear in this list.
            </p>
          ) : (
            <ul className="flex flex-col gap-[12px]">
              {runs.map((r) => (
                <li key={r.runId}>
                  <button
                    type="button"
                    onClick={() => setOpenRun(r)}
                    className="flex h-[50.6px] w-full items-center gap-[12px] rounded-[14.6px] bg-white px-[17px] text-left transition-colors hover:bg-[#FAFAFA]"
                    style={{ boxShadow: '0 0 0 0.958px rgba(131,131,131,0.2)' }}
                  >
                    <svg width="18" height="18" viewBox="0 0 22 22" fill="none" aria-hidden className="shrink-0">
                      <rect x="2" y="2.6" width="18" height="13.6" rx="4.4" stroke="#838383" strokeWidth="1.5" />
                      <path d="m6.4 16.6.1 2.4a.6.6 0 0 0 1 .47l3.3-2.87" stroke="#838383" strokeWidth="1.5" strokeLinejoin="round" />
                    </svg>
                    <span className="min-w-0 flex-1 truncate text-16 font-medium text-ink" title={r.goal}>
                      {humaniseGoal(r.goal, titles)}
                    </span>
                    <span className="shrink-0 text-14 text-ink-muted">{relativeTime(r.startedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          {/* ── thread: 27,88 · 496x734, bottom-anchored ─────────────── */}
          <div ref={listRef} className="mx-[27px] mt-[25px] flex flex-1 flex-col justify-end gap-[18px] overflow-y-auto pb-[6px]">
            {messages.map((m) =>
              m.role === 'user' ? (
                <p
                  key={m.id}
                  className="max-w-[340px] self-end rounded-[14.6px] px-[24px] py-[15px] text-16 font-medium leading-[1.25] text-ink"
                  style={{ background: '#F3F4F8' }}
                >
                  {m.text}
                </p>
              ) : (
                <div key={m.id} className="flex flex-col gap-[14px]">
                  <div className="flex items-start gap-[10px]">
                    {SPARK_ORB(26.4)}
                    <p className="max-w-[367px] text-16 font-medium leading-[1.25]" style={{ color: '#838383' }}>
                      {m.text}
                    </p>
                  </div>

                  {m.draft ? (
                    <div
                      className="relative h-[166px] w-full overflow-hidden rounded-[14.6px]"
                      style={{
                        background: 'linear-gradient(110.436deg, #FEEBFF 5.47%, #C2F4FE 96.41%)',
                        boxShadow: '0 0 0 0.958px rgba(131,131,131,0.2)',
                      }}
                    >
                      {/* The design puts a rendered thumbnail here. A draft has
                          no render until Assemble runs, so the well carries the
                          playbook's initial instead of a placeholder image. */}
                      <div
                        className="absolute left-[10px] top-[12px] flex h-[142px] w-[142px] items-center justify-center rounded-[13.37px] bg-ink"
                        style={{ boxShadow: '0 0 0 0.878px rgba(131,131,131,0.2)' }}
                      >
                        <span className="text-[44px] font-bold text-white/90">{m.draft.title.slice(0, 1)}</span>
                      </div>
                      <p className="absolute left-[167px] top-[12px] w-[265px] text-16 font-medium leading-[1.25] text-ink">
                        {m.draft.title}
                      </p>
                      <p
                        className="absolute left-[167px] top-[62px] line-clamp-3 w-[293px] text-[13.69px] font-normal leading-[1.25]"
                        style={{ color: '#838383' }}
                      >
                        {m.draft.body}
                      </p>
                      {m.contentItemId ? (
                        <button
                          type="button"
                          onClick={() => onOpenDraft(m.contentItemId!)}
                          className="absolute left-[167px] top-[123px] flex h-[31px] w-[101px] items-center justify-center gap-[6px] rounded-[6.29px] transition-colors hover:bg-white/50"
                          style={{ boxShadow: 'inset 0 0 0 0.485px #0C0C0C' }}
                        >
                          <svg width="11.3" height="11.3" viewBox="0 0 12 12" fill="none" aria-hidden>
                            <path
                              d="m7.4 2.5 2.1 2.1M1.3 10.7l.42-2a1.2 1.2 0 0 1 .33-.6l4.8-4.8a1.06 1.06 0 0 1 1.5 0l.9.9a1.06 1.06 0 0 1 0 1.5l-4.8 4.8a1.2 1.2 0 0 1-.6.33l-2 .42-.55-.55Z"
                              stroke="#0C0C0C"
                              strokeWidth="0.95"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path d="M6 11.3h4.9" stroke="#0C0C0C" strokeWidth="0.95" strokeLinecap="round" />
                          </svg>
                          <span className="text-[11.85px] font-medium text-ink">Edit draft</span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ),
            )}

            {busy ? (
              <div className="flex items-center gap-[10px]">
                {SPARK_ORB(26.4)}
                <span className="flex gap-[5px]">
                  {[0, 0.18, 0.36].map((d) => (
                    <span
                      key={d}
                      className="block h-[7px] w-[7px] rounded-full bg-[#838383] animate-dot motion-reduce:animate-none"
                      style={{ animationDelay: `${d}s` }}
                    />
                  ))}
                </span>
              </div>
            ) : null}
          </div>

          {/* ── suggestions, only on an empty thread ─────────────────── */}
          {messages.length === 0 ? (
            <div className="mx-[16px] mb-[13px] flex flex-col gap-[10px]">
              <button
                type="button"
                disabled={busy}
                onClick={() => void send('Summarize my agent campaign into key points')}
                className="flex h-[50.6px] items-center truncate whitespace-nowrap rounded-[14.6px] bg-white px-[17px] text-left text-16 font-medium transition-colors hover:bg-[#FAFAFA] disabled:opacity-50"
                style={{ boxShadow: '0 0 0 0.958px rgba(131,131,131,0.2)', color: '#838383' }}
              >
                Summarize my agent campaign into key points
              </button>
              <div className="flex gap-[7px]">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void send('Create a summary for this campaign')}
                  className="flex h-[50.6px] w-[299.76px] items-center truncate whitespace-nowrap rounded-[14.6px] bg-white px-[17px] text-left text-16 font-medium transition-colors hover:bg-[#FAFAFA] disabled:opacity-50"
                  style={{ boxShadow: '0 0 0 0.958px rgba(131,131,131,0.2)', color: '#838383' }}
                >
                  Create a summary for this campaign
                </button>

                {/* "Create a Post" is the one chip that is *not* a chat message
                    — see the note on delegation above. It opens the playbook
                    list and drafts directly. */}
                <button
                  type="button"
                  disabled={busy || !genomeId}
                  onClick={() => void loadDraftPackOptions()}
                  title={genomeId ? undefined : 'No brand selected.'}
                  className="flex h-[50.6px] flex-1 items-center justify-center gap-[10px] whitespace-nowrap rounded-[14.6px] text-16 font-medium text-ink transition-colors hover:bg-[#FAFAFA] disabled:opacity-50"
                >
                  <svg width="19.2" height="19.2" viewBox="0 0 20 20" fill="none" aria-hidden>
                    <path
                      d="m12.4 4.2 3.4 3.4M2.2 17.8l.7-3.3a2 2 0 0 1 .54-1L11.2 5.7a1.7 1.7 0 0 1 2.4 0l1.4 1.4a1.7 1.7 0 0 1 0 2.4l-7.8 7.8a2 2 0 0 1-1 .54l-3.3.7-.7-.74Z"
                      stroke="#0C0C0C"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Create a Post
                </button>
              </div>
            </div>
          ) : null}

          {/* The playbook picker the Create-a-Post chip opens. */}
          {playbooks !== null ? (
            <div className="mx-[16px] mb-[13px]">
              {playbooks.length === 0 ? (
                <p className="text-[14px] font-medium text-ink-muted">
                  No playbook can run for this brand yet — the Asset Graph is missing what they need.
                </p>
              ) : (
                <div className="flex flex-wrap gap-[8px]">
                  {playbooks.map((pb) => (
                    <button
                      key={pb.playbook_id}
                      type="button"
                      disabled={busy}
                      onClick={() => void draftOne(pb)}
                      className="flex h-[36px] items-center rounded-full bg-white px-[14px] text-[14px] font-medium text-ink transition-colors hover:bg-[#FAFAFA] disabled:opacity-50"
                      style={{ boxShadow: '0 0 0 0.958px rgba(131,131,131,0.2)' }}
                    >
                      {pb.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {/* ── composer: 16,844 · 509x121.65 r19.46 ─────────────────── */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="relative mx-[16px] mb-[16px] h-[121.65px] shrink-0 rounded-[19.46px]"
            style={{
              background: 'linear-gradient(rgba(131,131,131,0.05),rgba(131,131,131,0.05)), #FFFFFF',
              boxShadow: '0 0 0 0.958px rgba(131,131,131,0.2)',
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message Spark or @ mention a feature"
              aria-label="Message Spark"
              className="absolute left-[15.57px] top-[8px] h-[40px] w-[calc(100%-70px)] bg-transparent text-16 font-medium text-ink outline-none placeholder:text-[#838383]"
            />

            <button
              type="button"
              disabled
              title={DEAD_CONTROL.mic}
              aria-label="Dictate"
              className="absolute right-[16px] top-[15.57px] cursor-not-allowed opacity-50"
            >
              <svg width="19.2" height="20.6" viewBox="0 0 20 21" fill="none" aria-hidden>
                <rect x="6.3" y="1" width="7.4" height="12.4" rx="3.7" stroke="#838383" strokeWidth="1.6" />
                <path d="M2.2 10.2a7.8 7.8 0 0 0 15.6 0M10 18v2.4" stroke="#838383" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>

            <span className="absolute left-[15.17px] top-[77.27px]">{SPARK_ORB(32.38)}</span>

            <button
              type="button"
              disabled
              title={DEAD_CONTROL.attach}
              aria-label="Attach"
              className="absolute left-[59.11px] top-[77.27px] flex h-[32.38px] w-[32.38px] cursor-not-allowed items-center justify-center rounded-full opacity-50"
              style={{ boxShadow: '0 0 0 0.973px rgba(131,131,131,0.2)' }}
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                <path d="M6.5 1v11M1 6.5h11" stroke="#838383" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>

            <button
              type="submit"
              disabled={busy || !draft.trim()}
              aria-label="Send"
              className="absolute right-[9px] top-[74px] flex h-[38px] w-[38px] items-center justify-center rounded-full bg-ink transition-colors hover:bg-[#242424] disabled:opacity-40"
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
                <path
                  d="M18.3 1.7 9.2 10.8M18.3 1.7 12.5 18.3l-3.3-7.5-7.5-3.3L18.3 1.7Z"
                  stroke="#FFFFFF"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </form>
        </>
      )}
    </div>
  );
}
