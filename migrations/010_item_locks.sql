-- Identity-level locks preserve player intent without rewriting item provenance.
CREATE TABLE inventory_lock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES inventory_items(id),
  action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
  run_id uuid NOT NULL REFERENCES runs(id),
  revision bigint NOT NULL CHECK(revision>0),
  previous_locked boolean NOT NULL,
  locked boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(item_id,revision),
  CHECK(previous_locked<>locked)
);
CREATE INDEX lock_events_by_run ON inventory_lock_events(run_id);
CREATE TABLE inventory_item_locks (
  item_id uuid PRIMARY KEY REFERENCES inventory_items(id),
  locked boolean NOT NULL,
  revision bigint NOT NULL CHECK(revision>0),
  last_event_id uuid NOT NULL UNIQUE REFERENCES inventory_lock_events(id)
);
CREATE TRIGGER immutable_lock_event BEFORE UPDATE OR DELETE ON inventory_lock_events FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION guard_lock_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Item locks require recorded lock events'; END IF;
  IF TG_OP='UPDATE' AND NEW.item_id<>OLD.item_id THEN RAISE EXCEPTION 'Item lock identity is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER item_lock_projection BEFORE INSERT OR UPDATE OR DELETE ON inventory_item_locks FOR EACH ROW EXECUTE FUNCTION guard_lock_projection();
CREATE FUNCTION apply_item_lock_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior inventory_item_locks%ROWTYPE; owner_run runs%ROWTYPE; custody record;
BEGIN
  PERFORM id FROM inventory_items WHERE id=NEW.item_id FOR UPDATE;
  SELECT * INTO owner_run FROM runs WHERE id=NEW.run_id FOR SHARE;
  SELECT i.quantity,c.kind,s.lifecycle,s.run_id,s.account_id,ch.account_id AS run_account INTO custody
    FROM inventory_items i JOIN inventory_containers c ON c.id=i.container_id JOIN state_scopes s ON s.id=c.scope_id
    JOIN characters ch ON ch.id=owner_run.character_id WHERE i.id=NEW.item_id FOR SHARE OF c,s;
  IF owner_run.status NOT IN('ACTIVE','AFTERCORE') OR custody.quantity<=0 OR custody.lifecycle IS DISTINCT FROM 'ACTIVE'
    OR custody.kind NOT IN('CARRIED','MATERIAL_VAULT','HOME','LEGACY')
    OR NOT(coalesce(custody.run_id=NEW.run_id,false) OR coalesce(custody.account_id=custody.run_account,false))
    OR (owner_run.mode<>'CASUAL' AND custody.run_id IS DISTINCT FROM NEW.run_id) THEN
    RAISE EXCEPTION 'Item lock requires accessible personal custody';
  END IF;
  SELECT * INTO prior FROM inventory_item_locks WHERE item_id=NEW.item_id;
  IF NEW.revision<>coalesce(prior.revision,0)+1 OR NEW.previous_locked IS DISTINCT FROM coalesce(prior.locked,false) THEN
    RAISE EXCEPTION 'Item lock history must advance consecutively';
  END IF;
  INSERT INTO inventory_item_locks(item_id,locked,revision,last_event_id) VALUES(NEW.item_id,NEW.locked,NEW.revision,NEW.id)
    ON CONFLICT(item_id) DO UPDATE SET locked=EXCLUDED.locked,revision=EXCLUDED.revision,last_event_id=EXCLUDED.last_event_id;
  RETURN NEW;
END $$;
CREATE TRIGGER item_lock_apply AFTER INSERT ON inventory_lock_events FOR EACH ROW EXECUTE FUNCTION apply_item_lock_event();
-- Lock item identities before reading protection, using the same global order as quantity updates.
CREATE FUNCTION guard_locked_quantity_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IN('CONSUME','SPLIT','MERGE') THEN
    PERFORM id FROM inventory_items WHERE id IN(NEW.from_item_id,NEW.to_item_id) ORDER BY id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM inventory_item_locks WHERE locked AND (item_id=NEW.from_item_id OR (NEW.kind IN('SPLIT','MERGE') AND item_id=NEW.to_item_id))) THEN
      RAISE EXCEPTION 'Locked item cannot be consumed, split or merged';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER locked_quantity_operation BEFORE INSERT ON inventory_quantity_operations FOR EACH ROW EXECUTE FUNCTION guard_locked_quantity_operation();
CREATE VIEW item_lock_integrity_issues AS
SELECT coalesce(latest.item_id,p.item_id) AS item_id FROM inventory_item_locks p
FULL JOIN (SELECT DISTINCT ON(item_id) * FROM inventory_lock_events ORDER BY item_id,revision DESC) latest ON latest.item_id=p.item_id
WHERE p.item_id IS NULL OR latest.id IS NULL OR p.last_event_id IS DISTINCT FROM latest.id OR p.revision IS DISTINCT FROM latest.revision OR p.locked IS DISTINCT FROM latest.locked
  OR EXISTS(SELECT 1 FROM (
    SELECT e.*,lag(locked,1,false) OVER(PARTITION BY item_id ORDER BY revision) AS expected_previous,
      row_number() OVER(PARTITION BY item_id ORDER BY revision) AS expected_revision
    FROM inventory_lock_events e) chain JOIN runs r ON r.id=chain.run_id JOIN characters c ON c.id=r.character_id
    LEFT JOIN action_receipts a ON a.action_id=chain.action_id WHERE chain.item_id=coalesce(latest.item_id,p.item_id)
    AND (chain.previous_locked IS DISTINCT FROM chain.expected_previous OR chain.revision<>chain.expected_revision
      OR a.account_id IS DISTINCT FROM c.account_id OR a.action_type IS DISTINCT FROM 'SET_ITEM_LOCK'
      OR a.authorization_source NOT IN('MANUAL_UI','API')));
CREATE FUNCTION check_item_lock_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM item_lock_integrity_issues WHERE item_id=NEW.item_id) THEN
    RAISE EXCEPTION 'Item lock projection or history is inconsistent';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER item_lock_event_integrity AFTER INSERT ON inventory_lock_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_item_lock_history();
CREATE CONSTRAINT TRIGGER item_lock_projection_integrity AFTER INSERT OR UPDATE ON inventory_item_locks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_item_lock_history();
