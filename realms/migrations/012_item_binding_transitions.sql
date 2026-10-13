-- Ordinary gear and all existing item rows retain their binding. Version 2
-- equipment can opt into an irreversible account bond on active equipping.
CREATE TABLE item_binding_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 item_id uuid NOT NULL UNIQUE REFERENCES inventory_items(id),
 equipment_event_id uuid NOT NULL REFERENCES equipment_events(id),
 action_id uuid NOT NULL REFERENCES action_receipts(action_id) DEFERRABLE INITIALLY DEFERRED,
 run_id uuid NOT NULL REFERENCES runs(id),
 bound_account_id uuid NOT NULL REFERENCES accounts(id),
 previous_binding text NOT NULL CHECK(previous_binding='TRADEABLE'),
 binding text NOT NULL CHECK(binding='ACCOUNT_BOUND'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX binding_events_equipment ON item_binding_events(equipment_event_id);
CREATE INDEX binding_events_action ON item_binding_events(action_id);
CREATE INDEX binding_events_run ON item_binding_events(run_id);
CREATE INDEX binding_events_account ON item_binding_events(bound_account_id);
CREATE TRIGGER immutable_item_binding_event BEFORE UPDATE OR DELETE ON item_binding_events FOR EACH ROW EXECUTE FUNCTION reject_record_change();

CREATE OR REPLACE FUNCTION guard_item_accounting() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Item identities and provenance cannot be deleted'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.quantity<>0 THEN RAISE EXCEPTION 'New items require a quantity ledger grant'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['container_id','quantity'])<>(to_jsonb(OLD)-ARRAY['container_id','quantity']) THEN
   IF (to_jsonb(NEW)-ARRAY['binding','bound_account_id'])<>(to_jsonb(OLD)-ARRAY['binding','bound_account_id'])
    OR pg_trigger_depth()<2 OR OLD.binding<>'TRADEABLE' OR NEW.binding<>'ACCOUNT_BOUND'
    OR NOT EXISTS(SELECT 1 FROM item_binding_events e WHERE e.item_id=OLD.id AND e.previous_binding=OLD.binding AND e.binding=NEW.binding AND e.bound_account_id=NEW.bound_account_id)
   THEN RAISE EXCEPTION 'Item definition, binding and provenance are immutable'; END IF;
  END IF;
  IF NEW.quantity<>OLD.quantity AND pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Item quantities require ledger operations'; END IF;
  IF NEW.container_id<>OLD.container_id AND OLD.quantity=0 THEN RAISE EXCEPTION 'Retired items cannot move'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION apply_item_binding_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item inventory_items%ROWTYPE;
BEGIN
 SELECT * INTO STRICT item FROM inventory_items WHERE id=NEW.item_id FOR UPDATE;
 IF item.binding<>'TRADEABLE' OR item.quantity<>1 OR item.storage_mode<>'INSTANCE' OR item.bound_account_id IS NOT NULL OR item.bound_run_id IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM equipment_events e JOIN runs r ON r.id=e.run_id JOIN characters c ON c.id=r.character_id
   JOIN inventory_containers b ON b.id=item.container_id JOIN state_scopes s ON s.id=b.scope_id
   JOIN content_versions v ON v.entity_id=item.definition_id AND v.revision=item.definition_revision
   WHERE e.id=NEW.equipment_event_id AND e.action_id=NEW.action_id AND e.run_id=NEW.run_id AND c.account_id=NEW.bound_account_id
    AND e.reason='PLAYER_SETUP' AND r.status IN('ACTIVE','AFTERCORE') AND s.run_id=r.id AND s.lifecycle='ACTIVE' AND b.kind='CARRIED' AND item.release_id=r.content_release_id
    AND v.definition->'mechanics'->'inventory'->>'category'='EQUIPMENT'
    AND v.definition->'mechanics'->'equipment'->>'version'='2'
    AND v.definition->'mechanics'->'equipment'->>'bindingPolicy'='ACCOUNT_ON_ACTIVE_EQUIP'
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.after_state->'slots') slot WHERE slot->>'itemId'=item.id::text AND (slot->>'set'='WORN' OR slot->>'set'=e.after_state->>'activeSet')))
 THEN RAISE EXCEPTION 'Invalid active-equipment binding transition'; END IF;
 UPDATE inventory_items SET binding='ACCOUNT_BOUND',bound_account_id=NEW.bound_account_id WHERE id=NEW.item_id;
 RETURN NEW;
