/**
 * Which post formats each platform will actually take.
 *
 * ── Why this is a table and not a guess at the point of use ──────────────
 *
 * The draft panel offers a row of platforms and lets you pick one. Nothing
 * checked that the chosen platform could carry the post's format, so a
 * six-slide carousel could be addressed to TikTok and the refusal arrived from
 * the adapter at publish time, after the work was done. The design says this
 * out loud instead — `DP prevCarousel.dc.html` greys TikTok out and prints
 * "TikTok doesn't support carousels — disabled" under the row.
 *
 * ── Two different kinds of "no" ──────────────────────────────────────────
 *
 * Most entries here are the platform's own rule: X has no multi-image carousel
 * post, YouTube Shorts is video, Pinterest does not take a bare caption. One
 * is ours — TikTok *does* publish photo carousels, through
 * `/v2/post/publish/content/init/` with `media_type: PHOTO`, and
 * `tiktokAdapter.ts` says in its own header that only the video flow is built.
 * The reason string distinguishes them, because "they don't allow it" and "we
 * haven't built it" are different facts and only the second one is a to-do.
 *
 * Keep this beside `PLATFORM_LIMITS`, which answers the other half of the same
 * question — that one is "will the caption fit", this one is "will the post go
 * at all".
 */

export type PostFormat = 'image' | 'video' | 'carousel' | 'text';

export interface FormatSupport {
  ok: boolean;
  /** Shown to a person when `ok` is false. Names the platform, not the code. */
  reason?: string;
}

const NO = (reason: string): FormatSupport => ({ ok: false, reason });
const YES: FormatSupport = { ok: true };

/**
 * Absent platform, or absent format on a present platform, means "no profile".
 * `platformTakes` reports that as allowed rather than inventing a refusal —
 * the same stance `PLATFORM_LIMITS` takes for Reddit and Google Business.
 */
const SUPPORT: Record<string, Partial<Record<PostFormat, FormatSupport>>> = {
  instagram: { image: YES, video: YES, carousel: YES, text: NO('Instagram posts need an image or a video.') },
  tiktok: {
    image: NO('TikTok posts are video or photo carousels, not single images.'),
    video: YES,
    // Ours, not theirs. See the header.
    carousel: NO("TikTok carousels aren't wired up yet — only the video flow is built."),
    text: NO('TikTok posts need media.'),
  },
  youtube_shorts: {
    image: NO('Shorts are video.'),
    video: YES,
    carousel: NO('Shorts are video.'),
    text: NO('Shorts are video.'),
  },
  linkedin: { image: YES, video: YES, carousel: YES, text: YES },
  facebook: { image: YES, video: YES, carousel: YES, text: YES },
  x: { image: YES, video: YES, carousel: NO('X has no carousel post — send the slides as one image set or pick another platform.'), text: YES },
  threads: { image: YES, video: YES, carousel: YES, text: YES },
  pinterest: { image: YES, video: YES, carousel: YES, text: NO('A Pin needs an image or a video.') },
  bluesky: { image: YES, video: NO('Bluesky has no video post.'), carousel: NO('Bluesky has no carousel post.'), text: YES },
};

/** Whether `platform` will take a post of this format, and why not if it will not. */
export function platformTakes(platform: string, format: PostFormat): FormatSupport {
  return SUPPORT[platform]?.[format] ?? YES;
}
