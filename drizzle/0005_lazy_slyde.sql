ALTER TABLE "services" ADD COLUMN "slug" text;--> statement-breakpoint
WITH normalized AS (
  SELECT id,
    COALESCE(NULLIF(trim(both '-' from regexp_replace(
      translate(lower(title),
        'áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ',
        'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'),
      '[^a-z0-9]+', '-', 'g')), ''), 'dich-vu') AS base
  FROM services
), assigned AS (
  SELECT id, base, count(*) OVER (PARTITION BY base) AS matches
  FROM normalized
)
UPDATE services AS service
SET slug = CASE WHEN assigned.matches = 1 THEN assigned.base
  ELSE assigned.base || '-' || replace(service.id::text, '-', '') END
FROM assigned WHERE assigned.id = service.id;--> statement-breakpoint
CREATE UNIQUE INDEX "services_slug_uq" ON "services" USING btree ("slug");
