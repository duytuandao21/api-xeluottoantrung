-- Run only with the API stopped, using psql -v ON_ERROR_STOP=1; restart afterwards.
-- Keeps the additive column/index so both old and new API code remain compatible.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
DO $$
DECLARE
  target_id constant uuid := '1763061e-1a16-49c7-8864-0b95f24dcc3b';
  saved audit_logs%ROWTYPE;
  current_position timestamptz;
  previous_position timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(72419603);
  SELECT listing_order_at INTO STRICT current_position FROM cars WHERE id = target_id FOR UPDATE;
  SELECT * INTO STRICT saved FROM audit_logs
    WHERE entity_id = target_id AND action = 'car.listing_order.update'
      AND request_id = 'place-imported-car-115-v1'
    ORDER BY created_at DESC, id DESC LIMIT 1;
  previous_position := (saved.old_data ->> 'listingOrderAt')::timestamptz;
  IF current_position IS NOT DISTINCT FROM previous_position THEN
    RAISE NOTICE 'Placement already rolled back; unchanged';
    RETURN;
  END IF;
  IF current_position IS DISTINCT FROM (saved.new_data ->> 'listingOrderAt')::timestamptz THEN
    RAISE EXCEPTION 'Position changed after this operation; rollback will not overwrite it';
  END IF;
  UPDATE cars SET listing_order_at = previous_position WHERE id = target_id;
  INSERT INTO audit_logs (action, entity_type, entity_id, old_data, new_data, user_agent, request_id)
  VALUES ('car.listing_order.rollback', 'car', target_id,
    jsonb_build_object('listingOrderAt', current_position),
    jsonb_build_object('listingOrderAt', previous_position, 'operator', current_user),
    'Database operator: rollback imported car 115 placement', 'rollback-imported-car-115-v1');
END $$;
COMMIT;
