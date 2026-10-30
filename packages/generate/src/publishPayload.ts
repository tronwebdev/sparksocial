import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import { byId } from '@sparksocial/playbooks';
import { ResolvedBeat } from './draft.js';

/**
 * `content.publish_payload` — turn a drafted content item into exactly the
 * input `publish.now` takes, and nothing else.
 *
 * ── Why this is a tool rather than a few lines in the caller ─────────────
 *
 * Deciding what text actually goes out is a product decision, not a view
 * concern: which beats are copy, in what order, joined how, which assets count
 * as attachments. `apps/api/src/scheduler.ts` has always made that decision for
 * the autopublish path. The Plan Queue's "Send now" button needed the same
 * answer and had no way to ask for it, so it sat disabled for weeks behind a
 * tooltip claiming — wrongly — that no publish-now tool existed.
 *
 * The browser could have assembled it. That is the thing not to do: a second
 * copy of this rule in the client is free to drift from the scheduler's, and
 * the failure mode is a post that goes out *differently* depending on whether a
 * person or the clock sent it. Nobody would see that until a customer did.
 *
 * ── Why it does not publish, despite the obvious name for it ─────────────
 *
 * `content.publish_now` would be one call instead of two, and it would be
 * unsafe. `publish.now` declares `rights`, `platform_policy`, `claim_grounding`
 * and `compliance_profile`, and the invoke layer runs those against the tool's
 * **input** before the handler is entered (`runGuardrails(guards, input, ctx)`).
 * A tool taking only `{ contentItemId }` therefore publishes with the claim and
 * compliance guards blind — the text they exist to read is not there yet, and no
 * amount of assembling it inside the handler can put it somewhere the guardrails
 * already looked.
 *
 * `compliance_profile`'s own module says of the verticals it covers: *"Do not
 * ship these verticals without this in place — we would be generating liability
 * for customers at scale."* That is not a guard to route around for one fewer
 * round trip.
 *
 * The alternative was a handler that calls `invokeTool` on `publish.now`, which
 * keeps the guards and introduces tool reentrancy — something this codebase has
 * deliberately avoided everywhere, including keeping the agent runtime outside
 * the registry so it cannot invoke itself. Two honest calls beat one clever one.
 *
 * So: this reads, decides, and returns. The caller passes the result verbatim to
 * `publish.now`, which guards it exactly as it guards the scheduler's.
 */

export const ContentPublishPayloadInput = z.object({
  contentItemId: z.string().min(1),
  genomeId: z.string().min(1),
});

export const ContentPublishPayloadOutput = z.object({
  contentItemId: z.string(),
  playbookId: z.string(),
  /** The account this goes to — the item's own, else the playbook's first. */
  platform: z.string(),
  /** The caption, assembled from the text beats in order. */
  text: z.string(),
  referencedAssetIds: z.array(z.string()),
  mediaUrls: z.array(z.string()),
  why: Explanation,
});

/**
 * The caption: every text beat, in order, blank line between.
 *
 * Extracted from `scheduler.ts`, which had the only copy. Pure and exported so
 * the scheduler can keep using the identical function rather than a second one
 * that looks the same today.
 */
export function writtenText(beats: ResolvedBeat[]): string {
  return beats
    .filter((b): b is Extract<ResolvedBeat, { kind: 'text' }> => b.kind === 'text')
    .map((b) => b.text)
    .join('\n\n');
}

/**
 * The caption with the post's link on its own line at the end.
 *
 * The link is added here, at the last moment, rather than written into the copy:
 * a URL inside the text a writer is given gets read aloud by every playbook that
 * speaks its copy. Skipped when the caption already carries it, so a writer who
 * did include it, or a person who pasted it in, does not get it twice.
 */
export function withLink(text: string, linkUrl: string | null | undefined): string {
  const url = linkUrl?.trim();
  if (!url || text.includes(url)) return text;
  return text ? `${text}\n\n${url}` : url;
}

/** Asset beats, which the rights guardrail checks and the receipt records. */
export function referencedAssetIds(beats: ResolvedBeat[]): string[] {
  return beats
    .filter((b): b is Extract<ResolvedBeat, { kind: 'asset' }> => b.kind === 'asset')
    .map((b) => b.assetId);
}

