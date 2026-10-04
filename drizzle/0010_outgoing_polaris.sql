CREATE TYPE "public"."auspicious_classification" AS ENUM('VERY_GOOD', 'GOOD', 'NORMAL', 'NOT_RECOMMENDED', 'AVOID');--> statement-breakpoint
CREATE TYPE "public"."auspicious_effect" AS ENUM('POSITIVE', 'NEGATIVE', 'NEUTRAL');--> statement-breakpoint
CREATE TYPE "public"."auspicious_priority" AS ENUM('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."auspicious_purpose" AS ENUM('BUY_CAR', 'RECEIVE_CAR', 'SIGN_CONTRACT');--> statement-breakpoint
CREATE TYPE "public"."auspicious_source_status" AS ENUM('UNVERIFIED', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."auspicious_version_status" AS ENUM('DRAFT', 'REVIEW', 'VALIDATED', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "auspicious_change_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"rule_set_id" uuid,
	"action" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auspicious_reference_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"name" text NOT NULL,
	"birth_date" date NOT NULL,
	"gender" text,
	"purpose" "auspicious_purpose" NOT NULL,
	"target_date" date NOT NULL,
	"expected" jsonb NOT NULL,
	"rule_set_version" text NOT NULL,
	"source_note" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auspicious_rule_contents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"locale" text DEFAULT 'vi-VN' NOT NULL,
	"title" text NOT NULL,
	"short_description" text NOT NULL,
	"detail_description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auspicious_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"purpose" "auspicious_purpose" NOT NULL,
	"version" text NOT NULL,
	"status" "auspicious_version_status" DEFAULT 'DRAFT' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"validated_revision" integer,
	"validation_report" jsonb,
	"effective_from" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auspicious_rule_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"title" text NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"publisher" text DEFAULT '' NOT NULL,
	"edition" text DEFAULT '' NOT NULL,
	"published_year" integer,
	"page_reference" text DEFAULT '' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"verification_status" "auspicious_source_status" DEFAULT 'UNVERIFIED' NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auspicious_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"code" text NOT NULL,
	"category" text NOT NULL,
	"priority" "auspicious_priority" NOT NULL,
	"effect" "auspicious_effect" NOT NULL,
	"weight" integer DEFAULT 0 NOT NULL,
	"hard_exclusion" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"engine_handler" text NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auspicious_rules_weight" CHECK ("auspicious_rules"."weight" between 0 and 50),
	CONSTRAINT "auspicious_rules_critical_exclusion" CHECK (not "auspicious_rules"."hard_exclusion" or ("auspicious_rules"."priority" = 'CRITICAL' and "auspicious_rules"."effect" = 'NEGATIVE'))
);
--> statement-breakpoint
CREATE TABLE "auspicious_date_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"name" text DEFAULT 'Xem ngày mua xe' NOT NULL,
	"max_search_days" integer DEFAULT 90 NOT NULL,
	"default_purpose" "auspicious_purpose" DEFAULT 'BUY_CAR' NOT NULL,
	"supported_purposes" jsonb DEFAULT '["BUY_CAR","RECEIVE_CAR","SIGN_CONTRACT"]'::jsonb NOT NULL,
	"show_lunar_date" boolean DEFAULT true NOT NULL,
	"show_can_chi" boolean DEFAULT true NOT NULL,
	"show_good_hours" boolean DEFAULT false NOT NULL,
	"show_explanation" boolean DEFAULT true NOT NULL,
	"show_score" boolean DEFAULT false NOT NULL,
	"disclaimer" text DEFAULT 'Thông tin được tổng hợp theo hệ thống lịch và các quan niệm truyền thống, chỉ mang tính tham khảo.' NOT NULL,
	"cta_label" text DEFAULT 'Xem xe đang bán tại Toàn Trung' NOT NULL,
	"seo_title" text DEFAULT 'Xem ngày mua xe | Xe Lướt Toàn Trung' NOT NULL,
	"seo_description" text DEFAULT 'Tham khảo ngày mua xe, nhận xe và ký hợp đồng theo lịch Việt Nam.' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auspicious_settings_singleton" CHECK ("auspicious_date_settings"."id" = 1),
	CONSTRAINT "auspicious_settings_range" CHECK ("auspicious_date_settings"."max_search_days" between 1 and 90)
);
--> statement-breakpoint
ALTER TABLE "auspicious_change_logs" ADD CONSTRAINT "auspicious_change_logs_admin_user_id_profiles_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auspicious_change_logs" ADD CONSTRAINT "auspicious_change_logs_rule_set_id_auspicious_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."auspicious_rule_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auspicious_reference_cases" ADD CONSTRAINT "auspicious_reference_cases_rule_set_id_auspicious_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."auspicious_rule_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auspicious_rule_contents" ADD CONSTRAINT "auspicious_rule_contents_rule_id_auspicious_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."auspicious_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auspicious_rule_sets" ADD CONSTRAINT "auspicious_rule_sets_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auspicious_rule_sources" ADD CONSTRAINT "auspicious_rule_sources_rule_id_auspicious_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."auspicious_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auspicious_rule_sources" ADD CONSTRAINT "auspicious_rule_sources_verified_by_profiles_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auspicious_rules" ADD CONSTRAINT "auspicious_rules_rule_set_id_auspicious_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."auspicious_rule_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auspicious_audit_created_idx" ON "auspicious_change_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "auspicious_cases_set_idx" ON "auspicious_reference_cases" USING btree ("rule_set_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auspicious_rule_content_locale_uq" ON "auspicious_rule_contents" USING btree ("rule_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "auspicious_version_purpose_uq" ON "auspicious_rule_sets" USING btree ("purpose","version");--> statement-breakpoint
CREATE UNIQUE INDEX "auspicious_one_published_uq" ON "auspicious_rule_sets" USING btree ("purpose") WHERE "auspicious_rule_sets"."status" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "auspicious_sources_rule_idx" ON "auspicious_rule_sources" USING btree ("rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auspicious_rules_code_uq" ON "auspicious_rules" USING btree ("rule_set_id","code");