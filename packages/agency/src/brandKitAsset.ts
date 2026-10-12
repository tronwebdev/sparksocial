import { EMBEDDING_DIM } from '@sparksocial/shared';
import type { ToolCtx } from '@sparksocial/tools/defineTool';

/**
 * Register the brand's logo as its `brand_kit` asset.
 *
 * ── The bug this closes ───────────────────────────────────────────────────
 *
 * Seven playbooks list `brand_kit` in `required_asset_roles`, and the resolver
 * gates on a *count* of assets holding that role. Setting a logo — generated or
 * uploaded — wrote `logoUrl` onto governance and created no asset, so a brand
 * that had just been given a logo still resolved **nothing**. A freshly
 * onboarded brand came out `0 of 13 buildable` with "a brand kit file" listed as
 * a blocker while its logo sat on the screen in front of the owner.
 *
 * ── Why this does not put the logo in front of retrieval ──────────────────
 *
 * `GovernancePanel.uploadLogo` deliberately skipped `asset.ingest_url`, on the
 * reasoning that an asset in the graph becomes "eligible for retrieval into
 * posts as though it were footage" and counts against the reuse cooldown. That
 * reasoning is right in general and does not apply to this role: **no beat in
 * any playbook sources `brand_kit`**. It appears only as a precondition, so
 * nothing retrieves it and the cooldown never sees it. The role is a capability
 * check — "does this brand have a visual identity yet" — not a content shelf.
 *
 * ── Cleared, not pending ──────────────────────────────────────────────────
 *
 * `asset.ingest_url` defaults to `pending`, which is the right default for
 * material of unknown provenance and the wrong one here: this is the brand's
 * own mark, either uploaded by its owner or generated for it by us. Left
 * pending it would be invisible anyway — `assetInventory` counts only `cleared`
 * — so the brand would still build nothing, one layer further down.
 *
 * ── The zero vector ───────────────────────────────────────────────────────
 *
 * `assets.create` requires an embedding and this asset is never retrieved, so
 * there is nothing meaningful to embed. A zero vector is honest about that, and
 * costs no embedding call during onboarding. Retrieval is role-scoped and no
 * beat asks for this role, so it cannot surface from the index either.
 */
export async function ensureBrandKitAsset(
  ctx: ToolCtx,
  args: {
    genomeId: string;
    url: string;
    businessName: string;
    source: string;
    /**
     * Embeds the caption, so the mark is findable in the Assets Library.
     *
     * This used to be a hardcoded zero vector, justified on the grounds that
     * nothing retrieves this role — true of *generation*, and false of the one
     * screen an owner actually looks at. The Assets Library grid is
     * `asset.retrieve`, which ranks by similarity: a zero vector matches no
     * query, so a brand's own logo was written to the table and then sorted
     * below everything for every search anybody could type. Reported as "I
     * uploaded a logo and cannot find it in the assets library", which is
     * exactly what it would look like.
     *
     * Optional, because a caller without an embedder is better off writing the
     * row than skipping it — the role gate is the more important half, and a
     * hard-to-find asset still unlocks seven playbooks.
     */
    embed?: (text: string) => Promise<number[]>;
  },
): Promise<{ created: boolean }> {
  const inventory = await ctx.db.assets.inventory(args.genomeId, ctx.orgId);
  // Idempotent: a brand that already has one keeps it. Re-generating a logo
  // should not leave a trail of brand-kit rows, and the count is all the
  // resolver reads.
  if ((inventory['brand_kit'] ?? 0) > 0) return { created: false };

  await ctx.db.assets.create({
    genomeId: args.genomeId,
    orgId: ctx.orgId,
    url: args.url,
    assetRole: 'brand_kit',
    mediaType: 'image',
    rightsStatus: 'cleared',
    caption: `${args.businessName} logo`,
    embedding: await embedding(args.businessName, args.embed),
    source: args.source,
  });
  return { created: true };
}

/** The caption's vector, or zeros when no embedder was supplied. */
async function embedding(
  businessName: string,
  embed: ((text: string) => Promise<number[]>) | undefined,
): Promise<number[]> {
  if (!embed) return new Array<number>(EMBEDDING_DIM).fill(0);
  // Never lose the asset row to a failed embedding: the row is what the
  // resolver counts, and zeros only cost findability.
  return embed(`${businessName} logo brand mark`).catch(() => new Array<number>(EMBEDDING_DIM).fill(0));
}
