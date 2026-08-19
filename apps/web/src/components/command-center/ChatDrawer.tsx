'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { invoke } from '@/lib/tools';
import { startAgentRun } from '@/lib/agent';
import { cn } from '@/lib/utils';

/**
 * CC-02 — the Spark Chat Drawer (`ui build/SparkSocial Command Center.dc.html`,
 * `data-screen-label="Spark Chat Drawer"`).
 *
 * ── What "chat" can actually do today, and why the scope here is honest about it ──
 *
 * `POST /v1/agent/runs` runs the 'spark' orchestrator to completion and
 * returns its reply — that part is real and this drawer uses it directly.
 * What is *not* real yet: `packages/spark/src/loop.ts` has no delegation
 * mechanism (flagged separately), so 'spark' cannot hand off to Director or
 * Producer mid-run — its own tool scope is `human.*`/`agent.*`/`queue.*`/
 * `approval.*` and nothing content-generating. A free-text "draft me three
 * posts" would get a reply, not three drafts.
 *
 * "One Brief → Draft Pack" is therefore built as a **direct tool call**, not
 * a chat message — `content.draft` on a playbook the caller picks, which is
 * a real, working capability today and does not depend on delegation ever
 * landing. This is the same trade `CampaignFocusCard` made for "Edit
 * Campaign": a decorative mockup button became a real one that does
 * something the backend can actually do.
 */

interface ChatMessage {
  id: string;
  role: 'user' | 'spark' | 'system';
  text: string;
  contentItemId?: string;
}

interface RankedPlaybook {
  playbook_id: string;
  name: string;
  mode: 'synthesize' | 'assemble' | 'direct_finish';
}

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [playbooks, setPlaybooks] = useState<RankedPlaybook[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const nextId = () => `m${++seq.current}`;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const append = useCallback((role: ChatMessage['role'], text: string, contentItemId?: string) => {
    setMessages((m) => [...m, { id: nextId(), role, text, ...(contentItemId ? { contentItemId } : {}) }]);
  }, []);

  async function send() {
    const goal = draft.trim();
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
  }

  async function loadDraftPackOptions() {
    if (!genomeId || playbooks !== null) return;
    const res = await invoke<{ ranked: RankedPlaybook[] }>('playbook.resolve', { genomeId });
    if (res.status === 'succeeded') {
      setPlaybooks(res.output.ranked.filter((p) => p.mode !== 'direct_finish').slice(0, 5));
    } else {
      setPlaybooks([]);
    }
  }

  async function draftOne(pb: RankedPlaybook) {
    if (!genomeId || busy) return;
    setBusy(true);
    append('system', `Drafting "${pb.name}"…`);
    const res = await invoke<{ contentItemId: string }>('content.draft', {
      genomeId,
      playbookId: pb.playbook_id,
    });
    setBusy(false);
    if (res.status !== 'succeeded') {
      append('system', res.status === 'failed' ? `Couldn't draft that: ${res.error.message}` : 'That draft was gated.');
      return;
    }
    append('system', `Drafted "${pb.name}" — open it to add media and publish.`, res.output.contentItemId);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-y-6 right-6 z-50 flex w-[420px] max-w-[calc(100vw-3rem)] flex-col rounded-2xl border border-border bg-surface shadow-2xl"
      role="dialog"
      aria-label="Ask Spark"
    >
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-[16px] font-semibold text-ink">Ask Spark</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-[14px] text-ink-muted hover:text-ink"
        >
          Close
        </button>
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <EmptyState onDraftPack={() => void loadDraftPackOptions()} />
        ) : (
          <ul className="grid grid-cols-1 gap-3">
            {messages.map((m) => (
              <li key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-xl px-3 py-2 text-[14px]',
                    m.role === 'user' && 'bg-primary text-primary-foreground',
                    m.role === 'spark' && 'bg-surface-muted text-ink',
                    m.role === 'system' && 'bg-transparent text-ink-muted italic',
                  )}
                >
                  <p>{m.text}</p>
                  {m.contentItemId ? (
                    <button
                      type="button"
                      onClick={() => onOpenDraft(m.contentItemId!)}
                      className="mt-1 font-medium not-italic text-brand-purple underline underline-offset-2"
                    >
                      Open draft
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {playbooks && playbooks.length > 0 ? (
          <div className="mt-4 grid grid-cols-1 gap-2">
            <p className="text-[12px] font-medium text-ink-muted">One brief → draft pack</p>
            <div className="flex flex-wrap gap-2">
              {playbooks.map((pb) => (
                <button
                  key={pb.playbook_id}
                  type="button"
                  disabled={busy}
                  onClick={() => void draftOne(pb)}
                  className="rounded-full border border-border px-3 py-1.5 text-[13px] text-ink hover:bg-surface-muted disabled:opacity-50"
                >
                  {pb.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-center gap-2 border-t border-border p-4"
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask Spark anything about this brand…"
          disabled={busy}
          className="h-11 flex-1"
          aria-label="Message"
        />
        <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
          {busy ? 'Thinking…' : 'Send'}
        </Button>
      </form>
    </div>
  );
}

function EmptyState({ onDraftPack }: { onDraftPack: () => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 text-center">
      <p className="text-[14px] text-ink-muted">
        Ask about this brand's status, questions it's waiting on, or the review queue.
      </p>
      <Button variant="outline" size="sm" onClick={onDraftPack} className="mx-auto">
        One brief → draft pack
      </Button>
    </div>
  );
}
