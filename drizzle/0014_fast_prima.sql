CREATE TABLE "car_recommendation_profiles" (
	"car_id" uuid PRIMARY KEY NOT NULL,
	"assessments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "car_recommendation_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recommendation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"type" text NOT NULL,
	"car_id" uuid,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_event_type" CHECK ("recommendation_events"."type" IN ('result_viewed','car_clicked','contact_clicked','quiz_restarted')),
	CONSTRAINT "recommendation_event_car" CHECK (("recommendation_events"."type" <> 'car_clicked' OR "recommendation_events"."car_id" IS NOT NULL) AND ("recommendation_events"."type" NOT IN ('result_viewed','quiz_restarted') OR "recommendation_events"."car_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "recommendation_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recommendation_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"capability_hash" text NOT NULL,
	"answers_hash" text NOT NULL,
	"answers" jsonb NOT NULL,
	"criteria" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"result_count" integer NOT NULL,
	"top_score" integer,
	"completion_ms" integer NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recommendation_session_valid" CHECK ("recommendation_sessions"."result_count" BETWEEN 0 AND 5 AND "recommendation_sessions"."completion_ms" BETWEEN 0 AND 86400000 AND "recommendation_sessions"."status" = 'completed' AND ("recommendation_sessions"."top_score" IS NULL OR "recommendation_sessions"."top_score" BETWEEN 0 AND 100)),
	CONSTRAINT "recommendation_session_hashes" CHECK ("recommendation_sessions"."capability_hash" ~ '^[0-9a-f]{64}$' AND "recommendation_sessions"."answers_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "recommendation_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recommendation_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"retention_days" integer DEFAULT 180 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_settings_singleton" CHECK ("recommendation_settings"."id" = 1),
	CONSTRAINT "recommendation_retention_valid" CHECK ("recommendation_settings"."retention_days" BETWEEN 1 AND 730)
);
--> statement-breakpoint
ALTER TABLE "recommendation_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "car_recommendation_profiles" ADD CONSTRAINT "car_recommendation_profiles_car_id_cars_id_fk" FOREIGN KEY ("car_id") REFERENCES "public"."cars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "car_recommendation_profiles" ADD CONSTRAINT "car_recommendation_profiles_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD CONSTRAINT "recommendation_events_session_id_recommendation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."recommendation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_settings" ADD CONSTRAINT "recommendation_settings_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recommendation_event_dedupe_uq" ON "recommendation_events" USING btree ("session_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "recommendation_events_session_idx" ON "recommendation_events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "recommendation_events_type_idx" ON "recommendation_events" USING btree ("type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendation_request_uq" ON "recommendation_sessions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "recommendation_sessions_created_idx" ON "recommendation_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "recommendation_sessions_expiry_idx" ON "recommendation_sessions" USING btree ("expires_at");
--> statement-breakpoint
REVOKE ALL ON TABLE public.recommendation_settings, public.car_recommendation_profiles, public.recommendation_sessions, public.recommendation_events FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE target_role text;
BEGIN
  FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.recommendation_settings, public.car_recommendation_profiles, public.recommendation_sessions, public.recommendation_events FROM %I', target_role);
    END IF;
  END LOOP;
END $$;
