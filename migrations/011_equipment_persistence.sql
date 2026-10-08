CREATE TABLE equipment_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 action_id uuid NOT NULL UNIQUE REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 run_id uuid NOT NULL REFERENCES runs(id), revision bigint NOT NULL CHECK(revision>0),
 before_state jsonb NOT NULL,after_state jsonb NOT NULL,
 reason text NOT NULL CHECK(reason IN('PLAYER_SETUP','ASCENSION_CLEAR')),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(run_id,revision),CHECK(before_state<>after_state)
);
CREATE TABLE run_equipment (
 run_id uuid PRIMARY KEY REFERENCES runs(id),active_set text NOT NULL CHECK(active_set IN('A','B')),
 revision bigint NOT NULL CHECK(revision>0),last_event_id uuid NOT NULL UNIQUE REFERENCES equipment_events(id)
);
CREATE TABLE equipment_slots (
 run_id uuid NOT NULL REFERENCES run_equipment(run_id),set_id text NOT NULL CHECK(set_id IN('WORN','A','B')),
 slot text NOT NULL CHECK(slot IN('HEAD','NECK','SHOULDERS','CHEST','HANDS','WAIST','LEGS','FEET','RING_1','RING_2','TRINKET','TOOL','MAIN_HAND','OFF_HAND')),
 item_id uuid NOT NULL REFERENCES inventory_items(id),PRIMARY KEY(run_id,set_id,slot),
 CHECK((set_id='WORN')=(slot NOT IN('MAIN_HAND','OFF_HAND')))
);
CREATE INDEX equipment_slots_by_item ON equipment_slots(item_id);
CREATE FUNCTION equipment_snapshot(target uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('activeSet',coalesce((SELECT active_set FROM run_equipment WHERE run_id=target),'A'),
  'slots',coalesce((SELECT jsonb_agg(jsonb_build_object('set',set_id,'slot',slot,'itemId',item_id::text) ORDER BY set_id,slot) FROM equipment_slots WHERE run_id=target),'[]'::jsonb));
$$;
CREATE TRIGGER immutable_equipment_event BEFORE UPDATE OR DELETE ON equipment_events FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE FUNCTION guard_equipment_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Equipment projections require recorded events'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER equipment_header_projection BEFORE INSERT OR UPDATE OR DELETE ON run_equipment FOR EACH ROW EXECUTE FUNCTION guard_equipment_projection();
CREATE TRIGGER equipment_slot_projection BEFORE INSERT OR UPDATE OR DELETE ON equipment_slots FOR EACH ROW EXECUTE FUNCTION guard_equipment_projection();
CREATE FUNCTION apply_equipment_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line jsonb; prior_revision bigint; expected_state jsonb; seen text[]:='{}'; key text;
BEGIN
 SELECT revision INTO prior_revision FROM run_equipment WHERE run_id=NEW.run_id;
 IF NEW.revision<>coalesce(prior_revision,0)+1 OR NEW.before_state<>equipment_snapshot(NEW.run_id) THEN RAISE EXCEPTION 'Equipment history must advance consecutively'; END IF;
 IF jsonb_typeof(NEW.after_state)<>'object' OR (NEW.after_state-ARRAY['activeSet','slots'])<>'{}'::jsonb OR NOT(NEW.after_state ?& ARRAY['activeSet','slots'])
  OR NEW.after_state->>'activeSet' NOT IN('A','B') OR jsonb_typeof(NEW.after_state->'slots')<>'array' OR jsonb_array_length(NEW.after_state->'slots')>16 THEN RAISE EXCEPTION 'Invalid equipment state'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(NEW.after_state->'slots') LOOP
  IF jsonb_typeof(line)<>'object' OR (line-ARRAY['set','slot','itemId'])<>'{}'::jsonb OR NOT(line ?& ARRAY['set','slot','itemId'])
   OR line->>'set' NOT IN('WORN','A','B') OR line->>'itemId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid equipment slot'; END IF;
  key:=(line->>'set')||':'||(line->>'slot');IF key=ANY(seen) THEN RAISE EXCEPTION 'Duplicate equipment slot'; END IF;seen:=array_append(seen,key);
 END LOOP;
 SELECT jsonb_build_object('activeSet',NEW.after_state->>'activeSet','slots',coalesce(jsonb_agg(value ORDER BY value->>'set',value->>'slot'),'[]'::jsonb)) INTO expected_state FROM jsonb_array_elements(NEW.after_state->'slots');
 IF expected_state<>NEW.after_state THEN RAISE EXCEPTION 'Equipment slots must be canonical'; END IF;
 PERFORM id FROM inventory_items WHERE id IN(SELECT (value->>'itemId')::uuid FROM jsonb_array_elements(NEW.after_state->'slots') UNION SELECT item_id FROM equipment_slots WHERE run_id=NEW.run_id) ORDER BY id FOR UPDATE;
 IF NEW.reason='PLAYER_SETUP' AND EXISTS(SELECT 1 FROM instance_participants p JOIN instances i ON i.id=p.instance_id WHERE p.run_id=NEW.run_id AND i.lifecycle='ACTIVE') THEN RAISE EXCEPTION 'Cannot reconfigure equipment during an active instance'; END IF;
 IF NEW.reason='ASCENSION_CLEAR' AND NEW.after_state<>'{"activeSet":"A","slots":[]}'::jsonb THEN RAISE EXCEPTION 'Ascension must clear equipment'; END IF;
 DELETE FROM equipment_slots WHERE run_id=NEW.run_id;
 INSERT INTO run_equipment(run_id,active_set,revision,last_event_id) VALUES(NEW.run_id,NEW.after_state->>'activeSet',NEW.revision,NEW.id)
  ON CONFLICT(run_id) DO UPDATE SET active_set=EXCLUDED.active_set,revision=EXCLUDED.revision,last_event_id=EXCLUDED.last_event_id;
 INSERT INTO equipment_slots(run_id,set_id,slot,item_id) SELECT NEW.run_id,value->>'set',value->>'slot',(value->>'itemId')::uuid FROM jsonb_array_elements(NEW.after_state->'slots');
 RETURN NEW;
END $$;
CREATE TRIGGER equipment_event_apply AFTER INSERT ON equipment_events FOR EACH ROW EXECUTE FUNCTION apply_equipment_event();
CREATE VIEW equipment_integrity_issues AS
SELECT r.id AS run_id FROM runs r WHERE
 EXISTS(SELECT 1 FROM equipment_slots es JOIN inventory_items i ON i.id=es.item_id JOIN inventory_containers b ON b.id=i.container_id JOIN state_scopes s ON s.id=b.scope_id JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision LEFT JOIN run_progression p ON p.run_id=es.run_id
  WHERE es.run_id=r.id AND (r.status NOT IN('ACTIVE','AFTERCORE') OR s.run_id IS DISTINCT FROM r.id OR s.lifecycle<>'ACTIVE' OR b.kind<>'CARRIED'
   OR i.release_id IS DISTINCT FROM r.content_release_id OR i.quantity<>1 OR i.storage_mode<>'INSTANCE' OR i.binding='SYSTEM_UNTRADEABLE'
   OR v.definition->'mechanics'->'inventory'->>'category' IS DISTINCT FROM 'EQUIPMENT'
   OR v.definition->'mechanics'->'equipment'->>'version' IS DISTINCT FROM '1'
   OR v.definition->'mechanics'->'equipment'->>'bindingPolicy' IS DISTINCT FROM 'PRESERVE'
   OR NOT coalesce((v.definition->'mechanics'->'equipment'->'slots') ? es.slot,false)
   OR coalesce(p.level,0)<coalesce((v.definition->'mechanics'->'equipment'->>'minimumLevel')::integer,1000)
   OR ((v.definition->'mechanics'->'equipment'->>'hands')::integer=2 AND EXISTS(SELECT 1 FROM equipment_slots offhand WHERE offhand.run_id=es.run_id AND offhand.set_id=es.set_id AND offhand.slot='OFF_HAND'))
   OR EXISTS(SELECT 1 FROM equipment_slots duplicate WHERE duplicate.run_id=es.run_id AND duplicate.item_id=es.item_id AND (duplicate.set_id<>es.set_id OR duplicate.slot<>es.slot)
      AND (duplicate.set_id='WORN' OR es.set_id='WORN' OR duplicate.set_id=es.set_id OR duplicate.slot<>es.slot))))
 OR EXISTS(SELECT 1 FROM run_equipment p LEFT JOIN equipment_events e ON e.id=p.last_event_id WHERE p.run_id=r.id AND
  (e.run_id IS DISTINCT FROM r.id OR p.revision IS DISTINCT FROM e.revision OR equipment_snapshot(r.id) IS DISTINCT FROM e.after_state OR p.revision IS DISTINCT FROM (SELECT max(revision) FROM equipment_events WHERE run_id=r.id)))
 OR EXISTS(SELECT 1 FROM (SELECT e.*,row_number() OVER(PARTITION BY run_id ORDER BY revision) AS expected_revision,
   lag(after_state,1,'{"activeSet":"A","slots":[]}'::jsonb) OVER(PARTITION BY run_id ORDER BY revision) AS expected_before FROM equipment_events e) chain
  JOIN characters c ON c.id=r.character_id LEFT JOIN action_receipts a ON a.action_id=chain.action_id
  WHERE chain.run_id=r.id AND (chain.revision<>chain.expected_revision OR chain.before_state IS DISTINCT FROM chain.expected_before OR a.account_id IS DISTINCT FROM c.account_id
    OR a.action_type IS DISTINCT FROM CASE WHEN chain.reason='PLAYER_SETUP' THEN 'SET_EQUIPMENT' ELSE 'ASCEND' END
    OR (chain.reason='ASCENSION_CLEAR' AND NOT EXISTS(SELECT 1 FROM run_history h WHERE h.run_id=r.id AND h.action_id=chain.action_id))
    OR NOT EXISTS(SELECT 1 FROM run_equipment p WHERE p.run_id=r.id)));
CREATE FUNCTION check_equipment_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 IF TG_TABLE_NAME='runs' THEN target:=NEW.id;ELSE target:=NEW.run_id;END IF;
 IF EXISTS(SELECT 1 FROM equipment_integrity_issues WHERE run_id=target) THEN RAISE EXCEPTION 'Equipment state or history is inconsistent'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER equipment_event_integrity AFTER INSERT ON equipment_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_equipment_integrity();
CREATE CONSTRAINT TRIGGER equipment_header_integrity AFTER INSERT OR UPDATE ON run_equipment DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_equipment_integrity();
CREATE CONSTRAINT TRIGGER equipment_slot_integrity AFTER INSERT OR UPDATE ON equipment_slots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_equipment_integrity();
CREATE CONSTRAINT TRIGGER equipment_run_integrity AFTER UPDATE ON runs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_equipment_integrity();
CREATE CONSTRAINT TRIGGER equipment_level_integrity AFTER UPDATE ON run_progression DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_equipment_integrity();
CREATE FUNCTION guard_equipped_quantity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind IN('CONSUME','SPLIT','MERGE') THEN
  PERFORM id FROM inventory_items WHERE id IN(NEW.from_item_id,NEW.to_item_id) ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM equipment_slots WHERE item_id IN(NEW.from_item_id,NEW.to_item_id)) THEN RAISE EXCEPTION 'Equipped item cannot change quantity'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER equipped_quantity_operation BEFORE INSERT ON inventory_quantity_operations FOR EACH ROW EXECUTE FUNCTION guard_equipped_quantity();
CREATE FUNCTION guard_equipped_custody() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.container_id<>OLD.container_id AND EXISTS(SELECT 1 FROM equipment_slots WHERE item_id=OLD.id) THEN RAISE EXCEPTION 'Equipped item must be unequipped before moving'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER equipped_item_custody BEFORE UPDATE ON inventory_items FOR EACH ROW EXECUTE FUNCTION guard_equipped_custody();
