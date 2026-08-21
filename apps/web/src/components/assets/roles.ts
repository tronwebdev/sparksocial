/**
 * `AssetRole` (packages/shared/src/types.ts), labeled for display. Kept as data,
 * same reasoning as `nav-items.ts`.
 *
 * Mirrored rather than imported from `@sparksocial/shared`, which is the same
 * choice `questions.ts` and `WhyPopover` make and for the same reason: that
 * package has no build output — `exports` points straight at `./src/*.ts`, whose
 * own imports carry `.js` specifiers — so a `next build` that reaches it fails
 * with "Can't resolve './types.js'". CLAUDE.md permits the import; the build
 * does not. Verified by trying it.
 *
 * The labels here must therefore stay in step with `ASSET_ROLE_WORDS` in
 * `packages/shared`, which is what the server-side `why` sentences use. They are
 * the same words, capitalised — these head a dropdown, those sit mid-sentence.
 */
export const ASSET_ROLES = [
  { value: 'talent_likeness', label: 'Talent likeness' },
  { value: 'product_screen', label: 'Product screen' },
  { value: 'work_artifact', label: 'Work artifact' },
  { value: 'physical_capture', label: 'Physical capture' },
  { value: 'product_shot', label: 'Product shot' },
  { value: 'social_proof', label: 'Social proof' },
  { value: 'knowledge', label: 'Knowledge' },
  { value: 'past_post', label: 'Past post' },
  { value: 'brand_kit', label: 'Brand kit' },
] as const;