END $$;
CREATE TRIGGER item_binding_event_apply AFTER INSERT ON item_binding_events FOR EACH ROW EXECUTE FUNCTION apply_item_binding_event();
CREATE FUNCTION bind_active_equipment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.reason='PLAYER_SETUP' THEN
  INSERT INTO item_binding_events(item_id,equipment_event_id,action_id,run_id,bound_account_id,previous_binding,binding)
   SELECT DISTINCT i.id,NEW.id,NEW.action_id,NEW.run_id,c.account_id,'TRADEABLE','ACCOUNT_BOUND'
   FROM jsonb_array_elements(NEW.after_state->'slots') slot
   JOIN inventory_items i ON i.id=(slot->>'itemId')::uuid
   JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision
   JOIN runs r ON r.id=NEW.run_id JOIN characters c ON c.id=r.character_id
   WHERE (slot->>'set'='WORN' OR slot->>'set'=NEW.after_state->>'activeSet') AND i.binding='TRADEABLE'
    AND v.definition->'mechanics'->'equipment'->>'version'='2'
    AND v.definition->'mechanics'->'equipment'->>'bindingPolicy'='ACCOUNT_ON_ACTIVE_EQUIP'
   ORDER BY i.id;
 END IF;
 RETURN NEW;
END $$;
-- AFTER triggers run by name: projection application precedes binding.
CREATE TRIGGER z_equipment_binding_apply AFTER INSERT ON equipment_events FOR EACH ROW EXECUTE FUNCTION bind_active_equipment();
CREATE FUNCTION inventory_issue_binding(target uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT previous_binding FROM item_binding_events WHERE item_id=target),(SELECT binding FROM inventory_items WHERE id=target));
$$;

CREATE OR REPLACE VIEW encounter_reward_issues AS
SELECT e.instance_id FROM encounter_records e
JOIN content_versions v ON v.entity_id=e.definition_id AND v.revision=e.definition_revision
LEFT JOIN encounter_reward_plans p ON p.instance_id=e.instance_id
LEFT JOIN encounter_reward_claims c ON c.instance_id=e.instance_id
WHERE
  (v.definition->'mechanics'->'encounter'->>'version'='2' AND p.instance_id IS NULL)
  OR (p.instance_id IS NOT NULL AND (
    v.definition->'mechanics'->'encounter'->>'version' IS DISTINCT FROM '2'
    OR v.definition->'mechanics'->'encounter'->>'lootTableId' IS DISTINCT FROM p.loot_table_id
    OR p.release_id<>e.release_id OR p.commit_action_id<>e.start_action_id
    OR (e.outcome='VICTORY' AND c.instance_id IS NULL)))
  OR (c.instance_id IS NOT NULL AND (e.outcome IS DISTINCT FROM 'VICTORY' OR c.action_id IS DISTINCT FROM e.finish_action_id))
  OR (c.instance_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM jsonb_array_elements(p.rewards) r
    LEFT JOIN encounter_reward_items line ON line.instance_id=e.instance_id AND line.reward_key=r->>'key'
    LEFT JOIN inventory_quantity_operations op ON op.id=line.operation_id
    LEFT JOIN inventory_items item ON item.id=op.to_item_id
    WHERE line.operation_id IS NULL OR op.kind<>'GRANT' OR op.action_id IS DISTINCT FROM c.action_id
      OR op.quantity::text IS DISTINCT FROM r->>'quantity' OR op.reason<>'ENCOUNTER_REWARD'
      OR item.definition_id IS DISTINCT FROM r->>'itemId' OR item.release_id IS DISTINCT FROM p.release_id
      OR inventory_issue_binding(item.id) IS DISTINCT FROM r->>'binding' OR item.quality IS DISTINCT FROM (r->>'quality')::numeric
      OR item.source_code<>'ENCOUNTER_LOOT'
      OR item.metadata IS DISTINCT FROM jsonb_build_object('encounterId',e.instance_id::text,'lootTableId',p.loot_table_id,'group',r->>'key')))
  OR EXISTS(SELECT 1 FROM encounter_reward_items line WHERE line.instance_id=e.instance_id AND NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(p.rewards) r WHERE r->>'key'=line.reward_key));

