import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import { byId } from '@sparksocial/playbooks';
import { ResolvedBeat } from './draft.js';

/**
 * `content.get` — reads a draft back by id.
 *
 * The gap this closes: `content.draft`/`content.generate_*` all write
 * through `ScopedDb.content`, but nothing exposed a *read*, so a caller that
 * already had the tool's own response could see a draft and nothing else
 * ever could again — reopening the Draft Panel, or the Draft List (CC-03)
 * showing anything at all, both need this.
 */

export const ContentGetInput = z.object({
  contentItemId: z.string().min(1),
  genomeId: z.string().min(1),
});

export const ContentGetOutput = z.object({
  contentItemId: z.string(),
  playbookId: z.string(),
  mode: z.string(),
  mediaType: z.enum(['video', 'image', 'carousel', 'text']),
  status: z.string(),
  beats: z.array(ResolvedBeat),
  why: Explanation.optional(),
  // The publish receipt — set once `status` is 'published' (or 'rolled_back',
  // where they're kept rather than cleared, so the row still shows what was
  // taken down). Reopening the Draft Panel on a live post is what
  // `publish.rollback` needs these for.
  platform: z.string().optional(),
  externalId: z.string().optional(),
  via: z.string().optional(),
  url: z.string().optional(),
  /**
   * Why this item is not moving — set when `status` is 'blocked' or
   * 'needs_review'. One column with one meaning, as `markContentBlocked`'s own
   * comment explains: both states answer the same question a person opening a
   * stalled item asks.
   */
  blockedReason: z.string().optional(),
  /**
   * PRD §10's retry flow, at the reading end. The scheduler counts failed
   * publish attempts and stops at a ceiling; without these two on the wire the
   * only record of *why* a post stalled is a server log line, and the person who
   * has to fix it is looking at a UI, not a log.
   *
   * `publishAttempts` is always present (0 when nothing has been tried) rather
   * than omitted at zero: "tried 0 times" is a fact worth rendering, and an
   * absent field is indistinguishable from an older API that never carried it.
   */
  publishAttempts: z.number(),
  lastPublishError: z.string().optional(),
  /** `DISC-02`'s A/B group, when this draft is an arm — so the panel can say so rather than looking like an ordinary post. */
  variantGroupId: z.string().optional(),
  variantLabel: z.string().optional(),
});

export const contentGet = defineTool({
  name: 'content.get',
  version: 1,

  summary: 'Read a draft or scheduled slot back by id — its resolved beats, whatever has been generated ' +
    'so far, and its status. Free.',

  input: ContentGetInput,
  output: ContentGetOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,
  surfaces: ['CC-02', 'CC-03'],

  async handler(input, ctx) {
    const draft = await ctx.db.content.get(input.contentItemId, input.genomeId, ctx.orgId);
    if (!draft) throw new ToolError('NOT_FOUND', 'No such draft.', { contentItemId: input.contentItemId });

    // A freshly-created calendar slot (from calendar.generate) has no copy
    // yet — an empty beat list is the honest answer, not a parse error.
    const parsed = z.array(ResolvedBeat).safeParse(draft.copy);

    // Not stored on the row (`ContentDraft` has no `mediaType` field —
    // `content.draft` computes it from the playbook each time rather than
    // persisting a value that could drift from the playbook definition), so
    // read it back the same way here. A playbook the library no longer has
    // is the one case this can't answer; falls back to 'text' rather than
    // failing a read over a display hint.
    const mediaType = byId(draft.playbookId)?.output.media_type ?? 'text';

    return {
      contentItemId: draft.id,
      playbookId: draft.playbookId,
      mode: draft.mode,
      mediaType,
      status: draft.status,
      beats: parsed.success ? parsed.data : [],
      ...(draft.why ? { why: draft.why } : {}),
      ...(draft.platform ? { platform: draft.platform } : {}),
      ...(draft.externalId ? { externalId: draft.externalId } : {}),
      ...(draft.via ? { via: draft.via } : {}),
      ...(draft.url ? { url: draft.url } : {}),
      ...(draft.blockedReason ? { blockedReason: draft.blockedReason } : {}),
      publishAttempts: draft.publishAttempts ?? 0,
      ...(draft.lastPublishError ? { lastPublishError: draft.lastPublishError } : {}),
      ...(draft.variantGroupId ? { variantGroupId: draft.variantGroupId } : {}),
      ...(draft.variantLabel ? { variantLabel: draft.variantLabel } : {}),
    };
  },
});
