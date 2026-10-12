/**
 * Mirrors `packages/generate/src/draft.ts`'s `ResolvedBeat` — apps/web cannot
 * import that package (CLAUDE.md: only `@sparksocial/shared` from `packages/`),
 * so the wire shape is retyped here, the same way `CalendarBoard.tsx` retypes
 * its own `Slot`/`CalendarView`.
 */
/**
 * What a beat knows about its own shape, as of the draft owning its structure
 * (`beatShape` in packages/generate/src/draft.ts). Every field is optional
 * because a draft written before that change carries none of them — the panel
 * has to render a legacy beat without a duration rather than showing `NaN`.
 */
export interface BeatStructure {
  /** How long this scene runs. Absent on a legacy draft, where the playbook still decides. */
  durationSec?: number;
  /** The storyboard badge — "Hook", "CTA", "B-roll + text overlay". */
  label?: string;
  /** `M5`'s per-scene audio override. Absent means the post's default voice. */
  voice?: 'brand' | 'stock';
  /**
   * The picture or clip behind this beat's words — auto-illustration's output.
   *
   * The panel had no idea this existed. `content.generate_image` replaces a
   * beat and shows up as `kind: 'generated_image'`, which `BeatRow` draws; the
   * automatic path *attaches* instead, so the words stay the beat and the media
   * rides along here. Nothing rendered it, which is why a brand with sixty
   * illustrated posts saw sixty posts with no pictures.
   */
  backdrop?: { kind: 'image' | 'video'; urls: string[] };
  /**
   * The same thing, as it was written before the multi-clip change.
   *
   * A beat drafted then holds a flat `backdropUrl`/`backdropKind` pair, and
   * there are rows like that on disk. Declared so they survive the read rather
   * than being silently dropped — `backdropOf` is what everything else calls.
   */
  backdropUrl?: string;
  backdropKind?: 'image' | 'video';
}

/**
 * A beat's backdrop, whichever shape it was written in.
 *
 * Always call this rather than reading `backdrop` directly: the older flat pair
 * is the majority of what is currently stored, and code that only knows the new
 * shape shows those beats as having no media at all.
 */
export function backdropOf(beat: ResolvedBeat): { kind: 'image' | 'video'; urls: string[] } | undefined {
  if (beat.backdrop && beat.backdrop.urls.length > 0) return beat.backdrop;
  if (beat.backdropUrl) return { kind: beat.backdropKind ?? 'image', urls: [beat.backdropUrl] };
  return undefined;
}

export type ResolvedBeat = BeatStructure &
  (
    | { kind: 'asset'; beatId: string; assetId: string; role: string; caption: string | null }
    | { kind: 'text'; beatId: string; text: string }
    | { kind: 'generated_image'; beatId: string; url: string; prompt: string }
    | { kind: 'generated_video'; beatId: string; url: string; script: string }
    | { kind: 'generated_audio'; beatId: string; url: string; script: string }
    /** `content.generate_broll` — generative b-roll from a prompt, no likeness. */
    | { kind: 'generated_broll'; beatId: string; url: string; prompt: string }
    /** `content.generate_dub` — an existing beat's media re-voiced into `targetLanguage`, replacing it in place. */
    | { kind: 'dubbed_media'; beatId: string; url: string; targetLanguage: string; mediaType: 'video' | 'audio' }
  );

/**
 * Carry a beat's structure across an optimistic in-place replacement.
 *
 * `replaceBeat` swaps a whole beat object when a generate/save call returns, and
 * the replacement is built from the tool's response, which does not echo these
 * fields. Without this the scene visibly loses its duration and label the moment
 * you regenerate it, and gets them back only on reload — the same defect the
 * server-side `keepStructure` exists to prevent, one layer up.
 */
export function keepStructure(beat: ResolvedBeat): BeatStructure {
  return {
    ...(beat.durationSec !== undefined ? { durationSec: beat.durationSec } : {}),
    ...(beat.label !== undefined ? { label: beat.label } : {}),
    ...(beat.voice !== undefined ? { voice: beat.voice } : {}),
    // The backdrop belongs to the scene, not to what fills it — the same rule
    // `content.generate_image` follows server-side. Without this, regenerating
    // a beat's media threw its picture away.
    ...(beat.backdrop !== undefined ? { backdrop: beat.backdrop } : {}),
    ...(beat.backdropUrl !== undefined ? { backdropUrl: beat.backdropUrl } : {}),
    ...(beat.backdropKind !== undefined ? { backdropKind: beat.backdropKind } : {}),
  };
}

