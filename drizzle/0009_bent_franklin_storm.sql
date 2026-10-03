CREATE TABLE "driving_experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"category_id" uuid,
	"excerpt" text,
	"content" text NOT NULL,
	"image_url" text,
	"author_name" text,
	"featured" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "driving_experiences" ADD CONSTRAINT "driving_experiences_category_id_article_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."article_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "driving_experiences_slug_uq" ON "driving_experiences" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "driving_experiences_status_published_idx" ON "driving_experiences" USING btree ("status","published_at");