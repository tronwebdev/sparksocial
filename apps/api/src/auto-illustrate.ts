import { invokeTool, type InvokeDeps, type InvokeRequest, type ScopedDb, type ToolCtx } from '@sparksocial/tools';
import { ResolvedBeat } from '@sparksocial/generate';
import type { Playbook } from '@sparksocial/playbooks';

/**
 * AUTO-ILLUSTRATION — give a post pictures before it is rendered.
 *
 * ── What it is fixing ─────────────────────────────────────────────────────
 *
 * A brand with no footage got white type on a flat ground for every post in
 * its calendar. The calendar said "video", the post said "video", and what
 * came out was a caption on a black rectangle — correct, and
 * indistinguishable from a placeholder.
 *
 * ── Assets first. Generation is the fallback, not the strategy ────────────
 *
 * The brand's own photographs are better than anything a model will invent
 * about it, they cost nothing, and they are *true* — a generated picture of a
 * bakery is not that bakery. So this searches the Asset Graph first, with no
 * role filter: the roles exist to decide which formats a brand can build, and
 * by this point that decision is made. The question here is narrower — "is
 * there a picture of this brand that suits these words" — and a product shot
 * answers it as well as a work artifact does.
 *
 * Only when the brand has nothing usable does it generate, and then it says so
 * in the log, because "we made this up" is a different fact from "this is your
 * photograph" and the difference matters when somebody reviews the post.
 *
 * ── Backdrops, not replacements ───────────────────────────────────────────
 *
 * `content.generate_image` and `content.generate_broll` replace the beat they
 * are given. That is right when somebody asks to illustrate one scene and
 * wrong as an automatic step: a text beat *is* the copy, so replacing it
 * produces a picture with the message thrown away. Everything here attaches to
 * the beat instead — see `backdropUrl` in `packages/generate/src/draft.ts`.
 */

export interface AutoIllustrateDeps {
  db: ScopedDb;
  invoke: InvokeDeps;
  embed: { embed(text: string): Promise<number[]> };
  /**
   * The tool invoker, injectable so a test can tell "found a picture" from
   * "made one" — the distinction this whole module is arranged around, and
   * one that is invisible from the outside otherwise.
   */
  invokeTool?: typeof invokeTool;
}

/**
 * How many beats one post will illustrate.
 *
 * Generation is charged per clip, so an eight-slide carousel could quietly
 * cost eight times what a single image does. Beyond a handful the backdrop
 * stops being the point of the post anyway.
 */
const MAX_BEATS = 4;

/** fal's ceiling for one generated clip. */
const MAX_CLIP_SEC = 10;

/**
 * How many clips one beat may be split into, and how many a post may spend.
 *
 * A clip is charged individually, so a fifty-second narration wanting five of
 * them is five times the cost of a still. The per-post ceiling is the one that
 * matters: it is what stops a single video playbook spending more than the
 * rest of a brand's month.
 */
const MAX_CLIPS_PER_BEAT = 5;
const MAX_CLIPS_PER_POST = 6;

export interface IllustrateResult {
  /** Beats given a backdrop, and where each one came from. */
  fromAssets: number;
  generated: number;
}

