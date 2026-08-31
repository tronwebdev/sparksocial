-- Autonomy is a property of a campaign (decided 22 August 2026).
--
-- `policy.ts` no longer reads `brands.approval_mode` when deciding whether a
-- publish needs review. It reads the campaign's own mode and treats an absent
-- one as "requires review". `campaigns.approval_mode` is nullable and was never
-- populated by `calendar.generate`, so without this backfill every post of every
-- existing campaign would queue for approval the moment that change deploys.
--
-- Each existing campaign therefore inherits its brand's mode, once, here — the
-- same "the brand is the template" rule new campaigns now follow at creation.
-- Only rows with no mode of their own are touched: a campaign that already
-- stated its posture chose it deliberately.
--
-- The join goes through `genomes.brand_id`, because campaigns carry a
-- `genome_id` and `brands.id` is the brand id. Note the TypeScript field is
-- named `brandId` and the schema comment calls it `Genome.workspace_id`; the
-- column is `brand_id`, which is what SQL has to say.
UPDATE campaigns c
   SET approval_mode = b.approval_mode
  FROM genomes g, brands b
 WHERE c.genome_id = g.id
   AND b.id = g.brand_id
   AND b.org_id = c.org_id
   AND c.approval_mode IS NULL;

-- Anything still null had no brand row to inherit from, which is a real state
-- for a campaign predating brand governance. It stays null and therefore
-- requires review, which is the safe end of the trade.
