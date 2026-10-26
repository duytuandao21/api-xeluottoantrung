-- Nullable only while existing rows are backfilled in this migration transaction.
ALTER TABLE "accessories" ADD COLUMN "slug" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "accessories_slug_uq" ON "accessories" USING btree ("slug");
--> statement-breakpoint
CREATE FUNCTION public.accessory_slug_base(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  WITH cleaned AS (
    SELECT trim(BOTH '-' FROM left(regexp_replace(
      lower(translate(regexp_replace(normalize(value, NFD), U&'[\0300-\036f]', '', 'g'), 'đĐ', 'dD')),
      '[^a-z0-9]+', '-', 'g'), 80)) AS base
  )
  SELECT CASE WHEN base = '' THEN 'phu-kien'
    WHEN base ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'phu-kien-' || base
    ELSE base END FROM cleaned;
$$;
--> statement-breakpoint
CREATE FUNCTION public.next_accessory_slug(value text) RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $$
DECLARE
  base text := public.accessory_slug_base(value);
  candidate text := base;
  suffix bigint := 1;
  ending text;
BEGIN
  -- Only accessory inserts allocate slugs. Readers and other modules do not lock.
  -- The transaction lock also covers older API instances during rolling deploys.
  PERFORM pg_advisory_xact_lock(71483, 1);
  WHILE EXISTS (SELECT 1 FROM public.accessories WHERE slug = candidate) LOOP
    suffix := suffix + 1;
    ending := '-' || suffix::text;
    candidate := rtrim(left(base, 100 - length(ending)), '-') || ending;
  END LOOP;
  RETURN candidate;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE item record;
BEGIN
  -- Include hidden items and use a deterministic order for duplicate names.
  FOR item IN SELECT id, name FROM public.accessories ORDER BY created_at, id LOOP
    UPDATE public.accessories SET slug = public.next_accessory_slug(item.name) WHERE id = item.id;
  END LOOP;
END;
$$;
--> statement-breakpoint
ALTER TABLE "accessories" ALTER COLUMN "slug" SET DEFAULT '';
--> statement-breakpoint
ALTER TABLE "accessories" ALTER COLUMN "slug" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "accessories" ADD CONSTRAINT "accessories_slug_ck" CHECK (char_length("accessories"."slug") <= 100 AND "accessories"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND "accessories"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
--> statement-breakpoint
CREATE FUNCTION public.assign_accessory_slug() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := public.next_accessory_slug(NEW.name);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER accessories_assign_slug BEFORE INSERT ON "accessories"
FOR EACH ROW EXECUTE FUNCTION public.assign_accessory_slug();
--> statement-breakpoint
-- Preserve SEO record IDs and all custom fields. A pre-existing new-route
-- configuration wins; its old-route record is retained rather than overwritten.
WITH routes AS (
  SELECT seo.id, '/phu-kien-o-to/' || a.id::text AS old_path,
    '/phu-kien-o-to/' || a.slug AS new_path
  FROM seo_metadata seo JOIN accessories a ON seo.route_path = '/phu-kien-o-to/' || a.id::text
  WHERE NOT EXISTS (SELECT 1 FROM seo_metadata target WHERE target.route_path = '/phu-kien-o-to/' || a.slug)
)
UPDATE seo_metadata seo SET route_path = routes.new_path,
  canonical_url = CASE
    WHEN seo.canonical_url IN (routes.old_path, routes.old_path || '/') THEN routes.new_path
    WHEN seo.canonical_url ~ ('^https?://(www\.)?(toantrungxeluot\.io\.vn|xeluottoantrung\.com)' || routes.old_path || '/?$')
      THEN regexp_replace(seo.canonical_url, routes.old_path || '/?$', routes.new_path)
    ELSE seo.canonical_url END
FROM routes WHERE seo.id = routes.id;
