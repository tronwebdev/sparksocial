ALTER TABLE "content_items" ADD COLUMN "variant_group_id" uuid;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "variant_label" text;--> statement-breakpoint
CREATE INDEX "content_items_variant_idx" ON "content_items" USING btree ("org_id","genome_id","variant_group_id");