import { z } from 'zod';
import { invokeTool, type CreditStore, type InvokeDeps, type InvokeRequest, type ScopedDb } from '@sparksocial/tools';
import { byId } from '@sparksocial/playbooks';
import { ResolvedBeat } from '@sparksocial/generate';
import type { DueContentSource } from '@sparksocial/db';
import { makeDevResolveCtx } from './dev-auth.js';

/**
 * THE SCHEDULER — closes the gap the P4 survey found: `content.schedule`
 * (and `calendar.generate` before it) can put a `scheduledAt` on a
 * `content_items` row, but nothing ever reads it back and calls `publish.now`
 * when it arrives. Without this, "schedule a post for Tuesday" only ever
 * meant "remember Tuesday" — the post stays `scheduled` forever unless
 * someone opens the Draft Panel and clicks Publish by hand.
 *
 * ── Why a poll loop, not Trigger.dev ───────────────────────────────────────
 * The master plan names Trigger.dev for durable, multi-minute workflows. It
 * is not wired into this repo — no queue, no worker process, nothing to
 * schedule *against* — and standing that up is its own integration, not a
 * one-file addition. A poll loop against "what's due" is the honest v1: it
 * is exactly as durable as the process it runs in (a missed tick because the
 * container restarted just gets picked up on the next one, since nothing is
 * marked done until `publish.now` actually succeeds), and it costs nothing
 * to replace later — the call site becomes a queue consumer, the query stays
 * the same.
 *
 * ── Why this goes through `invokeTool`, not a bare adapter call ───────────
 * A scheduled post is not exempt from the approval ladder just because a
 * human isn't watching the clock — `review_everything` must still hold it,
 * `rights`/`platform_policy`/`claim_grounding` must still run. Building a
 * ctx and calling `invokeTool('publish.now', ...)` is what makes this true
 * automatically: the policy engine and guardrails are `publish.now`'s
 * problem, not the scheduler's, the same separation `/v1/tools/:name`
 * relies on.
 */

export interface SchedulerDeps {
  source: DueContentSource;
  db: ScopedDb;
  invoke: InvokeDeps;
  loadBrandGovernance: (orgId: string, brandId?: string) => Promise<InvokeRequest['brand']>;
  /**
   * Same ledger `whatsappWebhook.systemCtx` reads. Omitting it would give every
   * scheduled publish an unlimited budget (`readBudget`'s no-ledger default) —
   * the one caller path where spend enforcement matters most, since nobody is
   * watching the clock to notice a runaway posting cadence.
   */
  credits?: CreditStore;
  now?: () => Date;
}

const BATCH_SIZE = 25;