CREATE OR REPLACE VIEW equipment_integrity_issues AS
SELECT r.id AS run_id FROM runs r WHERE
 EXISTS(SELECT 1 FROM equipment_slots es JOIN inventory_items i ON i.id=es.item_id JOIN inventory_containers b ON b.id=i.container_id JOIN state_scopes s ON s.id=b.scope_id JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision LEFT JOIN run_progression p ON p.run_id=es.run_id
  WHERE es.run_id=r.id AND (r.status NOT IN('ACTIVE','AFTERCORE') OR s.run_id IS DISTINCT FROM r.id OR s.lifecycle<>'ACTIVE' OR b.kind<>'CARRIED'
   OR i.release_id IS DISTINCT FROM r.content_release_id OR i.quantity<>1 OR i.storage_mode<>'INSTANCE' OR i.binding='SYSTEM_UNTRADEABLE'
   OR v.definition->'mechanics'->'inventory'->>'category' IS DISTINCT FROM 'EQUIPMENT'
   OR coalesce(v.definition->'mechanics'->'equipment'->>'version','') NOT IN('1','2')
   OR coalesce(v.definition->'mechanics'->'equipment'->>'bindingPolicy','') NOT IN('PRESERVE','ACCOUNT_ON_ACTIVE_EQUIP')
   OR (v.definition->'mechanics'->'equipment'->>'bindingPolicy'='ACCOUNT_ON_ACTIVE_EQUIP' AND (es.set_id='WORN' OR es.set_id=(SELECT active_set FROM run_equipment WHERE run_id=es.run_id)) AND i.binding='TRADEABLE')
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
CREATE VIEW item_binding_integrity_issues AS
 SELECT e.item_id FROM item_binding_events e
 JOIN inventory_items i ON i.id=e.item_id
 JOIN equipment_events equipment ON equipment.id=e.equipment_event_id
 JOIN runs r ON r.id=e.run_id JOIN characters c ON c.id=r.character_id
 JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision
 LEFT JOIN action_receipts a ON a.action_id=e.action_id
 WHERE i.binding IS DISTINCT FROM e.binding OR i.bound_account_id IS DISTINCT FROM e.bound_account_id OR i.bound_run_id IS NOT NULL
  OR equipment.run_id<>e.run_id OR equipment.action_id<>e.action_id OR equipment.reason<>'PLAYER_SETUP'
  OR c.account_id<>e.bound_account_id OR a.account_id IS DISTINCT FROM e.bound_account_id OR a.action_type IS DISTINCT FROM 'SET_EQUIPMENT'
  OR v.definition->'mechanics'->'equipment'->>'version' IS DISTINCT FROM '2'
  OR v.definition->'mechanics'->'equipment'->>'bindingPolicy' IS DISTINCT FROM 'ACCOUNT_ON_ACTIVE_EQUIP'
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(equipment.after_state->'slots') slot WHERE slot->>'itemId'=i.id::text AND (slot->>'set'='WORN' OR slot->>'set'=equipment.after_state->>'activeSet'));
CREATE FUNCTION check_item_binding_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 IF TG_TABLE_NAME='inventory_items' THEN target:=NEW.id;ELSE target:=NEW.item_id;END IF;
 IF EXISTS(SELECT 1 FROM item_binding_integrity_issues WHERE item_id=target) THEN RAISE EXCEPTION 'Item binding history is inconsistent'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER item_binding_event_integrity AFTER INSERT ON item_binding_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_item_binding_history();
CREATE CONSTRAINT TRIGGER item_binding_history_integrity AFTER UPDATE ON inventory_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_item_binding_history();
