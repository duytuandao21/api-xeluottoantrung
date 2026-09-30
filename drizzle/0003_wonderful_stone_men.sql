CREATE TABLE "accessories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"brand" text NOT NULL,
	"price" bigint NOT NULL,
	"image_url" text NOT NULL,
	"image_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "accessories_status_order_idx" ON "accessories" USING btree ("status","sort_order");