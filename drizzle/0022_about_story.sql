CREATE TABLE "about_customer_stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"quote" text,
	"display_name" text,
	"consent_status" text DEFAULT 'missing' NOT NULL,
	"consent_reference" text,
	"publish_status" text DEFAULT 'draft' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "about_story_consent_ck" CHECK ("about_customer_stories"."consent_status" IN ('missing','granted','revoked')),
	CONSTRAINT "about_story_publish_ck" CHECK ("about_customer_stories"."publish_status" IN ('draft','published'))
);
--> statement-breakpoint
CREATE TABLE "about_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"period_label" text NOT NULL,
	"event_date" text,
	"stage" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"body" text,
	"featured" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"verification_status" text DEFAULT 'needs_review' NOT NULL,
	"publish_status" text DEFAULT 'draft' NOT NULL,
	"source_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "about_milestone_stage_ck" CHECK ("about_milestones"."stage" IN ('1997-2017','2018-2022','2024-2025','2026')),
	CONSTRAINT "about_milestone_verification_ck" CHECK ("about_milestones"."verification_status" IN ('verified','needs_review')),
	CONSTRAINT "about_milestone_publish_ck" CHECK ("about_milestones"."publish_status" IN ('draft','published'))
);
--> statement-breakpoint
CREATE TABLE "about_story_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" text NOT NULL,
	"owner_key" text NOT NULL,
	"placement" text NOT NULL,
	"storage_key" text NOT NULL,
	"public_url" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"alt_text" text NOT NULL,
	"rights_status" text DEFAULT 'needs_review' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "about_story_asset_owner_ck" CHECK ("about_story_assets"."owner_type" IN ('section','milestone','story')),
	CONSTRAINT "about_story_asset_placement_ck" CHECK ("about_story_assets"."placement" IN ('desktop','mobile','gallery')),
	CONSTRAINT "about_story_asset_rights_ck" CHECK ("about_story_assets"."rights_status" IN ('verified','needs_review')),
	CONSTRAINT "about_story_asset_size_ck" CHECK ("about_story_assets"."size_bytes" > 0 AND "about_story_assets"."width" > 0 AND "about_story_assets"."height" > 0)
);
--> statement-breakpoint
CREATE TABLE "about_story_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"published_revision" integer,
	"published_snapshot" jsonb,
	"published_at" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "about_story_revision_nonnegative" CHECK ("about_story_pages"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "about_story_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_key" text NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"body" text,
	"cta_label" text,
	"cta_href" text,
	"visible" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "about_story_chapter_key_ck" CHECK ("about_story_sections"."chapter_key" IN ('opening','milestones','stories','people','future'))
);
--> statement-breakpoint
ALTER TABLE "about_story_pages" ADD CONSTRAINT "about_story_pages_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "about_customer_stories_order_idx" ON "about_customer_stories" USING btree ("sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "about_milestones_slug_uq" ON "about_milestones" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "about_milestones_order_idx" ON "about_milestones" USING btree ("sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "about_story_asset_key_uq" ON "about_story_assets" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "about_story_asset_owner_idx" ON "about_story_assets" USING btree ("owner_type","owner_key");--> statement-breakpoint
CREATE UNIQUE INDEX "about_story_sections_chapter_uq" ON "about_story_sections" USING btree ("chapter_key");