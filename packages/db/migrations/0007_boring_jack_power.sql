CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"genome_id" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"evidence_url" text,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by" text,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "consent_records_lookup_idx" ON "consent_records" USING btree ("org_id","genome_id","kind","granted_at" DESC NULLS LAST);