export async function autoIllustrate(args: {
  beats: ResolvedBeat[];
  playbook: Playbook;
  contentItemId: string;
  genomeId: string;
  ctx: ToolCtx;
  brand: InvokeRequest['brand'];
  deps: AutoIllustrateDeps;
}): Promise<{ beats: ResolvedBeat[]; result: IllustrateResult }> {
  const { beats, playbook } = args;
  const result: IllustrateResult = { fromAssets: 0, generated: 0 };

  // A text post has no pixels to fill. Nothing here applies.
  if (playbook.output.media_type === 'text') return { beats, result };

  /*
   * A post that already has visuals is left alone.
   *
   * Real media — a retrieved asset, a generated image, an avatar clip — means
   * the post is illustrated already and adding a backdrop would be a second
   * picture competing with the first.
   */
  const hasVisuals = beats.some((b) => b.kind !== 'text');
  if (hasVisuals) return { beats, result };

  const needing = beats.filter((b): b is Extract<ResolvedBeat, { kind: 'text' }> => b.kind === 'text' && !b.backdrop);
  if (needing.length === 0) return { beats, result };

  const wantsVideo = playbook.output.media_type === 'video';
  const aspect = playbook.output.aspect_ratios[0] ?? (wantsVideo ? '9:16' : '4:5');

  /* ── 1. The brand's own material, whatever role it carries ─────────────── */

  const pool = await findUsableAssets(args, needing.map((b) => b.text).join(' '), wantsVideo);

  const out = [...beats];
  let poolIndex = 0;
  /*
   * The whole post's generation allowance, in clips.
   *
   * Splitting a long beat multiplies what a post costs — a fifty-second
   * narration alone wants five clips — so the ceiling is per post rather than
   * per beat. Without it a single video playbook could quietly spend more than
   * a month of that brand's other output put together.
   */
  const budget = { left: MAX_CLIPS_PER_POST };

  for (const beat of needing.slice(0, MAX_BEATS)) {
    const at = out.findIndex((b) => b.beatId === beat.beatId);
    if (at < 0) continue;

    const asset = pool[poolIndex];
    if (asset) {
      poolIndex += 1;
      out[at] = { ...out[at]!, backdrop: { kind: asset.kind, urls: [asset.url] } };
      result.fromAssets += 1;
      continue;
    }

    /* ── 2. Nothing of the brand's fits. Make something. ─────────────────── */

    /*
     * Enough clips to cover the beat, not one clip stretched over it.
     *
     * The generator caps at ten seconds; a fifty-second narration given a
     * single clip is the same five seconds looping ten times, which reads as a
     * broken video rather than as footage.
     */
    const wanted = wantsVideo
      ? Math.min(MAX_CLIPS_PER_BEAT, Math.max(1, Math.ceil((beat.durationSec ?? MAX_CLIP_SEC) / MAX_CLIP_SEC)))
      : 1;
    const urls: string[] = [];
    for (let clip = 0; clip < wanted && budget.left > 0; clip += 1) {
      const made = await generateBackdrop({ ...args, beat, wantsVideo, aspect, clip, of: wanted });
      if (!made) break;
      urls.push(made);
      budget.left -= 1;
    }
    if (urls.length === 0) continue;
    out[at] = { ...out[at]!, backdrop: { kind: wantsVideo ? 'video' : 'image', urls } };
    result.generated += urls.length;
  }

  if (result.fromAssets || result.generated) {
    args.ctx.logger.info('auto-illustrated', {
      contentItemId: args.contentItemId,
      playbookId: playbook.playbook_id,
      fromAssets: result.fromAssets,
      // Logged apart from the asset count on purpose: "we made this up" is a
      // different fact from "this is your photograph".
      generated: result.generated,
    });
  }

  return { beats: out, result };
}

/**
 * The brand's own pictures, ranked against what the post says.
 *
 * No `requiredRoles`. The roles decide which formats a brand can build, and
 * that decision was made upstream; the question here is only whether a picture
 * of this brand suits these words.
 *
 * A video post prefers real video and will fall back to stills — a still
 * behind narration is a slideshow, which is a normal kind of post, where no
 * picture at all is a black rectangle.
 */
