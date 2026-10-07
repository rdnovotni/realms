-- Preserve the quantity and identity of every pre-existing item as an explicit
-- opening balance. Later grants, sinks and stack transfers must use this ledger.
ALTER TABLE inventory_items DROP CONSTRAINT inventory_items_quantity_check;
ALTER TABLE inventory_items DROP CONSTRAINT inventory_items_check;
ALTER TABLE inventory_items ADD CONSTRAINT nonnegative_item_quantity CHECK(quantity>=0);
ALTER TABLE inventory_items ADD CONSTRAINT instance_item_quantity CHECK(storage_mode='STACK' OR quantity IN(0,1));

CREATE TABLE inventory_quantity_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
  operation_key text NOT NULL CHECK(operation_key ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  kind text NOT NULL CHECK(kind IN('OPENING','GRANT','CONSUME','SPLIT','MERGE')),
  from_item_id uuid REFERENCES inventory_items(id),
  to_item_id uuid REFERENCES inventory_items(id),
  quantity bigint NOT NULL CHECK(quantity>0),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(action_id,operation_key),
  CHECK((kind='OPENING')=(action_id IS NULL)),
  CHECK((kind IN('OPENING','GRANT') AND from_item_id IS NULL AND to_item_id IS NOT NULL)
    OR (kind='CONSUME' AND from_item_id IS NOT NULL AND to_item_id IS NULL)
    OR (kind IN('SPLIT','MERGE') AND from_item_id IS NOT NULL AND to_item_id IS NOT NULL AND from_item_id<>to_item_id))
);
CREATE INDEX quantity_operations_from ON inventory_quantity_operations(from_item_id);
CREATE INDEX quantity_operations_to ON inventory_quantity_operations(to_item_id);
INSERT INTO inventory_quantity_operations(operation_key,kind,to_item_id,quantity,reason)
  SELECT 'opening','OPENING',id,quantity,'MIGRATION_004_OPENING_BALANCE' FROM inventory_items;

CREATE FUNCTION guard_item_accounting() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Item identities and provenance cannot be deleted'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.quantity<>0 THEN RAISE EXCEPTION 'New items require a quantity ledger grant'; END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['container_id','quantity'])<>(to_jsonb(OLD)-ARRAY['container_id','quantity']) THEN
      RAISE EXCEPTION 'Item definition, binding and provenance are immutable';
    END IF;
    IF NEW.quantity<>OLD.quantity AND pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Item quantities require ledger operations'; END IF;
    IF NEW.container_id<>OLD.container_id AND OLD.quantity=0 THEN RAISE EXCEPTION 'Retired items cannot move'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER item_accounting BEFORE INSERT OR UPDATE OR DELETE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION guard_item_accounting();

CREATE FUNCTION apply_inventory_quantity_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source inventory_items%ROWTYPE; target inventory_items%ROWTYPE;
BEGIN
  IF NEW.kind='OPENING' THEN RAISE EXCEPTION 'Opening inventory balances are migration-only'; END IF;
  -- The same global order is used by services and the SQL boundary.
  PERFORM id FROM inventory_items WHERE id IN(NEW.from_item_id,NEW.to_item_id) ORDER BY id FOR UPDATE;
  IF NEW.from_item_id IS NOT NULL THEN
    SELECT * INTO STRICT source FROM inventory_items WHERE id=NEW.from_item_id;
    IF source.quantity<NEW.quantity THEN RAISE EXCEPTION 'Insufficient item quantity'; END IF;
  END IF;
  IF NEW.to_item_id IS NOT NULL THEN
    SELECT * INTO STRICT target FROM inventory_items WHERE id=NEW.to_item_id;
    IF target.quantity::numeric+NEW.quantity>9223372036854775807 THEN RAISE EXCEPTION 'Item quantity overflow'; END IF;
    IF NEW.kind='GRANT' AND target.quantity<>0 THEN RAISE EXCEPTION 'Grants require a new item identity'; END IF;
    -- Retired identities cannot be resurrected by a later grant or transfer.
    IF target.quantity=0 AND EXISTS(SELECT 1 FROM inventory_quantity_operations WHERE to_item_id=target.id AND id<>NEW.id) THEN
      RAISE EXCEPTION 'Retired items cannot be reissued';
    END IF;
  END IF;
  IF NEW.kind IN('SPLIT','MERGE') THEN
    IF source.storage_mode<>'STACK' OR target.storage_mode<>'STACK'
      OR (to_jsonb(source)-ARRAY['id','quantity','created_at'])<>(to_jsonb(target)-ARRAY['id','quantity','created_at']) THEN
      RAISE EXCEPTION 'Stack transfer requires identical custody, definition, binding and provenance';
    END IF;
    IF NEW.kind='SPLIT' AND (source.quantity<=NEW.quantity OR target.quantity<>0) THEN RAISE EXCEPTION 'Split requires a partial stack and new identity'; END IF;
    IF NEW.kind='MERGE' AND (source.quantity<>NEW.quantity OR target.quantity=0) THEN RAISE EXCEPTION 'Merge requires the complete source and a live target'; END IF;
  END IF;
  PERFORM s.id FROM inventory_items i JOIN inventory_containers c ON c.id=i.container_id
    JOIN state_scopes s ON s.id=c.scope_id WHERE i.id IN(NEW.from_item_id,NEW.to_item_id) ORDER BY s.id,c.id FOR SHARE OF s,c;
  IF EXISTS(SELECT 1 FROM inventory_items i JOIN inventory_containers c ON c.id=i.container_id
      JOIN state_scopes s ON s.id=c.scope_id WHERE i.id IN(NEW.from_item_id,NEW.to_item_id) AND s.lifecycle<>'ACTIVE') THEN
    RAISE EXCEPTION 'Archived inventory cannot change quantity';
  END IF;
  IF NEW.from_item_id IS NOT NULL THEN UPDATE inventory_items SET quantity=quantity-NEW.quantity WHERE id=NEW.from_item_id; END IF;
  IF NEW.to_item_id IS NOT NULL THEN UPDATE inventory_items SET quantity=quantity+NEW.quantity WHERE id=NEW.to_item_id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_quantity_apply AFTER INSERT ON inventory_quantity_operations
  FOR EACH ROW EXECUTE FUNCTION apply_inventory_quantity_operation();
CREATE TRIGGER immutable_inventory_quantity_operation BEFORE UPDATE OR DELETE ON inventory_quantity_operations
  FOR EACH ROW EXECUTE FUNCTION reject_record_change();

-- A newly inserted zero-quantity identity must be issued within its transaction.
-- Fully consumed identities remain as tombstones referenced by immutable history.
CREATE FUNCTION check_item_issuance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM inventory_quantity_operations WHERE to_item_id=NEW.id) THEN
    RAISE EXCEPTION 'Item identity requires an issuance operation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER item_issuance AFTER INSERT ON inventory_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_item_issuance();
