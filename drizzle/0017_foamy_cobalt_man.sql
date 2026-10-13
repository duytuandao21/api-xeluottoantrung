CREATE TABLE "vehicle_ownership_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"target" text NOT NULL,
	"name" text NOT NULL,
	"policy" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ownership_profile_scope" CHECK ("vehicle_ownership_profiles"."scope" IN ('car','version','model','body','fuel'))
);
--> statement-breakpoint
CREATE TABLE "vehicle_ownership_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ownership_settings_singleton" CHECK ("vehicle_ownership_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "vehicle_ownership_surveys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interaction_id" uuid NOT NULL,
	"capability_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_request_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"answers_hash" text NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"vehicle_snapshot" jsonb NOT NULL,
	"monthly_km" integer NOT NULL,
	"driving_type" text NOT NULL,
	"fuel_type" text NOT NULL,
	"energy_price" bigint NOT NULL,
	"parking_monthly" bigint NOT NULL,
	"wash_monthly" bigint NOT NULL,
	"toll_monthly" bigint NOT NULL,
	"insurance_choice" text NOT NULL,
	"is_financed" boolean NOT NULL,
	"down_payment_pct" numeric(7, 4),
	"loan_term_months" integer,
	"annual_interest_rate" numeric(7, 4),
	"ownership_years" integer NOT NULL,
	"region" text NOT NULL,
	"transaction_case" text NOT NULL,
	"estimated_monthly_operating_cost" bigint NOT NULL,
	"estimated_monthly_cash_outflow" bigint NOT NULL,
	"estimated_tco" bigint NOT NULL,
	"estimated_resale_value" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ownership_survey_bounds" CHECK ("vehicle_ownership_surveys"."monthly_km" BETWEEN 0 AND 20000 AND "vehicle_ownership_surveys"."ownership_years" BETWEEN 1 AND 20 AND "vehicle_ownership_surveys"."energy_price" BETWEEN 1 AND 100000 AND "vehicle_ownership_surveys"."parking_monthly" BETWEEN 0 AND 20000000 AND "vehicle_ownership_surveys"."wash_monthly" BETWEEN 0 AND 20000000 AND "vehicle_ownership_surveys"."toll_monthly" BETWEEN 0 AND 20000000),
	CONSTRAINT "ownership_survey_money" CHECK ("vehicle_ownership_surveys"."estimated_monthly_operating_cost" >= 0 AND "vehicle_ownership_surveys"."estimated_monthly_cash_outflow" >= 0 AND "vehicle_ownership_surveys"."estimated_tco" >= 0 AND "vehicle_ownership_surveys"."estimated_resale_value" >= 0),
	CONSTRAINT "ownership_survey_choices" CHECK ("vehicle_ownership_surveys"."driving_type" IN ('city','mixed','highway') AND "vehicle_ownership_surveys"."fuel_type" IN ('gasoline','diesel','electric') AND "vehicle_ownership_surveys"."insurance_choice" IN ('mandatory','comprehensive')),
	CONSTRAINT "ownership_survey_finance" CHECK ((NOT "vehicle_ownership_surveys"."is_financed" AND "vehicle_ownership_surveys"."down_payment_pct" IS NULL AND "vehicle_ownership_surveys"."loan_term_months" IS NULL AND "vehicle_ownership_surveys"."annual_interest_rate" IS NULL) OR ("vehicle_ownership_surveys"."is_financed" AND "vehicle_ownership_surveys"."down_payment_pct" IS NOT NULL AND "vehicle_ownership_surveys"."down_payment_pct" BETWEEN 0 AND 100 AND "vehicle_ownership_surveys"."loan_term_months" IS NOT NULL AND "vehicle_ownership_surveys"."loan_term_months" BETWEEN 1 AND 240 AND "vehicle_ownership_surveys"."annual_interest_rate" IS NOT NULL AND "vehicle_ownership_surveys"."annual_interest_rate" BETWEEN 0 AND 40))
);
--> statement-breakpoint
ALTER TABLE "vehicle_ownership_surveys" ADD CONSTRAINT "vehicle_ownership_surveys_vehicle_id_cars_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."cars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ownership_profile_target_uq" ON "vehicle_ownership_profiles" USING btree ("scope","target");--> statement-breakpoint
CREATE UNIQUE INDEX "ownership_interaction_uq" ON "vehicle_ownership_surveys" USING btree ("interaction_id");--> statement-breakpoint
CREATE INDEX "ownership_surveys_date_idx" ON "vehicle_ownership_surveys" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "ownership_surveys_car_date_idx" ON "vehicle_ownership_surveys" USING btree ("vehicle_id","created_at");--> statement-breakpoint
CREATE INDEX "ownership_surveys_finance_date_idx" ON "vehicle_ownership_surveys" USING btree ("is_financed","created_at");
--> statement-breakpoint
ALTER TABLE vehicle_ownership_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_ownership_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_ownership_surveys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vehicle_ownership_settings, vehicle_ownership_profiles, vehicle_ownership_surveys FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON vehicle_ownership_settings, vehicle_ownership_profiles, vehicle_ownership_surveys FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON vehicle_ownership_settings, vehicle_ownership_profiles, vehicle_ownership_surveys FROM authenticated;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO vehicle_ownership_settings (id, config) VALUES (1, '{"defaultFuel":"gasoline","fallbackOdo":50000,"policy":{"consumption":{"gasoline":8,"diesel":7,"electric":16},"factors":{"city":1.2,"mixed":1,"highway":0.85},"chargingLoss":0.1,"maintenanceMode":"aggregate","maintenancePerKm":500,"maintenanceAnnual":1000000,"maintenance":[],"repairAnnual":1500000,"repairAgeFactor":0.08,"repairOdoFactor":0.1,"depreciationAnnualPct":10,"depreciationAgeFactor":0,"depreciationOdoFactor":0,"residualFloorPct":10},"energyPrices":{"gasoline":24000,"diesel":22000,"electric":3500},"loanDefaults":{"downPct":30,"termMonths":60,"annualRate":10},"defaults":{"monthlyKm":1000,"driving":"mixed","energyPrice":24000,"parking":500000,"wash":200000,"toll":200000,"insurance":"mandatory","financed":false,"downPct":null,"termMonths":null,"annualRate":null,"years":5,"region":"other","transaction":"transfer"},"parkingOptions":[0,500000,1500000],"washOptions":[0,200000,400000],"tollOptions":[0,200000,1000000],"yearOptions":[1,3,5,7,10],"regions":[{"key":"other","label":"Khu vực khác / chưa xác định"},{"key":"hcm","label":"TP. Hồ Chí Minh"},{"key":"hanoi","label":"Hà Nội"}],"transactions":[{"key":"transfer","label":"Mua xe đã đăng ký / sang tên"},{"key":"same_plate","label":"Giữ đăng ký hiện có"},{"key":"new_registration","label":"Đăng ký mới"}],"fees":[{"key":"mandatory","name":"Ngân sách bảo hiểm bắt buộc (minh họa)","kind":"mandatory","amount":500000,"pricePct":0,"fuel":"any","bodyId":null,"region":"","transaction":""},{"key":"comprehensive","name":"Bảo hiểm vật chất (minh họa)","kind":"comprehensive","amount":0,"pricePct":1.3,"fuel":"any","bodyId":null,"region":"","transaction":""},{"key":"annual","name":"Ngân sách phí định kỳ (minh họa)","kind":"annual","amount":2000000,"pricePct":0,"fuel":"any","bodyId":null,"region":"","transaction":""}]}'::jsonb) ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO permissions (code) VALUES ('ownership.read'), ('ownership.settings.update'), ('ownership.profiles.update') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code IN ('ADMIN','SUPER_ADMIN') AND p.code IN ('ownership.read','ownership.settings.update','ownership.profiles.update') ON CONFLICT DO NOTHING;
