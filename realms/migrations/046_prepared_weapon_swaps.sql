-- A combat swap changes only the active prepared set, with an immutable
-- engine transition as its authority. It cannot add/remove equipment slots.
ALTER TABLE equipment_events DROP CONSTRAINT equipment_events_reason_check;
ALTER TABLE equipment_events ADD CONSTRAINT equipment_events_reason_check CHECK(reason IN('PLAYER_SETUP','ASCENSION_CLEAR','COMBAT_SWAP'));
CREATE FUNCTION combat_swap_proven(target_run uuid,target_action uuid,target_set text) RETURNS boolean LANGUAGE SQL STABLE
BEGIN ATOMIC
 SELECT EXISTS(SELECT 1 FROM tactical_steps s JOIN tactical_encounter_origins o ON o.instance_id=s.instance_id WHERE o.run_id=target_run AND s.action_id=target_action AND s.intent->>'kind'='SWAP_SET' AND s.state->'units'->0->'prepared'->>'activeSet'=target_set)
 OR EXISTS(SELECT 1 FROM shared_tactical_steps s JOIN shared_tactical_members m ON m.session_id=s.session_id CROSS JOIN LATERAL jsonb_array_elements(s.state->'units') u WHERE m.run_id=target_run AND s.action_id=target_action AND s.intent->>'kind'='SWAP_SET' AND s.intent->>'actorId'=m.unit_id AND u->>'id'=m.unit_id AND u->'prepared'->>'activeSet'=target_set);
END;
CREATE FUNCTION guard_combat_swap_equipment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.reason='COMBAT_SWAP' AND (NEW.before_state->'slots' IS DISTINCT FROM NEW.after_state->'slots' OR NOT combat_swap_proven(NEW.run_id,NEW.action_id,NEW.after_state->>'activeSet')) THEN RAISE EXCEPTION 'A prepared swap requires its exact owned combat transition'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER combat_swap_equipment_guard BEFORE INSERT ON equipment_events FOR EACH ROW EXECUTE FUNCTION guard_combat_swap_equipment();

CREATE OR REPLACE VIEW equipment_integrity_issues AS
SELECT r.id AS run_id FROM runs r WHERE
 EXISTS(SELECT 1 FROM equipment_slots es JOIN inventory_items i ON i.id=es.item_id JOIN inventory_containers b ON b.id=i.container_id JOIN state_scopes s ON s.id=b.scope_id JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision LEFT JOIN run_progression p ON p.run_id=es.run_id
  WHERE es.run_id=r.id AND (r.status NOT IN('ACTIVE','AFTERCORE') OR s.run_id IS DISTINCT FROM r.id OR s.lifecycle<>'ACTIVE' OR b.kind<>'CARRIED'
   OR i.release_id IS DISTINCT FROM r.content_release_id OR i.quantity<>1 OR i.storage_mode<>'INSTANCE' OR i.binding='SYSTEM_UNTRADEABLE'
   OR v.definition->'mechanics'->'inventory'->>'category' IS DISTINCT FROM 'EQUIPMENT'
   OR coalesce(v.definition->'mechanics'->'equipment'->>'version','') NOT IN('1','2')
   OR coalesce(v.definition->'mechanics'->'equipment'->>'bindingPolicy','') NOT IN('PRESERVE','ACCOUNT_ON_ACTIVE_EQUIP')
   OR (v.definition->'mechanics'->'equipment'->>'bindingPolicy'='ACCOUNT_ON_ACTIVE_EQUIP' AND (es.set_id='WORN' OR es.set_id=(SELECT active_set FROM run_equipment WHERE run_id=es.run_id)) AND i.binding='TRADEABLE')
   OR NOT coalesce(equipment_eligible_slots(v.definition->'mechanics'->'equipment') ? es.slot,false)
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
    OR (CASE WHEN chain.reason='COMBAT_SWAP' THEN a.action_type NOT IN('TACTICAL_ACTION','STEP_COMBAT_PLAN','SHARED_TACTICAL_ACTION') OR NOT combat_swap_proven(chain.run_id,chain.action_id,chain.after_state->>'activeSet') OR chain.before_state->'slots' IS DISTINCT FROM chain.after_state->'slots' ELSE a.action_type IS DISTINCT FROM CASE WHEN chain.reason='PLAYER_SETUP' THEN 'SET_EQUIPMENT' ELSE 'ASCEND' END END)
    OR (chain.reason='ASCENSION_CLEAR' AND NOT EXISTS(SELECT 1 FROM run_history h WHERE h.run_id=r.id AND h.action_id=chain.action_id))
    OR NOT EXISTS(SELECT 1 FROM run_equipment p WHERE p.run_id=r.id)));