async function findUsableAssets(
  args: Parameters<typeof autoIllustrate>[0],
  subject: string,
  wantsVideo: boolean,
): Promise<Array<{ url: string; kind: 'image' | 'video' }>> {
  try {
    const embedding = await args.deps.embed.embed(subject.slice(0, 2_000));
    const found = await args.deps.db.assets.retrieve({
      genomeId: args.genomeId,
      orgId: args.ctx.orgId,
      embedding,
      k: MAX_BEATS * 2,
    });
    if (found.length === 0) return [];

    /*
     * `brand_kit` is the logo, and it is dropped here.
     *
     * It is already stamped on every frame as the watermark, so behind the
     * words as well it is the same mark twice, blown up and blurred. This is
     * also the one role that is guaranteed to exist — `ensureBrandKitAsset`
     * creates it whenever a logo is set — so without this filter a brand with
     * no photographs would reliably get its own logo as the backdrop of every
     * post, which is worse than the flat ground it replaced.
     */
    const candidates = found.filter((f) => f.role !== 'brand_kit');
    if (candidates.length === 0) return [];

    const info = await args.deps.db.assets.info(
      candidates.map((f) => f.assetId),
      args.genomeId,
      args.ctx.orgId,
    );

    const usable = candidates
      .map((f) => info[f.assetId])
      .filter((i): i is NonNullable<typeof i> => Boolean(i))
      // Rights are the publishing gate, not a nicety: a restricted asset must
      // not reach a rendered frame by a side door.
      .filter((i) => i.rightsStatus === 'cleared')
      .filter((i) => i.mediaType === 'image' || i.mediaType === 'video')
      .map((i) => ({ url: i.url, kind: i.mediaType === 'video' ? ('video' as const) : ('image' as const) }));

    // Real footage first for a video post; stills are the fallback within the
    // fallback rather than an equal option.
    return wantsVideo ? [...usable.filter((u) => u.kind === 'video'), ...usable.filter((u) => u.kind === 'image')] : usable;
  } catch (err: unknown) {
    args.ctx.logger.warn('auto-illustrate: asset lookup failed', {
      contentItemId: args.contentItemId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Make a backdrop for one beat.
 *
 * The prompt is the beat's own words plus what the brand is, and it asks for a
 * scene rather than a poster: the copy is rendered on top, so an image that
 * already contains writing would fight it. Image models put text in pictures
 * unless told not to, the same reason `brand.logo.generate` forbids lettering
 * three times over.
 */
async function generateBackdrop(args: {
  beat: Extract<ResolvedBeat, { kind: 'text' }>;
  playbook: Playbook;
  contentItemId: string;
  genomeId: string;
  ctx: ToolCtx;
  brand: InvokeRequest['brand'];
  deps: AutoIllustrateDeps;
  wantsVideo: boolean;
  aspect: string;
  /** Which slice of the beat this clip covers, and how many there are. */
  clip: number;
  of: number;
}): Promise<string | undefined> {
  const prompt = [
    args.beat.text.slice(0, 300),
    /*
     * Clips of one beat must differ from each other or the split is pointless
     * — five takes of the same shot cut together is still one shot. The angle
     * is the cheapest thing to vary that does not change what is being shown.
     */
    args.of > 1 ? SHOT_ANGLES[args.clip % SHOT_ANGLES.length]! : '',
    'Photographic, natural light, shallow depth of field.',
    'No text, no letters, no words, no logos, no watermarks, no captions.',
    'Leave the middle of the frame uncluttered — type is placed over it.',
  ].join(' ');

  const tool = args.wantsVideo ? 'content.generate_broll' : 'content.generate_image';
  const input = args.wantsVideo
    ? {
        contentItemId: args.contentItemId,
        genomeId: args.genomeId,
        beatId: args.beat.beatId,
        prompt,
        aspectRatio: args.aspect,
        durationSec: Math.min(MAX_CLIP_SEC, Math.max(1, Math.round(args.beat.durationSec ?? MAX_CLIP_SEC))),
      }
    : {
        contentItemId: args.contentItemId,
        genomeId: args.genomeId,
        beatId: args.beat.beatId,
        prompt,
        aspectRatio: args.aspect,
      };

  const res = await (args.deps.invokeTool ?? invokeTool)(
    {
      tool,
      input,
      caller: 'agent',
      ctx: args.ctx,
      brand: args.brand,
      /*
       * Keyed on the beat, so a retried render cannot pay twice for the same
       * picture. Both generators are non-idempotent by declaration, which is
       * right for somebody pressing the button and wrong for a loop.
       */
      idempotencyKey: `backdrop:${args.contentItemId}:${args.beat.beatId}:${args.clip}`,
    },
    args.deps.invoke,
  );

  if (res.status !== 'succeeded') {
    const why = res.status === 'failed' ? res.error.message : `held by policy (${res.decision.kind})`;
    /*
     * One beat failing to illustrate is not the post failing. It renders on the
     * brand's flat ground, which is what every post did before this existed.
     */
    args.ctx.logger.warn('auto-illustrate: could not generate a backdrop', {
      contentItemId: args.contentItemId,
      beatId: args.beat.beatId,
      why,
    });
    return undefined;
  }

  /*
   * Both tools *replace* the beat with the media they made, which is exactly
   * what must not happen here — the beat is the copy. So the URL is taken and
   * the write is undone by the caller re-saving the beats it holds, with the
   * backdrop attached and the text intact.
   */
  const out = res.output as { url?: string };
  return out.url;
}

/**
 * Varied framing across the clips of one beat.
 *
 * Five generations from an identical prompt come back as five near-identical
 * shots, and cutting those together looks like a stutter rather than like
 * coverage. Naming a different framing per clip is the smallest change that
 * makes the sequence read as one scene shot several ways.
 */
const SHOT_ANGLES = [
  'Wide establishing shot.',
  'Close detail shot.',
  'Overhead shot.',
  'Low angle, shallow focus.',
  'Slow push in, mid shot.',
];
