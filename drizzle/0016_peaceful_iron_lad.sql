ALTER TABLE "recommendation_sessions" DROP CONSTRAINT "recommendation_session_valid";--> statement-breakpoint
ALTER TABLE "recommendation_sessions" ADD CONSTRAINT "recommendation_session_valid" CHECK ("recommendation_sessions"."result_count" BETWEEN 0 AND 5000 AND "recommendation_sessions"."completion_ms" BETWEEN 0 AND 86400000 AND "recommendation_sessions"."status" = 'completed' AND ("recommendation_sessions"."top_score" IS NULL OR "recommendation_sessions"."top_score" BETWEEN 0 AND 100));
--> statement-breakpoint
UPDATE "recommendation_settings"
SET "config" = jsonb_set("config", '{maxResults}', '5000'::jsonb), "updated_at" = now()
WHERE ("config"->>'maxResults')::integer BETWEEN 1 AND 5;
