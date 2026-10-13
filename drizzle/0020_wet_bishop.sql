ALTER TABLE "promotions" DROP CONSTRAINT "promotions_date_order";--> statement-breakpoint
ALTER TABLE "promotions" ALTER COLUMN "starts_at" SET DATA TYPE date USING ("starts_at" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;--> statement-breakpoint
ALTER TABLE "promotions" ALTER COLUMN "ends_at" SET DATA TYPE date USING ("ends_at" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_date_order" CHECK ("promotions"."ends_at" >= "promotions"."starts_at");
