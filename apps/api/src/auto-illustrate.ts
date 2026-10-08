import { invokeTool, type InvokeDeps, type InvokeRequest, type ScopedDb, type ToolCtx } from '@sparksocial/tools';
import { ResolvedBeat } from '@sparksocial/generate';
import type { Playbook } from '@sparksocial/playbooks';
import { envNum } from './env.js';

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
  /**
   * Turns a beat into a description of a picture. Optional: absent falls back
   * to sending the copy, which is what this did before and is worse rather
   * than broken.
   */
  sceneBrief?: {
    describe(a: {
      copy: string;
      brand: string;
      kind: 'video' | 'image';
      role?: string;
      seconds?: number;
      format?: string;
      objective?: string;
      products?: string;
      pillar?: string;
      priceTier?: string;
      tone?: string;
      place?: string;
    }): Promise<string | undefined>;
  };
}

/**
 * How many beats one post will illustrate.
 *
 * Generation is charged per clip, so an eight-slide carousel could quietly
 * cost eight times what a single image does. Beyond a handful the backdrop
 * stops being the point of the post anyway.
 */
const MAX_BEATS = 4;

/**
 * The longest single clip the configured model will make.
 *
 * Ten was LTX's and Kling's ceiling, hardcoded here as though it were a
 * property of video generation rather than of one vendor's endpoint. It is not:
 * Seedance 2.5 takes four to thirty seconds. Left at ten, a forty-second
 * narration is split into four clips and charged four times when two would
 * cover it — and four cuts read as four cuts, where the longer take holds.
 *
 * So it moves with the model, like `FAL_VIDEO_DURATIONS` next to it in
 * `video-client.ts`. The split logic is unchanged and still does the right
 * thing at either value; it was only ever the number that was wrong.
 */