CREATE OR REPLACE FUNCTION apply_item_binding_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item inventory_items%ROWTYPE;
BEGIN
 SELECT * INTO STRICT item FROM inventory_items WHERE id=NEW.item_id FOR UPDATE;
 IF item.binding<>'TRADEABLE' OR item.quantity<>1 OR item.storage_mode<>'INSTANCE' OR item.bound_account_id IS NOT NULL OR item.bound_run_id IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM equipment_events e JOIN runs r ON r.id=e.run_id JOIN characters c ON c.id=r.character_id
   JOIN inventory_containers b ON b.id=item.container_id JOIN state_scopes s ON s.id=b.scope_id
   JOIN content_versions v ON v.entity_id=item.definition_id AND v.revision=item.definition_revision
   WHERE e.id=NEW.equipment_event_id AND e.action_id=NEW.action_id AND e.run_id=NEW.run_id AND c.account_id=NEW.bound_account_id
    AND e.reason IN('PLAYER_SETUP','COMBAT_SWAP') AND r.status IN('ACTIVE','AFTERCORE') AND s.run_id=r.id AND s.lifecycle='ACTIVE' AND b.kind='CARRIED' AND item.release_id=r.content_release_id
    AND v.definition->'mechanics'->'inventory'->>'category'='EQUIPMENT'
    AND v.definition->'mechanics'->'equipment'->>'version'='2'
    AND v.definition->'mechanics'->'equipment'->>'bindingPolicy'='ACCOUNT_ON_ACTIVE_EQUIP'
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.after_state->'slots') slot WHERE slot->>'itemId'=item.id::text AND (slot->>'set'='WORN' OR slot->>'set'=e.after_state->>'activeSet')))
 THEN RAISE EXCEPTION 'Invalid active-equipment binding transition'; END IF;
 UPDATE inventory_items SET binding='ACCOUNT_BOUND',bound_account_id=NEW.bound_account_id WHERE id=NEW.item_id;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION bind_active_equipment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.reason IN('PLAYER_SETUP','COMBAT_SWAP') THEN
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

CREATE OR REPLACE VIEW item_binding_integrity_issues AS
 SELECT e.item_id FROM item_binding_events e
 JOIN inventory_items i ON i.id=e.item_id
 JOIN equipment_events equipment ON equipment.id=e.equipment_event_id
 JOIN runs r ON r.id=e.run_id JOIN characters c ON c.id=r.character_id
 JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision
 LEFT JOIN action_receipts a ON a.action_id=e.action_id
 WHERE i.binding IS DISTINCT FROM e.binding OR i.bound_account_id IS DISTINCT FROM e.bound_account_id OR i.bound_run_id IS NOT NULL
  OR equipment.run_id<>e.run_id OR equipment.action_id<>e.action_id OR equipment.reason NOT IN('PLAYER_SETUP','COMBAT_SWAP')
  OR c.account_id<>e.bound_account_id OR a.account_id IS DISTINCT FROM e.bound_account_id OR (CASE WHEN equipment.reason='COMBAT_SWAP' THEN a.action_type NOT IN('TACTICAL_ACTION','STEP_COMBAT_PLAN','SHARED_TACTICAL_ACTION') ELSE a.action_type IS DISTINCT FROM 'SET_EQUIPMENT' END)
  OR v.definition->'mechanics'->'equipment'->>'version' IS DISTINCT FROM '2'
  OR v.definition->'mechanics'->'equipment'->>'bindingPolicy' IS DISTINCT FROM 'ACCOUNT_ON_ACTIVE_EQUIP'
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(equipment.after_state->'slots') slot WHERE slot->>'itemId'=i.id::text AND (slot->>'set'='WORN' OR slot->>'set'=equipment.after_state->>'activeSet'));
