ALTER TABLE "credit_ledger" ADD COLUMN "external_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_external_idx" ON "credit_ledger" USING btree ("external_ref");