/** `mm:ss`, for the storyboard's per-scene range and its running total. */
export function clock(sec: number): string {
  const whole = Math.max(0, Math.round(sec));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Beat kinds that carry a real, playable media URL — the ones a "Dub" action can take as its source. */
export const DUBBABLE_BEAT_KINDS = ['generated_video', 'generated_audio', 'generated_broll', 'dubbed_media'] as const;

export interface DraftView {
  contentItemId: string;
  playbookId: string;
  /** True when the library no longer has that playbook — the post is readable, not redraftable. */
  playbookMissing?: boolean;
  mode: string;
  mediaType: 'video' | 'image' | 'carousel' | 'text';
  beats: ResolvedBeat[];
  /**
   * The post's hashtags, each with its `#`.
   *
   * Not beats, and deliberately so: `packages/compose` renders a text beat as a
   * full-screen type card, so hashtags in the storyboard would be burned into
   * the middle of the video. They are caption furniture, appended once by
   * `caption()`.
   *
   * Optional here because `DraftView` is also built from `content.draft`'s
   * output and from older rows drafted before the column existed.
   */
  hashtags?: string[];
  status?: string;
  /**
   * The campaign this post belongs to, when it belongs to one.
   *
   * Absent is a real and common state — a one-off post created outside the
   * campaign flow — and it has a consequence worth surfacing: autonomy is a
   * property of the campaign, so a post with none is held for review rather
   * than published.
   */
  campaignId?: string;
  /** The publish receipt — present once `status` is 'published' or 'rolled_back'. */
  platform?: string;
  externalId?: string;
  via?: string;
  url?: string;
  /** Why this item is not moving — set when `status` is 'blocked' or 'needs_review'. */
  blockedReason?: string;
  /** PRD §10's retry flow. 0 when nothing has been tried; see `content.get`'s own comment. */
  publishAttempts?: number;
  lastPublishError?: string;
  /**
   * The format's declared duration band, from `content.get`.
   *
   * Present only on formats that have one — video. The storyboard uses it to show
   * headroom *before* an edit is attempted, because the scene tools refuse an
   * edit that leaves the band and a refusal after the fact reads as a bug.
   */
  durationBand?: [number, number];
  /**
   * Files `compose.render` has already produced for this post.
   *
   * The preview used to hold renders in state that only a fresh
   * `compose.render` ever filled, so a post the render queue had already
   * composed opened with no video and a Render button — a second charge for a
   * file that existed. `content.get` returns them now.
   */
  renders?: Array<{ aspect: string; url: string; engine: string }>;
  /** When this post goes out, ISO. Absent on a draft with no slot yet. */
  scheduledAt?: string;
}

export interface RankedPlaybook {
  playbook_id: string;
  name: string;
  mode: 'synthesize' | 'assemble' | 'direct_finish';
  content_pillar: string;
  score: number;
  unlockable: boolean;
  missing_roles: string[];
  /** `'upload'` — a file the owner supplies. `'capture'` — the WhatsApp capture loop. */
  unlocked_by?: 'upload' | 'capture';
}

/** `playbook.list`'s real output shape (`packages/playbooks/src/browse.ts`'s `PlaybookSummary`) — camelCase, distinct from `RankedPlaybook`'s snake_case (`playbook.resolve`'s shape). Do not conflate the two. */
export interface PlaybookSummary {
  playbookId: string;
  name: string;
  mode: 'synthesize' | 'assemble' | 'direct_finish';
}

/** PRD/plan's fixed platform set — `@sparksocial/publish`'s `Platform` enum, retyped for the same reason as `ResolvedBeat`. */
export const PLATFORMS = ['instagram', 'tiktok', 'linkedin', 'x', 'youtube_shorts'] as const;

/**
 * A brand-kit Templates preset — mirrors `KitTemplate` in
 * `packages/shared/src/brandKit.ts`, retyped here for the same reason as
 * `ResolvedBeat`: `apps/web` may not import that package.
 */
export interface KitTemplate {
  id: string;
  category: 'intro' | 'outro' | 'bumper' | 'caption' | 'lower_third';
  name: string;
  text: string;
}

/** The storyboard badge an applied preset arrives with. */
export const KIT_TEMPLATE_LABEL: Record<KitTemplate['category'], string> = {
  intro: 'Intro',
  outro: 'Outro',
  bumper: 'Bumper',
  caption: 'Caption',
  lower_third: 'Lower-third',
};

/**
 * The caption that actually goes out: copy, then hashtags, then the tracked link.
 *
 * One function because the Draft Panel was assembling this twice — once to show
 * a preview and once to publish — and two copies of "what the post says" are
 * free to drift. Showing a person one string and sending another is the kind of
 * bug nobody reports, because whoever sees it assumes they misread the preview.
 *
 * Hashtags sit above the link rather than below it: a trailing URL is what the
 * platform turns into a preview card, and a link buried under a row of tags
 * stops being clicked.
 */
export function caption(draft: Pick<DraftView, 'beats' | 'hashtags'>, shortUrl?: string | null): string {
  return [
    draft.beats
      .map((b) => (b.kind === 'text' ? b.text : ''))
      .filter(Boolean)
      .join('\n\n'),
    (draft.hashtags ?? []).join(' '),
    shortUrl,
  ]
    .filter(Boolean)
    .join('\n\n');
}
