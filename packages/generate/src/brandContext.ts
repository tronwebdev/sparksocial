import { article } from '@sparksocial/shared';

/**
 * THE BRAND CLAUSE — what a picture needs to know about whose picture it is.
 *
 * ── The defect this closes ───────────────────────────────────────────────
 *
 * `content.generate_image` passed its caller's `prompt` straight to the
 * vendor, unmodified. The Draft Panel's "Generate image" button calls it as
 * `onGenerateImage(beat.beatId, text)` — the beat's bare copy and nothing
 * else. So no brand ever reached a post image, and the model filled the gap
 * itself.
 *
 * Measured on the deployed site, against a brand whose palette was
 * `#0097FD` and whose owner had just answered "No one is going on camera":
 *
 *   * the image came back **purple**;
 *   * it starred a photorealistic presenter;
 *   * and from a slightly vaguer prompt it invented an entire other company,
 *     **"LeadNova"**, wordmark and tagline included, and put it on the card.
 *
 * None of that is the model misbehaving. It was asked to illustrate one
 * sentence with no further information, and it supplied the missing
 * information the only way it could.
 *
 * ── Why this is in the tool and not in the button ────────────────────────
 *
 * Because SPARK calls the same tool. Fixing the prompt in `DraftPanel` would
 * fix the one caller that happened to be looked at, and leave the agent — and
 * every future caller — composing their own. Invariant 1: the capability
 * belongs to the tool.
 *
 * ── The instruction not to invent a wordmark is the important one ─────────
 *
 * A generated logo on a real brand's post is worse than a plain image: it is
 * confidently wrong, it is the first thing a reader looks at, and it is the
 * failure that actually happened. Naming the brand is not enough on its own —
 * told only the name, the model draws the name as a logo. So it is told both
 * who the brand is *and* not to draw an identity for it.
 */

export interface BrandImageContext {
  /** What the business is called. Named so the model stops inventing one. */
  name?: string | undefined;
  /** Its category, for the register of the picture — "a jewellery retailer". */
  category?: string | undefined;
  /** One line on what it does, so the subject matter is about this business. */
  oneLiner?: string | undefined;
  /** `brandColors` from governance, already hex. */
  colors?: readonly string[] | undefined;
  /**
   * `talent_availability` from the genome.
   *
   * The dimension that decides whether a person may appear. A brand that
   * answered "no one is going on camera" is not refusing *photography* — it is
   * saying there is nobody to be the face of this, and a stock presenter is
   * exactly the lie it was refusing.
   */
  talent?: string | undefined;
}

/** How many colours are worth naming before the instruction stops being one. */
const MAX_COLOURS = 4;

/**
 * Compose the brand half of an image prompt.
 *
 * Returns `''` when there is genuinely nothing to say, so a caller can
 * concatenate unconditionally and a brand with no kit yet is no worse off
 * than before.
 */
export function brandImageClause(brand: BrandImageContext): string {
  const parts: string[] = [];

  const name = brand.name?.trim();
  const category = brand.category?.trim();

  if (name) {
    parts.push(
      `This is for ${name}${category ? `, ${article(category)} ${category}` : ''}.` +
        (brand.oneLiner?.trim() ? ` ${brand.oneLiner.trim()}` : ''),
    );
  } else if (category) {
    parts.push(`This is for ${article(category)} ${category}.`);
  }

  /*
   * Named colours, capped. Past about four a palette instruction stops
   * steering and starts reading as a list of suggestions — the same reason
   * `brand.logo.generate` names its own and says "use no other colour".
   */
  const colours = (brand.colors ?? []).filter((c) => /^#[0-9a-fA-F]{3,8}$/.test(c)).slice(0, MAX_COLOURS);
  if (colours.length > 0) {
    parts.push(
      `Use the brand palette: ${colours.join(', ')}. ` +
        'Neutrals, white and black are fine alongside them; do not introduce a different accent colour.',
    );
  }

  /*
   * The two instructions that exist because of what was actually generated.
   *
   * Always present, with or without a name: "do not invent a logo" is not a
   * refinement of knowing the brand, it is the rule that was broken.
   */
  parts.push(
    'Do not invent or draw a logo, wordmark, monogram, app icon or company name. ' +
      'Do not put a brand identity on the image that is not the one described.',
  );

  if (noPeople(brand.talent)) {
    parts.push(
      'No people: no faces, no presenters, no stock-photo models. ' +
        'Use the product, the work, objects, typography or abstract imagery instead.',
    );
  }

  return parts.join(' ');
}

/**
 * Whether this brand has anybody who may appear.
 *
 * `no` is the explicit refusal. An *absent* value is deliberately not treated
 * as a refusal: a brand that has not answered the question yet has not said no,
 * and silently forbidding people would make every un-onboarded brand's imagery
 * quietly different from every onboarded one for a reason nothing surfaces.
 */
function noPeople(talent: string | undefined): boolean {
  return talent === 'no';
}
