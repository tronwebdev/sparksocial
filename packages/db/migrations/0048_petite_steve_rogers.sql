CREATE TABLE "org_credit_allocations" (
	"org_id" text NOT NULL,
	"category" text NOT NULL,
	"cap_cents" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_credit_allocations_org_id_category_pk" PRIMARY KEY("org_id","category")
);
