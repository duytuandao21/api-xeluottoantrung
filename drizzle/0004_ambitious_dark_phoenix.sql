CREATE TABLE "accessory_brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"image_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accessory_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accessories" ADD COLUMN "brand_id" uuid;--> statement-breakpoint
ALTER TABLE "accessories" ADD COLUMN "category_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "accessory_brands_name_uq" ON "accessory_brands" USING btree (lower(btrim("name")));--> statement-breakpoint
CREATE INDEX "accessory_brands_status_order_idx" ON "accessory_brands" USING btree ("status","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "accessory_categories_name_uq" ON "accessory_categories" USING btree (lower(btrim("name")));--> statement-breakpoint
CREATE INDEX "accessory_categories_status_order_idx" ON "accessory_categories" USING btree ("status","sort_order");--> statement-breakpoint
INSERT INTO "accessory_brands" ("name")
SELECT DISTINCT ON (lower(btrim("brand"))) btrim("brand")
FROM "accessories"
WHERE btrim("brand") <> ''
ORDER BY lower(btrim("brand")), btrim("brand");--> statement-breakpoint
UPDATE "accessories" AS accessory
SET "brand_id" = brand."id", "brand" = brand."name"
FROM "accessory_brands" AS brand
WHERE lower(btrim(accessory."brand")) = lower(btrim(brand."name"));--> statement-breakpoint
ALTER TABLE "accessories" ADD CONSTRAINT "accessories_brand_id_accessory_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."accessory_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accessories" ADD CONSTRAINT "accessories_category_id_accessory_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."accessory_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accessories_brand_idx" ON "accessories" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "accessories_category_idx" ON "accessories" USING btree ("category_id");