export function startScheduler(deps: SchedulerDeps, intervalMs: number): { stop: () => void } {
  let running = false;

  const tick = async () => {
    // A slow batch must not overlap the next timer fire — two ticks racing
    // the same due row would both attempt `publish.now`, and while the
    // idempotency key protects against a double *post*, there is no reason
    // to pay for two attempts when one will do.
    if (running) return;
    running = true;
    try {
      await runOnce(deps);
    } catch (e) {
      console.error('[error] scheduler: tick failed', { error: e instanceof Error ? e.message : String(e) });
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return { stop: () => clearInterval(timer) };
}

export async function runOnce(deps: SchedulerDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const due = await deps.source.findDue(now, BATCH_SIZE);

  for (const item of due) {
    try {
      await publishOne(item, deps);
    } catch (e) {
      console.error('[error] scheduler: publish failed', {
        contentItemId: item.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

async function publishOne(
  item: Awaited<ReturnType<DueContentSource['findDue']>>[number],
  deps: SchedulerDeps,
): Promise<void> {
  const genome = await deps.db.genomes.get(item.genomeId, item.orgId);
  if (!genome) {
    // Same "will fail identically forever" reasoning as a guardrail block
    // below — a genome that doesn't exist today isn't going to start
    // existing on a later tick. Every one of this function's early returns
    // shares that property, so every one of them now marks blocked instead
    // of leaving the row `scheduled` to be silently re-selected and
    // re-skipped on every future tick.
    console.warn('[warn] scheduler: genome not found, skipping', { contentItemId: item.id });
    await deps.db.content.markBlocked({ id: item.id, orgId: item.orgId, reason: 'This content item’s genome no longer exists.' });
    return;
  }
  if (!item.playbookId) {
    console.warn('[warn] scheduler: no playbook on this item, skipping', { contentItemId: item.id });
    await deps.db.content.markBlocked({ id: item.id, orgId: item.orgId, reason: 'No playbook is set on this content item.' });
    return;
  }
  const playbook = byId(item.playbookId);

  // `content.schedule` doesn't ask for a platform — CAL-02/04/05's date
  // picker and drag-and-drop place a post on a day, not a platform, so
  // nothing sets this column today. Falling back to the playbook's first
  // declared platform is an honest default, not a guess: every playbook
  // that reaches here already named which platforms it's meant for.
  const platform = item.platform ?? playbook?.output.platforms[0];
  if (!platform) {
    console.warn('[warn] scheduler: no platform available for this item, skipping', { contentItemId: item.id });
    await deps.db.content.markBlocked({
      id: item.id,
      orgId: item.orgId,
      reason: playbook ? 'This playbook declares no platforms and none was set on the item.' : 'This item’s playbook no longer resolves.',
    });
    return;
  }

  const parsed = z.array(ResolvedBeat).safeParse(item.copy);
  const beats = parsed.success ? parsed.data : [];
  const text = beats
    .filter((b): b is Extract<ResolvedBeat, { kind: 'text' }> => b.kind === 'text')
    .map((b) => b.text)
    .join('\n\n');
  if (!text) {
    console.warn('[warn] scheduler: no written copy on this item, skipping', { contentItemId: item.id });
    await deps.db.content.markBlocked({ id: item.id, orgId: item.orgId, reason: 'No written copy — this item has no text beats to publish.' });
    return;
  }
  const referencedAssetIds = beats
    .filter((b): b is Extract<ResolvedBeat, { kind: 'asset' }> => b.kind === 'asset')
    .map((b) => b.assetId);
  const mediaUrls = beats
    .filter(
      (b): b is Extract<ResolvedBeat, { kind: 'generated_image' | 'generated_video' | 'generated_audio' | 'generated_broll' | 'dubbed_media' }> =>
        b.kind === 'generated_image' || b.kind === 'generated_video' || b.kind === 'generated_audio' || b.kind === 'generated_broll' || b.kind === 'dubbed_media',
    )
    .map((b) => b.url);

  const base = await makeDevResolveCtx(deps.db, deps.credits)(
    new Request('http://localhost/', {
      headers: {
        'x-org-id': item.orgId,
        'x-brand-id': genome.workspace_id,
        // Without this, `makeDevResolveCtx` falls back to its `'gen_dev'`
        // default and `publish.now`'s cross-genome check (`ctx.genomeId !==
        // input.genomeId`) rejects every real item with ISOLATION_VIOLATION —
        // caught by scheduler.test.ts's end-to-end case against the real
        // dev store and the real tool, not the fakes.
        'x-genome-id': item.genomeId,
        'x-role': 'admin',
      },
    }),
  );
  // No `userId`: nobody is signed in for a scheduled tick. `caller: 'agent'`
  // below is what actually attributes the audit row — this only drops the
  // field a human session would otherwise leave behind.
  const { userId: _drop, caller: _caller, ...ctx } = base;

  const brand = await deps.loadBrandGovernance(item.orgId, genome.workspace_id);

  const result = await invokeTool(
    {
      tool: 'publish.now',
      input: {
        contentItemId: item.id,
        genomeId: item.genomeId,
        playbookId: item.playbookId,
        platform,
        text,
        referencedAssetIds,
        mediaUrls,
      },
      caller: 'agent',
      ctx,
      brand,
      idempotencyKey: `scheduled:${item.id}:${platform}`,
    },
    deps.invoke,
  );

  if (result.status === 'failed') {
    console.error('[error] scheduler: publish.now failed', {
      contentItemId: item.id,
      code: result.error.code,
      message: result.error.message,
    });
    // A guardrail *block* (unlike everything else `publish.now` can fail
    // with — a down adapter, a budget that resets next month) will fail
    // identically on every future tick: nothing about the content changes
    // between them. Leaving `status: 'scheduled'` in place would mean this
    // exact log line repeats forever, once per tick, with no way for a
    // person to ever see or act on it. Every other failure code stays
    // retryable — those genuinely might succeed on a later tick.
    if (result.error.code === 'GUARDRAIL_BLOCKED') {
      await deps.db.content.markBlocked({ id: item.id, orgId: item.orgId, reason: result.error.message });
    }
  } else if (result.status === 'gated') {
    // Not a failure — `review_everything` (or a guardrail flag) holding a
    // scheduled post is the approval ladder doing exactly its job. It now
    // sits in the Review queue same as a manual publish would.
    console.log('[info] scheduler: publish held for review', { contentItemId: item.id, decision: result.decision.kind });
  }
}
