CREATE TYPE "public"."valuation_lead_status" AS ENUM('NEW', 'CONTACTED', 'INSPECTION_SCHEDULED', 'PURCHASED', 'REJECTED', 'CLOSED');--> statement-breakpoint
CREATE TABLE "valuation_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"policy_id" uuid,
	"policy_version" text NOT NULL,
	"brand_id" uuid,
	"model_id" uuid,
	"vehicle_name" text NOT NULL,
	"model_year" integer NOT NULL,
	"odometer_km" integer,
	"estimated_market_value" bigint,
	"market_min" bigint,
	"market_max" bigint,
	"buying_min" bigint,
	"buying_max" bigint,
	"confidence_score" integer NOT NULL,
	"result_status" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"lead_id" uuid,
	"lead_status" "valuation_lead_status",
	"lead_token_hash" text NOT NULL,
	"lead_token_expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "valuation_records_score" CHECK ("valuation_records"."confidence_score" BETWEEN 0 AND 100),
	CONSTRAINT "valuation_records_year" CHECK ("valuation_records"."model_year" BETWEEN 1886 AND 2100),
	CONSTRAINT "valuation_records_odo" CHECK ("valuation_records"."odometer_km" IS NULL OR "valuation_records"."odometer_km" >= 0),
	CONSTRAINT "valuation_records_prices" CHECK (("valuation_records"."estimated_market_value" IS NULL OR "valuation_records"."estimated_market_value" > 0) AND ("valuation_records"."market_min" IS NULL AND "valuation_records"."market_max" IS NULL OR "valuation_records"."market_min" > 0 AND "valuation_records"."market_max" >= "valuation_records"."market_min") AND ("valuation_records"."buying_min" IS NULL AND "valuation_records"."buying_max" IS NULL OR "valuation_records"."buying_min" > 0 AND "valuation_records"."buying_max" >= "valuation_records"."buying_min")),
	CONSTRAINT "valuation_records_result_status" CHECK ("valuation_records"."result_status" IN ('ESTIMATED','MANUAL_INSPECTION','MISSING_REFERENCE','INSUFFICIENT_DATA'))
);
--> statement-breakpoint
ALTER TABLE "valuation_records" ADD CONSTRAINT "valuation_records_policy_id_valuation_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."valuation_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_records" ADD CONSTRAINT "valuation_records_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_records" ADD CONSTRAINT "valuation_records_model_id_car_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."car_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_records" ADD CONSTRAINT "valuation_records_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "valuation_records_created_idx" ON "valuation_records" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "valuation_records_vehicle_idx" ON "valuation_records" USING btree ("brand_id","model_id","created_at");--> statement-breakpoint
CREATE INDEX "valuation_records_status_idx" ON "valuation_records" USING btree ("lead_status","created_at");--> statement-breakpoint
CREATE INDEX "valuation_records_value_idx" ON "valuation_records" USING btree ("estimated_market_value");--> statement-breakpoint
CREATE UNIQUE INDEX "valuation_records_lead_uq" ON "valuation_records" USING btree ("lead_id");