ALTER TABLE "assets" ADD COLUMN "filename" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "archived_at" timestamp with time zone;