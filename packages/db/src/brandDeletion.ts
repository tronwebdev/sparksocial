import { eq, inArray, and, count } from 'drizzle-orm';
import {
  approvals,
  brandEngagementSettings,
  brandMembers,
  brands,
  campaigns,
  consentRecords,
  genomes,
  humanMessages,
  reviewLinks,
} from './schema.js';
import { countEverythingForGenomes, deleteEverythingForGenomes } from './scoped.js';
import type { BrandDeletionCounts } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';

/**
 * Erase a brand and everything made for it — except the records that are not
 * the brand's to erase.
 *
 * ── Where the genome-scoped half lives ───────────────────────────────────
 *
 * Not here. `assets`, `content_items`, `memories`, `knowledge_chunks` and the
 * rest go through `deleteEverythingForGenomes` in `scoped.ts`, because that
 * module is the only one allowed to touch them — `test/isolation.test.ts`
 * rejected the first version of this file for importing them directly, which
 * is the test doing exactly its job. What is left below is the tables that are
 * genuinely outside the genome scope: the brand's own governance rows, its
 * campaigns, and its consent records.
 *
 * ── What survives, and why ───────────────────────────────────────────────
 *
 * Four tables carry a brand id and are nonetheless left alone, because none of
 * them is brand-owned data:
 *
 *   * `tool_calls` is the audit trail. Its value is that it is complete — an
 *     audit log with holes in it answers "what happened" with "some of what
 *     happened", and the holes are exactly where somebody deleted something.
 *   * `credit_ledger` is billing history. CLAUDE.md is explicit that the credit
 *     model depends on this data existing from day one; deleting a brand would
 *     otherwise reduce an org's past spend retroactively, which is an invoice
 *     changing after it was paid.
 *   * `leads` is the agency's sales pipeline, scoped to the *org*. Its
 *     `converted_brand_id` is a pointer to a brand, not a claim of ownership by
 *     one, and a lead that was won and later dropped is still a lead that was
 *     won. Cascading here would delete an agency's pipeline as a side effect of
 *     tidying up one client.
 *   * `idempotency_reservations` has neither a brand nor an org column — it is
 *     keyed by an opaque reservation key and expires on its own. There is no
 *     predicate that could scope it to a brand, so it is not this operation's
 *     to touch.
 *
 * None of them leaks anything once the brand is gone: the id they carry
 * resolves to nothing, and no screen can reach them by it.
 *
 * If a genuine erasure request ever needs those rows gone too, that is a
 * different operation with a different name and a different authority behind
 * it — not a fallthrough of the delete button.
 *
 * ── One transaction ──────────────────────────────────────────────────────
 *
 * Deletes that half-succeed leave a brand that is partly gone: invisible in the
 * list, with assets still billed for and content still on a schedule. There are
 * no foreign keys in this schema, so nothing else enforces the all-or-nothing.
 */

/** This brand's genome ids, which every scoped statement is keyed on. */
async function genomeIdsFor(db: Database, scope: { orgId: string; brandId: string }): Promise<string[]> {
  const rows = await db
    .select({ id: genomes.id })
    .from(genomes)
    .where(and(eq(genomes.orgId, scope.orgId), eq(genomes.brandId, scope.brandId)));
  return rows.map((g) => g.id);
}

/**
 * What the delete would destroy, for the confirmation dialog.
 *
 * Counted before anything is touched and shown to the person typing the brand
 * name, because "this deletes 148 assets and 32 posts" is a different decision
 * from "this deletes a brand" — and the second is what somebody thinks they are
 * doing when the first is true.
 */
export async function countBrandContents(
  db: Database,
  scope: { orgId: string; brandId: string },
): Promise<BrandDeletionCounts> {
  const genomeIds = await genomeIdsFor(db, scope);
  if (genomeIds.length === 0) {
    return { assets: 0, contentItems: 0, campaigns: 0, recipes: 0, genomes: 0 };
  }

  const scopedCounts = await countEverythingForGenomes(db, { orgId: scope.orgId, genomeIds });

  // `campaigns` is not a scoped table, so it is counted here rather than there.
  const [campaignRow] = await db
    .select({ n: count() })
    .from(campaigns)
    .where(and(eq(campaigns.orgId, scope.orgId), inArray(campaigns.genomeId, genomeIds)));

  return {
    ...scopedCounts,
    campaigns: campaignRow?.n ?? 0,
    genomes: genomeIds.length,
  };
}

export async function deleteBrandCascade(
  db: Database,
  scope: { orgId: string; brandId: string },
): Promise<BrandDeletionCounts> {
  const counts = await countBrandContents(db, scope);

  await db.transaction(async (tx) => {
    /*
     * Re-read inside the transaction rather than reusing the ids the count
     * above saw. A genome created between the two reads would otherwise
     * survive its own brand, and be unreachable: nothing lists a genome whose
     * brand is gone.
     */
    const genomeIds = await genomeIdsFor(tx, scope);

    if (genomeIds.length > 0) {
      await deleteEverythingForGenomes(tx, { orgId: scope.orgId, genomeIds });

      /* The genome-keyed tables that are not in `SCOPED_TABLES`. */
      for (const table of [campaigns, consentRecords] as const) {
        await tx.delete(table).where(and(eq(table.orgId, scope.orgId), inArray(table.genomeId, genomeIds)));
      }
    }

    /* The brand's own rows — governance, membership, and the human loop. */
    for (const table of [humanMessages, brandEngagementSettings, approvals, brandMembers, reviewLinks] as const) {
      await tx.delete(table).where(and(eq(table.orgId, scope.orgId), eq(table.brandId, scope.brandId)));
    }

    /* The genomes, then the brand itself — last, so a failure anywhere above
       leaves the brand still findable rather than orphaning its contents. */
    await tx.delete(genomes).where(and(eq(genomes.orgId, scope.orgId), eq(genomes.brandId, scope.brandId)));
    await tx.delete(brands).where(and(eq(brands.orgId, scope.orgId), eq(brands.id, scope.brandId)));
  });

  return counts;
}
