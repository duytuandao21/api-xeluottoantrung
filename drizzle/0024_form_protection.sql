CREATE TABLE "form_submissions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "form" text NOT NULL,
  "payload_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "form_submissions_expires_idx" ON "form_submissions" USING btree ("expires_at");
--> statement-breakpoint
CREATE TABLE "form_dedupe" (
  "fingerprint" text PRIMARY KEY NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "form_dedupe_expires_idx" ON "form_dedupe" USING btree ("expires_at");
--> statement-breakpoint
CREATE TABLE "form_rate_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bucket" text NOT NULL,
  "ip_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "form_rate_events_lookup_idx" ON "form_rate_events" USING btree ("bucket", "ip_hash", "created_at");
