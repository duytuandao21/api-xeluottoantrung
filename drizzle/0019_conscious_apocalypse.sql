CREATE TABLE "promotion_popup" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"promotion_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_popup_singleton" CHECK ("promotion_popup"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'promotion' NOT NULL,
	"image_url" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"starts_at" timestamp (3) with time zone NOT NULL,
	"ends_at" timestamp (3) with time zone NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "promotions_date_order" CHECK ("promotions"."ends_at" > "promotions"."starts_at"),
	CONSTRAINT "promotions_kind" CHECK ("promotions"."kind" IN ('promotion','event')),
	CONSTRAINT "promotions_title" CHECK (length(trim("promotions"."title")) BETWEEN 1 AND 240)
);
--> statement-breakpoint
ALTER TABLE "promotion_popup" ADD CONSTRAINT "promotion_popup_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "promotions_public_dates_idx" ON "promotions" USING btree ("is_published","starts_at","ends_at") WHERE "promotions"."deleted_at" IS NULL;
--> statement-breakpoint
INSERT INTO promotion_popup (id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_popup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON promotions, promotion_popup FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON promotions, promotion_popup FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON promotions, promotion_popup FROM authenticated;
  END IF;
END $$;
