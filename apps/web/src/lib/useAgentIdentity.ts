'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import type { ToolOutput } from '@/lib/toolTypes.generated';

/**
 * THE AGENT'S NAME, FETCHED ONCE PER BRAND.
 *
 * ── Why this is cached and the twelve other call sites are not ────────────
 *
 * Twelve components call `brand.governance.get` directly, each for its own
 * reason and each on a screen where one extra request is not worth a hook. The
 * "Ask Spark?" orb is different in kind: it is mounted by the shell, so it is on
 * *every* screen, and on `/home` and `/agents` the thing it needs — the agent's
 * name — has already been fetched by the banner or the rail moments earlier.
 * Reading it again per navigation, out of a 30-field governance payload, to
 * label one bubble is the wrong trade.
 *
 * So: a module-level cache keyed by genome, and one in-flight promise shared by
 * every caller that asks while it is open. Anything else that only needs the
 * name can adopt this and stop fetching; nothing is obliged to.
 *
 * ── Why a module cache rather than a context ─────────────────────────────
 *
 * A provider would have to be mounted above every consumer, which means the
 * root layout — and the root layout is deliberately bare now so the public
 * proposal page loads no app state (`app/AppProviders.tsx`). A module cache has
 * no such reach: it is just a `Map`, it survives navigation because the module
 * does, and it dies with the tab.
 *
 * ── Staleness ────────────────────────────────────────────────────────────
 *
 * Exactly one thing in the app writes the name — `AgentStep` in onboarding —
 * and it calls {@link invalidateAgentIdentity} after saving. That is the whole
 * invalidation story, and it is worth keeping it that way: a second writer that
 * forgets to invalidate would leave the orb calling the agent by its old name
 * until the tab is reloaded.
 */

export interface AgentIdentity {
  /** The chosen name, or `null` when nobody has chosen one. */
  name: string | null;
  named: boolean;
}

const UNNAMED: AgentIdentity = { name: null, named: false };

const cache = new Map<string, AgentIdentity>();
const inFlight = new Map<string, Promise<AgentIdentity>>();

async function fetchIdentity(genomeId: string): Promise<AgentIdentity> {
  /**
   * The shape comes from the registry, not from here.
   *
   * This read is the reason `toolTypes.generated.ts` exists: the onboarding
   * version of it asserted a top-level `agentName`, which `brand.governance.get`
   * does not return, and the assertion type-checked because it *was* the type.
   * `ToolOutput` is printed from the tool's own Zod schema, so the field names
   * here are the field names the server sends.
   */
  const res = await invoke<ToolOutput<'brand.governance.get'>>('brand.governance.get', {});

  /**
   * A failure is not cached. The name is decoration on a chat bubble, so the
   * right answer to "we could not ask" is to say Spark and try again on the
   * next mount — not to remember the failure for the life of the tab.
   */
  if (res.status !== 'succeeded') return UNNAMED;

  const id = res.output.agentIdentity;
  /**
   * `named` is what separates a real name from the `UNNAMED_AGENT` fallback the
   * tool substitutes. Without this check the orb would cheerfully read "Ask
   * Your agent?" — which is worse than the thing it replaced.
   */
  const value: AgentIdentity = id?.named && id.name ? { name: id.name, named: true } : UNNAMED;

  cache.set(genomeId, value);
  return value;
}

/** Drop a brand's cached name, or every brand's when called with nothing. */
export function invalidateAgentIdentity(genomeId?: string): void {
  if (genomeId) {
    cache.delete(genomeId);
    inFlight.delete(genomeId);
    return;
  }
  cache.clear();
  inFlight.clear();
}

/**
 * The agent's identity for a brand. Returns the unnamed shape until it is
 * known, so a caller never has to handle a third "loading" state for a label.
 */
export function useAgentIdentity(genomeId: string | undefined): AgentIdentity {
  const [identity, setIdentity] = useState<AgentIdentity>(() =>
    genomeId ? cache.get(genomeId) ?? UNNAMED : UNNAMED,
  );

  useEffect(() => {
    if (!genomeId) {
      setIdentity(UNNAMED);
      return;
    }

    const hit = cache.get(genomeId);
    if (hit) {
      setIdentity(hit);
      return;
    }

    let cancelled = false;

    /* One request per genome even if three components mount at once. */
    let pending = inFlight.get(genomeId);
    if (!pending) {
      pending = fetchIdentity(genomeId).finally(() => inFlight.delete(genomeId));
      inFlight.set(genomeId, pending);
    }

    void pending.then((value) => {
      if (!cancelled) setIdentity(value);
    });

    return () => {
      cancelled = true;
    };
  }, [genomeId]);

  return identity;
}
