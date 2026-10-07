CREATE TYPE "public"."valuation_base_type" AS ENUM('ORIGINAL_MSRP', 'CURRENT_MSRP', 'MARKET_REFERENCE');--> statement-breakpoint
CREATE TYPE "public"."valuation_category" AS ENUM('AGE', 'ODO', 'EXTERIOR', 'INTERIOR', 'ACCIDENT', 'FLOOD', 'ENGINE', 'TRANSMISSION', 'SERVICE', 'OWNERS', 'USAGE', 'COLOR', 'MARKET');--> statement-breakpoint
CREATE TYPE "public"."valuation_policy_status" AS ENUM('DRAFT', 'VALIDATED', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."valuation_scope" AS ENUM('GLOBAL', 'BRAND', 'MODEL', 'VARIANT');--> statement-breakpoint
CREATE TABLE "valuation_condition_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"category" "valuation_category" NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_unknown" boolean DEFAULT false NOT NULL,
	"requires_inspection" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valuation_options_category" CHECK ("valuation_condition_options"."category" IN ('EXTERIOR','INTERIOR','ACCIDENT','FLOOD','ENGINE','TRANSMISSION','SERVICE','USAGE')),
	CONSTRAINT "valuation_options_order" CHECK ("valuation_condition_options"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "valuation_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"status" "valuation_policy_status" DEFAULT 'DRAFT' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"validated_revision" integer,
	"config" jsonb NOT NULL,
	"validation_report" jsonb,
	"created_by" uuid,
	"updated_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valuation_policy_revision_valid" CHECK ("valuation_policies"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "valuation_reference_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"model_year" integer NOT NULL,
	"original_msrp" bigint,
	"current_msrp" bigint,
	"market_reference" bigint,
	"base_price_type" "valuation_base_type" NOT NULL,
	"source" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"reference_age_years" numeric(6, 2),
	"reference_odometer_km" integer,
	"basis_note" text DEFAULT '' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valuation_reference_year" CHECK ("valuation_reference_prices"."model_year" BETWEEN 1886 AND 2100),
	CONSTRAINT "valuation_reference_prices_valid" CHECK (("valuation_reference_prices"."original_msrp" IS NULL OR "valuation_reference_prices"."original_msrp" BETWEEN 1 AND 9007199254740991) AND ("valuation_reference_prices"."current_msrp" IS NULL OR "valuation_reference_prices"."current_msrp" BETWEEN 1 AND 9007199254740991) AND ("valuation_reference_prices"."market_reference" IS NULL OR "valuation_reference_prices"."market_reference" BETWEEN 1 AND 9007199254740991)),
	CONSTRAINT "valuation_reference_selected_price" CHECK (CASE "valuation_reference_prices"."base_price_type" WHEN 'ORIGINAL_MSRP' THEN "valuation_reference_prices"."original_msrp" IS NOT NULL WHEN 'CURRENT_MSRP' THEN "valuation_reference_prices"."current_msrp" IS NOT NULL ELSE "valuation_reference_prices"."market_reference" IS NOT NULL END),
	CONSTRAINT "valuation_reference_dates" CHECK ("valuation_reference_prices"."effective_to" IS NULL OR "valuation_reference_prices"."effective_to" > "valuation_reference_prices"."effective_from"),
	CONSTRAINT "valuation_reference_market_basis" CHECK ("valuation_reference_prices"."base_price_type" <> 'MARKET_REFERENCE' OR ("valuation_reference_prices"."reference_age_years" IS NOT NULL AND "valuation_reference_prices"."reference_age_years" >= 0 AND "valuation_reference_prices"."reference_odometer_km" IS NOT NULL AND "valuation_reference_prices"."reference_odometer_km" >= 0 AND length(trim("valuation_reference_prices"."basis_note")) >= 3))
);
--> statement-breakpoint
CREATE TABLE "valuation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"category" "valuation_category" NOT NULL,
	"scope" "valuation_scope" DEFAULT 'GLOBAL' NOT NULL,
	"brand_id" uuid,
	"model_id" uuid,
	"variant_id" uuid,
	"option_id" uuid,
	"color_id" uuid,
	"min_value" numeric(14, 2),
	"max_value" numeric(14, 2),
	"adjustment_percent" numeric(6, 2) NOT NULL,
	"manual_inspection_required" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"label" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valuation_rule_scope_fk" CHECK (("valuation_rules"."scope" = 'GLOBAL' AND "valuation_rules"."brand_id" IS NULL AND "valuation_rules"."model_id" IS NULL AND "valuation_rules"."variant_id" IS NULL) OR ("valuation_rules"."scope" = 'BRAND' AND "valuation_rules"."brand_id" IS NOT NULL AND "valuation_rules"."model_id" IS NULL AND "valuation_rules"."variant_id" IS NULL) OR ("valuation_rules"."scope" = 'MODEL' AND "valuation_rules"."model_id" IS NOT NULL AND "valuation_rules"."brand_id" IS NULL AND "valuation_rules"."variant_id" IS NULL) OR ("valuation_rules"."scope" = 'VARIANT' AND "valuation_rules"."variant_id" IS NOT NULL AND "valuation_rules"."brand_id" IS NULL AND "valuation_rules"."model_id" IS NULL)),
	CONSTRAINT "valuation_rule_percent" CHECK ("valuation_rules"."adjustment_percent" BETWEEN -95 AND 100),
	CONSTRAINT "valuation_rule_range" CHECK ("valuation_rules"."min_value" IS NULL OR "valuation_rules"."max_value" IS NULL OR "valuation_rules"."min_value" < "valuation_rules"."max_value"),
	CONSTRAINT "valuation_rule_dates" CHECK ("valuation_rules"."effective_to" IS NULL OR "valuation_rules"."effective_from" IS NOT NULL AND "valuation_rules"."effective_from" < "valuation_rules"."effective_to"),
	CONSTRAINT "valuation_rule_selector" CHECK (CASE WHEN "valuation_rules"."category" IN ('AGE','ODO','OWNERS') THEN "valuation_rules"."option_id" IS NULL AND "valuation_rules"."color_id" IS NULL AND ("valuation_rules"."min_value" IS NOT NULL OR "valuation_rules"."max_value" IS NOT NULL) WHEN "valuation_rules"."category" = 'COLOR' THEN "valuation_rules"."color_id" IS NOT NULL AND "valuation_rules"."option_id" IS NULL AND "valuation_rules"."min_value" IS NULL AND "valuation_rules"."max_value" IS NULL WHEN "valuation_rules"."category" = 'MARKET' THEN "valuation_rules"."color_id" IS NULL AND "valuation_rules"."option_id" IS NULL AND "valuation_rules"."min_value" IS NULL AND "valuation_rules"."max_value" IS NULL ELSE "valuation_rules"."option_id" IS NOT NULL AND "valuation_rules"."color_id" IS NULL AND "valuation_rules"."min_value" IS NULL AND "valuation_rules"."max_value" IS NULL END)
);
--> statement-breakpoint
CREATE TABLE "valuation_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"active_policy_id" uuid,
	"disclaimer" text NOT NULL,
	"cta_label" text NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valuation_settings_singleton" CHECK ("valuation_settings"."id" = 1),
	CONSTRAINT "valuation_enabled_policy" CHECK (NOT "valuation_settings"."is_enabled" OR "valuation_settings"."active_policy_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "valuation_condition_options" ADD CONSTRAINT "valuation_condition_options_policy_id_valuation_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."valuation_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_condition_options" ADD CONSTRAINT "valuation_condition_options_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_policies" ADD CONSTRAINT "valuation_policies_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_policies" ADD CONSTRAINT "valuation_policies_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_policies" ADD CONSTRAINT "valuation_policies_published_by_profiles_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_reference_prices" ADD CONSTRAINT "valuation_reference_prices_policy_id_valuation_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."valuation_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_reference_prices" ADD CONSTRAINT "valuation_reference_prices_variant_id_car_versions_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."car_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_reference_prices" ADD CONSTRAINT "valuation_reference_prices_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_rules" ADD CONSTRAINT "valuation_rules_policy_id_valuation_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."valuation_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_rules" ADD CONSTRAINT "valuation_rules_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_rules" ADD CONSTRAINT "valuation_rules_model_id_car_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."car_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_rules" ADD CONSTRAINT "valuation_rules_variant_id_car_versions_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."car_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_rules" ADD CONSTRAINT "valuation_rules_option_id_valuation_condition_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."valuation_condition_options"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_rules" ADD CONSTRAINT "valuation_rules_color_id_car_colors_id_fk" FOREIGN KEY ("color_id") REFERENCES "public"."car_colors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_rules" ADD CONSTRAINT "valuation_rules_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_settings" ADD CONSTRAINT "valuation_settings_active_policy_id_valuation_policies_id_fk" FOREIGN KEY ("active_policy_id") REFERENCES "public"."valuation_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_settings" ADD CONSTRAINT "valuation_settings_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "valuation_options_code_uq" ON "valuation_condition_options" USING btree ("policy_id","category","code");--> statement-breakpoint
CREATE UNIQUE INDEX "valuation_policy_version_uq" ON "valuation_policies" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "valuation_one_published_uq" ON "valuation_policies" USING btree ("status") WHERE "valuation_policies"."status" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "valuation_reference_lookup_idx" ON "valuation_reference_prices" USING btree ("policy_id","variant_id","model_year","active");--> statement-breakpoint
CREATE INDEX "valuation_rules_lookup_idx" ON "valuation_rules" USING btree ("policy_id","category","scope","active");