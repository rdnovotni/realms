-- Character-owned templates persist across Ascension; their item references
-- protect identity independently from current equipment and manual item locks.
CREATE TABLE equipment_loadout_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),loadout_id uuid NOT NULL,
 character_id uuid NOT NULL REFERENCES characters(id),template_key text NOT NULL CHECK(template_key ~ '^[a-z][a-z0-9_-]{0,39}$'),
 run_id uuid NOT NULL REFERENCES runs(id),action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 revision bigint NOT NULL CHECK(revision>0),before_state jsonb,after_state jsonb,
 reason text NOT NULL CHECK(reason IN('SAVE_LOADOUT','SET_LOADOUT_PROTECTION','DELETE_LOADOUT')),
 equipment_event_id uuid REFERENCES equipment_events(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(loadout_id,revision),CHECK(before_state IS DISTINCT FROM after_state)
);
CREATE INDEX loadout_events_character ON equipment_loadout_events(character_id);
CREATE INDEX loadout_events_run ON equipment_loadout_events(run_id);
CREATE INDEX loadout_events_equipment ON equipment_loadout_events(equipment_event_id);
CREATE TABLE equipment_loadouts (
 id uuid PRIMARY KEY,character_id uuid NOT NULL REFERENCES characters(id),template_key text NOT NULL,
 state jsonb,revision bigint NOT NULL CHECK(revision>0),last_event_id uuid NOT NULL UNIQUE REFERENCES equipment_loadout_events(id),
 UNIQUE(character_id,template_key)
);
ALTER TABLE equipment_loadout_events ADD CONSTRAINT loadout_event_identity FOREIGN KEY(loadout_id) REFERENCES equipment_loadouts(id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE equipment_loadout_items (
 loadout_id uuid NOT NULL REFERENCES equipment_loadouts(id),item_id uuid NOT NULL REFERENCES inventory_items(id),PRIMARY KEY(loadout_id,item_id)
);
CREATE INDEX protected_loadout_items ON equipment_loadout_items(item_id);
CREATE TRIGGER immutable_loadout_event BEFORE UPDATE OR DELETE ON equipment_loadout_events FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION guard_loadout_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF pg_trigger_depth()<2 OR (TG_TABLE_NAME='equipment_loadouts' AND TG_OP='DELETE') THEN RAISE EXCEPTION 'Loadout projections require recorded events'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER loadout_header_projection BEFORE INSERT OR UPDATE OR DELETE ON equipment_loadouts FOR EACH ROW EXECUTE FUNCTION guard_loadout_projection();
CREATE TRIGGER loadout_item_projection BEFORE INSERT OR UPDATE OR DELETE ON equipment_loadout_items FOR EACH ROW EXECUTE FUNCTION guard_loadout_projection();
CREATE FUNCTION apply_loadout_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior equipment_loadouts%ROWTYPE; owner_run runs%ROWTYPE; source uuid;
BEGIN
 SELECT * INTO owner_run FROM runs WHERE id=NEW.run_id FOR NO KEY UPDATE;
 IF owner_run.character_id<>NEW.character_id OR owner_run.status NOT IN('ACTIVE','AFTERCORE') THEN RAISE EXCEPTION 'Loadout requires current character ownership'; END IF;
 SELECT * INTO prior FROM equipment_loadouts WHERE character_id=NEW.character_id AND template_key=NEW.template_key FOR UPDATE;
 IF NEW.revision<>coalesce(prior.revision,0)+1 OR NEW.before_state IS DISTINCT FROM prior.state OR (prior.id IS NOT NULL AND prior.id<>NEW.loadout_id) THEN RAISE EXCEPTION 'Loadout history must advance consecutively'; END IF;
 IF NEW.after_state IS NOT NULL AND (
  jsonb_typeof(NEW.after_state)<>'object' OR (NEW.after_state-ARRAY['name','plan','protectItems'])<>'{}'::jsonb OR NOT(NEW.after_state ?& ARRAY['name','plan','protectItems'])
  OR jsonb_typeof(NEW.after_state->'name')<>'string' OR length(btrim(NEW.after_state->>'name')) NOT BETWEEN 1 AND 80
  OR NEW.after_state->>'name' ~ '[[:cntrl:]]' OR jsonb_typeof(NEW.after_state->'plan')<>'object' OR jsonb_typeof(NEW.after_state->'protectItems')<>'boolean') THEN RAISE EXCEPTION 'Invalid loadout state'; END IF;
 IF NEW.reason='SAVE_LOADOUT' THEN
  SELECT last_event_id INTO source FROM run_equipment WHERE run_id=NEW.run_id;
  IF NEW.after_state IS NULL OR NEW.after_state->'plan' IS DISTINCT FROM equipment_snapshot(NEW.run_id) OR NEW.after_state->'protectItems'<>'true'::jsonb OR NEW.equipment_event_id IS DISTINCT FROM source THEN RAISE EXCEPTION 'Loadouts must capture current equipment with protection'; END IF;
  IF prior.state IS NULL AND (SELECT count(*) FROM equipment_loadouts WHERE character_id=NEW.character_id AND state IS NOT NULL)>=32 THEN RAISE EXCEPTION 'Loadout limit reached'; END IF;
 ELSIF NEW.reason='SET_LOADOUT_PROTECTION' THEN
  IF NEW.before_state IS NULL OR NEW.after_state IS NULL OR NEW.equipment_event_id IS NOT NULL OR (NEW.after_state-'protectItems') IS DISTINCT FROM (NEW.before_state-'protectItems') THEN RAISE EXCEPTION 'Protection action may only change protection'; END IF;
 ELSE
  IF NEW.before_state IS NULL OR NEW.after_state IS NOT NULL OR NEW.equipment_event_id IS NOT NULL THEN RAISE EXCEPTION 'Deletion must retire the existing loadout'; END IF;
 END IF;
 PERFORM id FROM inventory_items WHERE id IN(
  SELECT (value->>'itemId')::uuid FROM jsonb_array_elements(coalesce(NEW.before_state->'plan'->'slots','[]'::jsonb))
  UNION SELECT (value->>'itemId')::uuid FROM jsonb_array_elements(coalesce(NEW.after_state->'plan'->'slots','[]'::jsonb))) ORDER BY id FOR UPDATE;
 DELETE FROM equipment_loadout_items WHERE loadout_id=NEW.loadout_id;
 INSERT INTO equipment_loadouts(id,character_id,template_key,state,revision,last_event_id) VALUES(NEW.loadout_id,NEW.character_id,NEW.template_key,NEW.after_state,NEW.revision,NEW.id)
 ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,revision=EXCLUDED.revision,last_event_id=EXCLUDED.last_event_id;
 IF NEW.after_state->'protectItems'='true'::jsonb THEN
  INSERT INTO equipment_loadout_items(loadout_id,item_id) SELECT DISTINCT NEW.loadout_id,(value->>'itemId')::uuid FROM jsonb_array_elements(NEW.after_state->'plan'->'slots');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER loadout_event_apply AFTER INSERT ON equipment_loadout_events FOR EACH ROW EXECUTE FUNCTION apply_loadout_event();
CREATE FUNCTION guard_loadout_quantity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind IN('CONSUME','SPLIT','MERGE') THEN
  PERFORM id FROM inventory_items WHERE id IN(NEW.from_item_id,NEW.to_item_id) ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM equipment_loadout_items WHERE item_id IN(NEW.from_item_id,NEW.to_item_id)) THEN RAISE EXCEPTION 'Loadout item requires explicit protection release'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER loadout_quantity_operation BEFORE INSERT ON inventory_quantity_operations FOR EACH ROW EXECUTE FUNCTION guard_loadout_quantity();
