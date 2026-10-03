ALTER TABLE "recruitments" ALTER COLUMN "requirements" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "recruitments" ALTER COLUMN "location" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "recruitments" ADD COLUMN "slug" text;--> statement-breakpoint
WITH normalized AS (
  SELECT id,
    COALESCE(NULLIF(trim(both '-' from regexp_replace(
      translate(lower(title),
        'áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ',
        'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'),
      '[^a-z0-9]+', '-', 'g')), ''), 'tuyen-dung') AS base
  FROM recruitments
), assigned AS (
  SELECT id, base, count(*) OVER (PARTITION BY base) AS matches FROM normalized
)
UPDATE recruitments AS job
SET slug = CASE WHEN assigned.matches = 1 THEN assigned.base
  ELSE assigned.base || '-' || replace(job.id::text, '-', '') END
FROM assigned WHERE assigned.id = job.id;--> statement-breakpoint
ALTER TABLE "recruitments" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitments" ADD COLUMN "excerpt" text;--> statement-breakpoint
-- Preserve existing job fields in the single editable article body.
UPDATE recruitments SET description = description
  || CASE WHEN btrim(requirements) <> '' THEN '<h2>Yêu cầu</h2>' || requirements ELSE '' END
  || CASE WHEN btrim(coalesce(salary, '')) <> '' THEN '<p><strong>Mức lương:</strong> '
    || replace(replace(replace(salary, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>' ELSE '' END
  || CASE WHEN btrim(location) <> '' THEN '<p><strong>Địa điểm:</strong> '
    || replace(replace(replace(location, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>' ELSE '' END
  || CASE WHEN deadline IS NOT NULL THEN '<p><strong>Hạn nộp:</strong> ' || to_char(deadline AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY') || '</p>' ELSE '' END;--> statement-breakpoint
CREATE UNIQUE INDEX "recruitments_slug_uq" ON "recruitments" USING btree ("slug");
