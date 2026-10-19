-- Run only with the API stopped, after migration 0021, using psql -v ON_ERROR_STOP=1.
-- Starting the new API afterwards also starts an empty PublicResponseCache.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

DO $$
DECLARE
  target_id constant uuid := '1763061e-1a16-49c7-8864-0b95f24dcc3b';
  older_id constant uuid := 'cf0b8914-8d73-4926-a175-cbd00909acdf'; -- folder 063
  newer_id constant uuid := 'c8e62fba-60ad-4b95-b9e9-f790c16a3152'; -- folder 065
  target cars%ROWTYPE;
  older_at timestamptz;
  newer_at timestamptz;
  placement timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(72419603);
  PERFORM id FROM cars WHERE id IN (target_id, older_id, newer_id) ORDER BY id FOR UPDATE;
  SELECT * INTO STRICT target FROM cars
    WHERE id = target_id AND slug = 'mitsubishi-xforce-exceed-2024' AND deleted_at IS NULL;
  SELECT coalesce(listing_order_at, created_at) INTO STRICT older_at FROM cars
    WHERE id = older_id AND slug = 'mitsubishi-xpander-cross-2023' AND deleted_at IS NULL;
  SELECT coalesce(listing_order_at, created_at) INTO STRICT newer_at FROM cars
    WHERE id = newer_id AND slug = 'ford-ranger-xls-at-4x4-2022' AND deleted_at IS NULL;
  IF older_at >= newer_at THEN
    RAISE EXCEPTION 'Anchor order has changed; inspect folders 063 and 065 before applying';
  END IF;
  IF EXISTS (SELECT 1 FROM cars WHERE deleted_at IS NULL AND id <> target_id
      AND coalesce(listing_order_at, created_at) > older_at
      AND coalesce(listing_order_at, created_at) < newer_at) THEN
    RAISE EXCEPTION 'Another car is between the anchors; inspect the current order first';
  END IF;
  IF target.listing_order_at > older_at AND target.listing_order_at < newer_at THEN
    RAISE NOTICE 'Car 115 is already between 063 and 065; unchanged';
    RETURN;
  END IF;
  IF target.listing_order_at IS NOT NULL THEN
    RAISE EXCEPTION 'Car 115 already has a different manual position; no overwrite';
  END IF;
  placement := older_at + (newer_at - older_at) / 2;
  IF placement <= older_at OR placement >= newer_at THEN
    RAISE EXCEPTION 'No distinct timestamp is available between anchors';
  END IF;
  UPDATE cars SET listing_order_at = placement WHERE id = target_id;
  INSERT INTO audit_logs (action, entity_type, entity_id, old_data, new_data, user_agent, request_id)
  VALUES ('car.listing_order.update', 'car', target_id,
    jsonb_build_object('listingOrderAt', target.listing_order_at, 'createdAt', target.created_at),
    jsonb_build_object('listingOrderAt', placement, 'createdAt', target.created_at,
      'olderAnchorId', older_id, 'newerAnchorId', newer_id, 'operator', current_user),
    'Database operator: authorized one-time placement of imported car 115', 'place-imported-car-115-v1');
END $$;

SELECT id, name, created_at, listing_order_at FROM cars
WHERE id IN ('1763061e-1a16-49c7-8864-0b95f24dcc3b',
  'cf0b8914-8d73-4926-a175-cbd00909acdf', 'c8e62fba-60ad-4b95-b9e9-f790c16a3152')
ORDER BY coalesce(listing_order_at, created_at) DESC, id ASC;
COMMIT;