CREATE VIEW equipment_loadout_integrity_issues AS
SELECT l.id AS loadout_id FROM equipment_loadouts l LEFT JOIN equipment_loadout_events latest ON latest.id=l.last_event_id
WHERE latest.id IS NULL OR latest.loadout_id<>l.id OR latest.character_id<>l.character_id OR latest.template_key<>l.template_key OR latest.revision<>l.revision OR latest.after_state IS DISTINCT FROM l.state
 OR l.revision IS DISTINCT FROM (SELECT max(revision) FROM equipment_loadout_events WHERE loadout_id=l.id)
 OR EXISTS(SELECT 1 FROM (
  SELECT e.*,row_number() OVER(PARTITION BY loadout_id ORDER BY revision) AS expected_revision,
   lag(after_state) OVER(PARTITION BY loadout_id ORDER BY revision) AS expected_before FROM equipment_loadout_events e) chain
  JOIN runs r ON r.id=chain.run_id JOIN characters c ON c.id=r.character_id LEFT JOIN action_receipts a ON a.action_id=chain.action_id
  LEFT JOIN equipment_events capture ON capture.id=chain.equipment_event_id
  WHERE chain.loadout_id=l.id AND (chain.revision<>chain.expected_revision OR chain.before_state IS DISTINCT FROM chain.expected_before OR chain.character_id<>l.character_id OR chain.template_key<>l.template_key OR r.character_id<>l.character_id
   OR a.account_id IS DISTINCT FROM c.account_id OR a.action_type IS DISTINCT FROM chain.reason OR a.authorization_source NOT IN('MANUAL_UI','API')
   OR (chain.reason='SAVE_LOADOUT' AND (chain.after_state->'plan' IS DISTINCT FROM coalesce(capture.after_state,'{"activeSet":"A","slots":[]}'::jsonb) OR (capture.id IS NOT NULL AND capture.run_id<>chain.run_id)))))
 OR EXISTS(SELECT 1 FROM equipment_loadout_items refs JOIN inventory_items i ON i.id=refs.item_id JOIN inventory_containers b ON b.id=i.container_id JOIN state_scopes s ON s.id=b.scope_id LEFT JOIN runs r ON r.id=s.run_id LEFT JOIN characters custody ON custody.id=r.character_id JOIN characters owner ON owner.id=l.character_id
  WHERE refs.loadout_id=l.id AND (l.state IS NULL OR l.state->'protectItems'<>'true'::jsonb OR i.quantity<=0 OR coalesce(s.account_id,custody.account_id) IS DISTINCT FROM owner.account_id
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(l.state->'plan'->'slots') slot WHERE slot->>'itemId'=i.id::text)))
 OR (l.state->'protectItems'='true'::jsonb AND EXISTS(SELECT 1 FROM jsonb_array_elements(l.state->'plan'->'slots') slot WHERE NOT EXISTS(SELECT 1 FROM equipment_loadout_items refs WHERE refs.loadout_id=l.id AND refs.item_id=(slot->>'itemId')::uuid)))
 OR (SELECT count(*) FROM equipment_loadouts active WHERE active.character_id=l.character_id AND active.state IS NOT NULL)>32;