const MAX_CLIP_SEC = envNum('FAL_VIDEO_MAX_CLIP_SEC', 10);

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
  /** Beats given a narration track. Video only; stills have nothing to say. */
  narrated: number;
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
  const result: IllustrateResult = { fromAssets: 0, generated: 0, narrated: 0 };

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

  /*
   * Beats that have no picture yet, in either shape.
   *
   * `!b.backdrop` alone missed the flat `backdropUrl` a beat written before the
   * multi-clip change carries, so every one of those looked unillustrated and
   * would have been illustrated a second time — money spent replacing a picture
   * that was already there.
   */
  const needing = beats.filter(
    (b): b is Extract<ResolvedBeat, { kind: 'text' }> => b.kind === 'text' && !b.backdrop && !b.backdropUrl,
  );
  if (needing.length === 0) return { beats, result };

  const wantsVideo = playbook.output.media_type === 'video';
  const aspect = playbook.output.aspect_ratios[0] ?? (wantsVideo ? '9:16' : '4:5');

  /*
   * What this business is, in its own words.
   *
   * The scene brief needs it or it writes a photograph of the *category* — any
   * bakery, any bike shop — when the whole point of illustrating from the
   * genome is that the picture should look like this one.
   */
  const genome = await args.deps.db.genomes.get(args.genomeId, args.ctx.orgId).catch(() => undefined);
  const brandDescription = [genome?.identity?.business_name, genome?.identity?.one_liner]
    .filter(Boolean)
    .join(' — ');

  /*
   * What kind of picture this brand's pictures should be.
   *
   * These go to the brief as descriptive facts, never as a branch. A price tier
   * mapped to a lens in here would give every premium brand one identical look,
   * which is the constant aesthetic the brief was rewritten to get rid of — and
   * branching on `identity.category` would be CLAUDE.md invariant 5 outright.
   * The model weighs them; this only supplies them.
   */
  const register = {
    ...(genome?.identity?.price_tier ? { priceTier: genome.identity.price_tier } : {}),
    ...(toneOf(genome?.voice?.tone_vector) ? { tone: toneOf(genome?.voice?.tone_vector)! } : {}),
    ...(placeOf(genome?.identity?.geography) ? { place: placeOf(genome?.identity?.geography)! } : {}),
    pillar: playbook.content_pillar,
    /*
     * What the post is *for*, which is what was missing.
     *
     * The brief used to get price tier, tone and place — everything about how
     * the picture should look and nothing about what it has to do. So it wrote
     * competent, atmospheric footage for a format called "Comparison (X vs Y)"
     * without ever being told a comparison was wanted, and an ambient shot of a
     * shop counter for a CTA whose entire job is to sell something.
     *
     * The playbook already says what the post does and the genome already says
     * what the business sells and what the campaign is chasing. None of it was
     * being passed. It is passed as description, not as a branch — the model
     * weighs it, nothing here maps a format to a shot.
     */
    format: `${playbook.name} — ${playbook.description}`,
    ...(genome?.dimensions?.objective ? { objective: genome.dimensions.objective } : {}),
    ...(productsOf(genome?.offer) ? { products: productsOf(genome?.offer)! } : {}),
  };

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

    /*
     * How many clips this beat needs to be covered rather than looped.
     *
     * Computed before either branch, because a long beat needs several clips
     * whether they come from the brand's library or from the generator. This
     * used to sit inside the generate branch only, so a fifty-second scene that
     * matched one of the brand's videos got that one clip and the renderer
     * stretched it over the whole scene — the exact defect the split exists to
     * prevent, on the path that reaches it first.
     */
    const wanted = wantsVideo
      ? Math.min(MAX_CLIPS_PER_BEAT, Math.max(1, Math.ceil((beat.durationSec ?? MAX_CLIP_SEC) / MAX_CLIP_SEC)))
      : 1;

    const fromPool = pool.slice(poolIndex, poolIndex + wanted).filter((a) => a.kind === pool[poolIndex]?.kind);
    if (fromPool.length > 0) {
      poolIndex += fromPool.length;
      out[at] = { ...out[at]!, backdrop: { kind: fromPool[0]!.kind, urls: fromPool.map((a) => a.url) } };
      result.fromAssets += fromPool.length;
      continue;
    }

    /* ── 2. Nothing of the brand's fits. Make something. ─────────────────── */

    /*
     * Enough clips to cover the beat, not one clip stretched over it.
     *
     * The generator caps at ten seconds; a fifty-second narration given a
     * single clip is the same five seconds looping ten times, which reads as a
     * broken video rather than as footage. `wanted` is computed above, because
     * the asset branch needs the same number.
     */
    const urls: string[] = [];
    for (let clip = 0; clip < wanted && budget.left > 0; clip += 1) {
      const made = await generateBackdrop({
        ...args,
        beat,
        wantsVideo,
        aspect,
        brandDescription,
        register,
        clip,
        of: wanted,
      });
      if (!made) break;
      urls.push(made);
      budget.left -= 1;
    }
    if (urls.length === 0) continue;
    out[at] = { ...out[at]!, backdrop: { kind: wantsVideo ? 'video' : 'image', urls } };
    result.generated += urls.length;
  }

  /*
   * ── 3. Give a video a voice ──────────────────────────────────────────────
   *
   * Generated footage is silent — fal's clips carry no audio — so a video post
   * came out as moving pictures with a paragraph printed across them and
   * nothing to hear. On a format called "voice-over b-roll" that is the whole
   * point missing.
   *
   * After the pictures, not before: a beat that could not be illustrated is not
   * worth narrating, and doing it in this order means a failed clip does not
   * leave a disembodied voice over a blank frame.
   */
  if (wantsVideo) {
    for (const beat of needing.slice(0, MAX_BEATS)) {
      const at = out.findIndex((b) => b.beatId === beat.beatId);
      if (at < 0) continue;
      const current = out[at]!;
      if (!current.backdrop || current.voiceoverUrl) continue;

      const spoken = await narrate({ ...args, beat });
      if (!spoken) continue;
      out[at] = { ...current, voiceoverUrl: spoken };
      result.narrated += 1;
    }
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
  /** What the business is, so the shot is of them and not of the category. */
  brandDescription: string;
  /** Genome and playbook facts that steer the brief's register. */
  register: { pillar?: string; priceTier?: string; tone?: string; place?: string };
  /** Which slice of the beat this clip covers, and how many there are. */
  clip: number;
  of: number;
}): Promise<string | undefined> {
  /*
   * A description of a picture, not the post's copy.
   *
   * The copy is marketing addressed to a reader — "Share your prep tips!" is
   * not a photograph, and a generator handed it renders something loosely
   * associated with the words. That is what made the output look invented
   * rather than unrealistic: the model was answering the wrong question.
   *
   * Falling back to the copy when no brief is available keeps the previous
   * behaviour rather than skipping the picture, which is the right trade for a
   * step that only ever improves the prompt.
   */
  const brief = await args.deps.sceneBrief?.describe({
    copy: args.beat.text,
    brand: args.brandDescription,
    kind: args.wantsVideo ? 'video' : 'image',
    ...(args.beat.label ? { role: args.beat.label } : args.beat.beatId ? { role: args.beat.beatId } : {}),
    ...(args.beat.durationSec ? { seconds: args.beat.durationSec } : {}),
    ...args.register,
  });

  const prompt = [
    brief ?? args.beat.text.slice(0, 300),
    /*
     * Clips of one beat must differ from each other or the split is pointless
     * — five takes of the same shot cut together is still one shot. The angle
     * is the cheapest thing to vary that does not change what is being shown.
     */
    args.of > 1 ? SHOT_ANGLES[args.clip % SHOT_ANGLES.length]! : '',
    /*
     * The look comes from the brief now, not from here.
     *
     * This line used to be unconditional: "Photographic, natural light,
     * shallow depth of field." on every generated frame for every brand. It is
     * a good description of one aesthetic and it made everything we produced
     * look like the same stock library — a market stall shot like a jewellery
     * campaign, a hook meant to read as a phone video shot on a prime lens.
     * `scene-brief.ts` now picks a register per shot from the genome, so
     * repeating a fixed one here would overrule it.
     *
     * It survives only on the fallback path, where there is no brief and the
     * prompt is the raw copy — a generic look is better than none at all.
     */
    brief ? '' : 'Photographic, natural light, shallow depth of field.',
    'No text, no letters, no words, no logos, no watermarks, no captions.',
    /*
     * Gone, because nothing is placed over it any more.
     *
     * This told every generated video to keep the middle of the frame empty for
     * type. That was true until narrated beats stopped printing their narration
     * (`zipTimeline`'s `spokenAloud`) — after which every clip was still being
     * composed around a caption that is never drawn, pushing the actual product
     * out to the edges of a frame whose middle is now the only thing anyone
     * looks at. The identical mistake had already been made and fixed for
     * stills, one line above, which is how it was recognised here.
     *
     * If burned-in captions come back, this comes back with them — and it
     * belongs next to whatever decides to draw them, not here.
     */
  ]
    .filter(Boolean)
    .join(' ');

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
/**
 * The brand's voice as a phrase a prompt model can act on.
 *
 * The genome stores four 0–1 axes, which mean nothing to a model asked for a
 * photograph — "formal: 0.2" does not suggest a lens. Naming only the axes that
 * are actually strong keeps the phrase short and keeps a brand that is
 * genuinely neutral from being described as neutral in five words.
 */
function toneOf(v: { formal: number; playful: number; technical: number; bold: number } | undefined): string | undefined {
  if (!v) return undefined;
  const said = [
    v.formal >= 0.6 ? 'formal' : v.formal <= 0.3 ? 'informal' : '',
    v.playful >= 0.6 ? 'playful' : '',
    v.technical >= 0.6 ? 'technical' : '',
    v.bold >= 0.6 ? 'bold' : '',
  ].filter(Boolean);
  return said.length > 0 ? said.join(', ') : undefined;
}

/**
 * Where the business works, for a world in frame that could plausibly be
 * theirs. `local` is the only scope where the place is a fact about the shot
 * rather than about the market — a global brand's footage is not "shot in
 * global".
 */
function placeOf(g: { scope: string; locale: string } | undefined): string | undefined {
  if (!g || g.scope !== 'local') return undefined;
  return g.locale || undefined;
}

const SHOT_ANGLES = [
  'Wide establishing shot.',
  'Close detail shot.',
  'Overhead shot.',
  'Low angle, shallow focus.',
  'Slow push in, mid shot.',
];

/**
 * Narrate one beat, keeping its words and its picture.
 *
 * `content.generate_voiceover` with `attach`, which is the difference between
 * "read this scene aloud" and "turn this scene into a sound". The default
 * replaces the beat, so calling it without the flag here would delete the copy
 * and the backdrop this module had just given it.
 *
 * A failure is not the post failing, for the same reason a failed backdrop is
 * not: the post still renders, just silently, which is what every video did
 * before this existed.
 */
async function narrate(args: {
  beat: Extract<ResolvedBeat, { kind: 'text' }>;
  contentItemId: string;
  genomeId: string;
  ctx: ToolCtx;
  brand: InvokeRequest['brand'];
  deps: AutoIllustrateDeps;
}): Promise<string | undefined> {
  const script = args.beat.text.trim();
  // The tool caps at 2,000 characters and refuses an empty script; a beat with
  // neither is nothing to read aloud rather than an error worth logging.
  if (script.length === 0) return undefined;

  const res = await (args.deps.invokeTool ?? invokeTool)(
    {
      tool: 'content.generate_voiceover',
      input: {
        contentItemId: args.contentItemId,
        genomeId: args.genomeId,
        beatId: args.beat.beatId,
        script: script.slice(0, 2_000),
        attach: true,
      },
      caller: 'agent',
      ctx: args.ctx,
      brand: args.brand,
      // Keyed on the beat and its words, so re-running the queue over unchanged
      // copy collapses onto one charge but a rewritten scene is read again.
      idempotencyKey: `voiceover:${args.contentItemId}:${args.beat.beatId}:${script.length}`,
    },
    args.deps.invoke,
  );

  if (res.status !== 'succeeded') {
    args.ctx.logger.warn('auto-illustrate: could not narrate this beat', {
      contentItemId: args.contentItemId,
      beatId: args.beat.beatId,
      why: res.status === 'failed' ? res.error.message : `held by policy (${res.decision.kind})`,
    });
    return undefined;
  }

  const url = (res.output as { url?: string } | undefined)?.url;
  return typeof url === 'string' && url.length > 0 ? url : undefined;
}

/**
 * What the business sells, as one line the brief can put in a frame.
 *
 * Names and prices together, because the price is the clearest signal of what
 * the thing physically is: "Earrings £9–£45" and "Earrings £900–£4,500" are not
 * the same object and should not be the same shot. Capped at three so a brand
 * with a long catalogue does not crowd out the rest of the brief.
 */
function productsOf(
  offer: { products?: Array<{ name?: string; price?: string }> } | undefined,
): string | undefined {
  const named = (offer?.products ?? [])
    .filter((p) => p?.name)
    .slice(0, 3)
    .map((p) => (p.price ? `${p.name} (${p.price})` : p.name!));
  return named.length > 0 ? named.join(', ') : undefined;
}
