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

/**
 * How many times a scheduled publish is retried before it stops — PRD §10's
 * retry flow, given an end.
 *
 * Every non-guardrail failure used to be retried forever on the correct
 * reasoning that a down adapter or an exhausted budget may well succeed later.
 * The case that reasoning misses is a dead platform connection: it fails
 * identically on every tick, the console line repeats once a minute for weeks,
 * and the calendar still shows a post that is going out. That is §10's "silent
 * miss" arriving as an infinitely retried post rather than a missing one.
 *
 * Five, at the default one-minute tick, is roughly five minutes of transient
 * trouble absorbed before a person is told — which is the right trade: a
 * momentary adapter blip should not reach the owner, and a broken connection
 * should not take a week to.
 */
const MAX_PUBLISH_ATTEMPTS = 5;

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

  /**
   * The item's own platform first, and it usually has one now.
   *
   * `CMP-01.4`'s account selection lands on the slot at placement time
   * (`placeCalendar` → `campaigns.platforms`), so a campaign that named its
   * accounts produces slots that already know where they are going. The
   * playbook fallback remains for the two cases that genuinely have no
   * selection to read: a campaign created before `CMP-01.4` existed, and
   * `CAL-02`/`04`/`05`'s date picker and drag-and-drop, which place a post on a
   * day rather than on an account. It is an honest default rather than a guess —
   * every playbook that reaches here already named which platforms it is for —
   * but it is no longer the *only* answer available, which it was.
   */
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

  /**
   * ── SPARK writes the copy, not the owner ────────────────────────────────
   *
   * `calendar.generate` writes empty slots — playbook, pillar and date, no
   * copy — and a recipe that publishes unattended creates its slot hours
   * before anything drafts it. This used to be terminal: a due slot with no
   * text was marked `blocked` with "No written copy", and since day-0 slots
   * were due the instant a campaign was created, activating a campaign
   * blocked its own opening day within one scheduler tick.
   *
   * Blocking was the wrong reaction to the wrong diagnosis. PRD §1 has SPARK
   * *"plans, drafts, schedules, publishes"* — an undrafted slot is not a
   * broken post, it is the next piece of SPARK's own work. So the scheduler
   * drafts it, through `invokeTool` like everything else, which means the
   * generation is policy-checked, cost-recorded and audited rather than
   * happening off to the side.
   *
   * Still terminal after a failed draft attempt: a slot whose playbook cannot
   * produce copy will not start producing it on the next tick, and looping on
   * it forever is the behaviour this replaced.
   */
  let beats = parseBeats(item.copy);
  let text = writtenText(beats);

  if (!text) {
    const drafted = await invokeTool(
      {
        tool: 'content.draft',
        input: {
          genomeId: item.genomeId,
          playbookId: item.playbookId,
          contentItemId: item.id,
          intent: item.intent ?? '',
        },
        caller: 'agent',
        ctx,
        brand,
        idempotencyKey: `scheduled-draft:${item.id}`,
      },
      deps.invoke,
    );

    if (drafted.status !== 'succeeded') {
      const why =
        drafted.status === 'failed'
          ? drafted.error.message
          : `Drafting was held by policy (${drafted.decision.kind}).`;
      console.warn('[warn] scheduler: could not draft this item', { contentItemId: item.id, why });
      // A *gated* draft is not a dead end — a human approving it later is the
      // system working — so only a hard failure blocks. A held one is left
      // `scheduled` and retried, since the approval may land before the post
      // stops being worth making.
      if (drafted.status === 'failed') {
        await deps.db.content.markBlocked({
          id: item.id,
          orgId: item.orgId,
          reason: `SPARK could not draft this post: ${why}`,
        });
      }
      return;
    }

    // Re-read rather than trusting the tool's own return shape: `content.draft`
    // writes the row, and the row is what `publish.now` will be told to publish.
    const refreshed = await deps.db.content.get(item.id, item.genomeId, item.orgId);
    beats = parseBeats(refreshed?.copy);
    text = writtenText(beats);
    if (!text) {
      console.warn('[warn] scheduler: drafting produced no written copy', { contentItemId: item.id });
      await deps.db.content.markBlocked({
        id: item.id,
        orgId: item.orgId,
        reason: 'No written copy — drafting this playbook produced no text beats.',
      });
      return;
    }
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
    // person to ever see or act on it.
    if (result.error.code === 'GUARDRAIL_BLOCKED') {
      await deps.db.content.markBlocked({ id: item.id, orgId: item.orgId, reason: result.error.message });
      return;
    }

    /**
     * Everything else is retryable — but not forever (PRD §10). The count is
     * recorded on the row rather than held in memory, so it survives the
     * container restarts this poll loop is explicitly built to tolerate, and so
     * the Draft Panel can show a person *why* their post stalled instead of the
     * reason living only in a log line.
     */
    const { attempts } = await deps.db.content.recordPublishFailure({
      id: item.id,
      orgId: item.orgId,
      error: `${result.error.code}: ${result.error.message}`,
    });

    if (attempts >= MAX_PUBLISH_ATTEMPTS) {
      const reason =
        `Publishing failed ${attempts} times and has stopped retrying. Last error: ${result.error.code} — ` +
        `${result.error.message}. Reschedule it once the cause is fixed.`;
      await deps.db.content.markBlocked({ id: item.id, orgId: item.orgId, reason });
      console.error('[error] scheduler: giving up on this item', { contentItemId: item.id, attempts });

      /**
       * Tell somebody. A post that has stopped retrying is exactly the state
       * §10 is about, and `blocked` on a calendar nobody is looking at is still
       * a silent miss. Through the registry like everything else, and its
       * failure is logged rather than thrown: the item is already correctly
       * blocked, and losing that because the notification channel is down would
       * put the row back into the infinite loop this branch exists to end.
       */
      const notified = await invokeTool(
        {
          tool: 'human.notify',
          input: {
            message:
              `A scheduled post stopped retrying after ${attempts} attempts (${platform}). ` +
              `Last error: ${result.error.message}. Check Settings \u2192 Connections, then reschedule it.`,
            urgency: 'high',
          },
          caller: 'agent',
          ctx,
          brand,
          idempotencyKey: `publish-gave-up:${item.id}`,
        },
        deps.invoke,
      );
      if (notified.status === 'failed') {
        console.error('[error] scheduler: could not notify about a stalled item', {
          contentItemId: item.id,
          code: notified.error.code,
        });
      }
    }
  } else if (result.status === 'gated') {
    // Not a failure — `review_everything`, a restricted platform, a recipe's own
    // review setting or a guardrail flag holding a scheduled post is the
    // approval ladder doing exactly its job.
    //
    // The item moves to `needs_review` (PRD §7.4) rather than staying
    // `scheduled`. Staying scheduled meant `findDue` re-selected it on the next
    // tick and re-held it, logging this same line once a minute forever, with
    // the calendar still showing it as a post that was going out. A `deny` is
    // recorded the same way: an item nobody may publish is equally not going
    // out on its own, and the reason is what a person needs to see.
    await deps.db.content.markNeedsReview({
      id: item.id,
      orgId: item.orgId,
      // `allow` never reaches this branch — `gated` is by definition every
      // other outcome — but the union includes it, so the reason is read
      // defensively rather than asserted.
      reason:
        result.decision.kind === 'allow'
          ? 'Held for review.'
          : result.decision.kind === 'deny'
            ? `Blocked by policy: ${result.decision.reason}`
            : `Waiting for approval: ${result.decision.reason}`,
    });
    console.log('[info] scheduler: publish held for review', {
      contentItemId: item.id,
      decision: result.decision.kind,
      ...(result.decision.kind !== 'allow' ? { ruleId: result.decision.ruleId } : {}),
    });
  }
}

/**
 * The stored `copy` payload as beats. A row whose copy does not parse is treated
 * as an *undrafted* row rather than an error — the scheduler's next move is to
 * draft it, which overwrites whatever was there.
 */
function parseBeats(copy: unknown): ResolvedBeat[] {
  const parsed = z.array(ResolvedBeat).safeParse(copy);
  return parsed.success ? parsed.data : [];
}

/** The publishable text of a draft: every written beat, in order. */
function writtenText(beats: ResolvedBeat[]): string {
  return beats
    .filter((b): b is Extract<ResolvedBeat, { kind: 'text' }> => b.kind === 'text')
    .map((b) => b.text)
    .join('\n\n');
}