CREATE FUNCTION check_loadout_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 IF TG_TABLE_NAME='equipment_loadouts' THEN target:=NEW.id;
 ELSIF TG_TABLE_NAME='inventory_items' THEN
  IF EXISTS(SELECT 1 FROM equipment_loadout_integrity_issues problems JOIN equipment_loadout_items refs ON refs.loadout_id=problems.loadout_id WHERE refs.item_id=NEW.id) THEN RAISE EXCEPTION 'Loadout protection or history is inconsistent'; END IF;RETURN NULL;
 ELSE IF TG_OP='DELETE' THEN target:=OLD.loadout_id;ELSE target:=NEW.loadout_id;END IF;END IF;
 IF EXISTS(SELECT 1 FROM equipment_loadout_integrity_issues WHERE loadout_id=target) THEN RAISE EXCEPTION 'Loadout protection or history is inconsistent'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER loadout_event_integrity AFTER INSERT ON equipment_loadout_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_loadout_integrity();
CREATE CONSTRAINT TRIGGER loadout_header_integrity AFTER INSERT OR UPDATE ON equipment_loadouts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_loadout_integrity();
CREATE CONSTRAINT TRIGGER loadout_item_integrity AFTER INSERT OR UPDATE OR DELETE ON equipment_loadout_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_loadout_integrity();
CREATE CONSTRAINT TRIGGER loadout_custody_integrity AFTER UPDATE ON inventory_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_loadout_integrity();
