ALTER TABLE "faqs" ADD COLUMN "slug" text;--> statement-breakpoint
WITH normalized AS (
  SELECT id,
    left(COALESCE(NULLIF(trim(both '-' from regexp_replace(
      translate(lower(question),
        'áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ',
        'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'),
      '[^a-z0-9]+', '-', 'g')), ''), 'cau-hoi'), 200) AS base
  FROM faqs
), assigned AS (
  SELECT id, base, count(*) OVER (PARTITION BY base) AS matches FROM normalized
)
UPDATE faqs AS faq
SET slug = CASE WHEN assigned.matches = 1 THEN trim(trailing '-' from assigned.base)
  ELSE trim(trailing '-' from assigned.base) || '-' || replace(faq.id::text, '-', '') END
FROM assigned WHERE assigned.id = faq.id;--> statement-breakpoint
ALTER TABLE "faqs" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "faqs" ADD COLUMN "excerpt" text;--> statement-breakpoint
ALTER TABLE "faqs" ADD COLUMN "image_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "faqs_slug_uq" ON "faqs" USING btree ("slug");
