ALTER TABLE "brands" ADD COLUMN "sales_qualification" jsonb;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "sales_handoff" jsonb;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "sales_destination" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "sales_escalation_keywords" jsonb;