/**
 * Generated media, by URL.
 *
 * Note what is absent: a `backdrop` attached to a text beat. Auto-illustration
 * attaches those behind the words for the *renderer*, and `compose.render`
 * turns the whole post into one file. Publishing a backdrop as a separate
 * attachment would post the raw b-roll beside the finished video.
 */
export function mediaUrls(beats: ResolvedBeat[]): string[] {
  return beats
    .filter(
      (
        b,
      ): b is Extract<
        ResolvedBeat,
        { kind: 'generated_image' | 'generated_video' | 'generated_audio' | 'generated_broll' | 'dubbed_media' }
      > =>
        b.kind === 'generated_image' ||
        b.kind === 'generated_video' ||
        b.kind === 'generated_audio' ||
        b.kind === 'generated_broll' ||
        b.kind === 'dubbed_media',
    )
    .map((b) => b.url);
}

export const contentPublishPayload = defineTool({
  name: 'content.publish_payload',
  version: 1,

  summary:
    'Assemble exactly what publish.now needs for a drafted post — caption, platform, assets, media. ' +
    'Reads only; publishing is a separate call. Free.',

  input: ContentPublishPayloadInput,
  output: ContentPublishPayloadOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,
  surfaces: ['CC-01', 'CC-03'],

  async handler(input, ctx) {
    if (input.genomeId !== ctx.genomeId) {
      throw new ToolError('ISOLATION_VIOLATION', 'genomeId does not match the active genome.', {
        requested: input.genomeId,
        active: ctx.genomeId,
      });
    }

    const item = await ctx.db.content.get(input.contentItemId, input.genomeId, ctx.orgId);
    if (!item) {
      throw new ToolError('NOT_FOUND', 'No such post.', { contentItemId: input.contentItemId });
    }
    if (item.status === 'published') {
      throw new ToolError('INVALID_INPUT', 'This post has already been published.', {
        contentItemId: input.contentItemId,
      });
    }
    if (!item.playbookId) {
      throw new ToolError('INVALID_INPUT', 'This post has no playbook, so there is no format to publish as.', {
        contentItemId: input.contentItemId,
      });
    }

    const parsed = z.array(ResolvedBeat).safeParse(item.copy);
    const beats = parsed.success ? parsed.data : [];
    const written = writtenText(beats);
    if (!written) {
      throw new ToolError(
        'INVALID_INPUT',
        'This post has no written copy yet. Draft it before publishing.',
        { contentItemId: input.contentItemId },
      );
    }

    /*
     * The item's own platform first, then the playbook's.
     *
     * Same order and the same reason as `scheduler.ts`: the calendar sets a
     * platform per slot, and a playbook that reaches here already names which
     * platforms it is for. Neither is a guess — if both are absent there is
     * genuinely no account to send to, and saying so beats choosing one.
     */
    const playbook = byId(item.playbookId);
    const platform = item.platform ?? playbook?.output.platforms[0];
    if (!platform) {
      throw new ToolError(
        'INVALID_INPUT',
        'No account is set for this post, and its format does not name one. Choose an account first.',
        { contentItemId: input.contentItemId, playbookId: item.playbookId },
      );
    }

    const text = withLink(written, item.linkUrl);
    const assets = referencedAssetIds(beats);
    const media = mediaUrls(beats);

    const why: Explanation = {
      summary: `Ready to publish ${item.playbookId} to ${platform}.`,
      factors: [
        { label: 'caption', detail: `${text.length} characters from ${beats.filter((b) => b.kind === 'text').length} beat(s)` },
        {
          label: 'account',
          detail: item.platform ? 'set on this post' : `not set on the post — using ${platform}, the format's first`,
        },
        ...(item.linkUrl ? [{ label: 'link', detail: `${item.linkUrl} added at the end` }] : []),
        ...(assets.length ? [{ label: 'assets', detail: `${assets.length} from the library` }] : []),
        ...(media.length ? [{ label: 'media', detail: `${media.length} generated file(s)` }] : []),
      ],
      evidence: [],
      alternatives: [],
    };

    return {
      contentItemId: item.id,
      playbookId: item.playbookId,
      platform,
      text,
      referencedAssetIds: assets,
      mediaUrls: media,
      why,
    };
  },
});
