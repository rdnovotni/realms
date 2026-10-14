-- Opt-in physical carrying rules. Existing releases without a policy are unchanged.
INSERT INTO state_contracts(key,owner_module,scope_kind,reset_policy,value_schema,default_value,ascension_policy)
VALUES('inventory.preferences.v1','inventory','ACCOUNT','KEEP',
'{"type":"object","additionalProperties":false,"required":["autoStoreMaterials","autoOverflow"],"properties":{"autoStoreMaterials":{"type":"boolean"},"autoOverflow":{"type":"boolean"}}}',
'{"autoStoreMaterials":false,"autoOverflow":false}','KEEP');

-- Protected sequence numbers attest which immutable quantity events existed
-- at encounter start. Runtime cannot insert or rewrite this ordering table.
CREATE TABLE inventory_quantity_order (
 operation_no bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 operation_id uuid NOT NULL UNIQUE REFERENCES inventory_quantity_operations(id)
);
INSERT INTO inventory_quantity_order(operation_id) SELECT id FROM inventory_quantity_operations ORDER BY created_at,id;
CREATE TRIGGER inventory_quantity_order_immutable BEFORE UPDATE OR DELETE ON inventory_quantity_order FOR EACH ROW EXECUTE FUNCTION reject_record_change();
DO $install$
BEGIN
 EXECUTE format($ddl$
 CREATE FUNCTION record_inventory_quantity_order() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path = %I, pg_catalog, pg_temp AS $body$
 BEGIN
  INSERT INTO inventory_quantity_order(operation_id) VALUES(NEW.id);
  RETURN NEW;
 END $body$
 $ddl$,current_schema());
END $install$;
REVOKE ALL ON FUNCTION record_inventory_quantity_order() FROM PUBLIC;
CREATE TRIGGER record_inventory_quantity_order AFTER INSERT ON inventory_quantity_operations FOR EACH ROW EXECUTE FUNCTION record_inventory_quantity_order();

CREATE FUNCTION inventory_carry_load(target uuid) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE pinned_release uuid; policy jsonb; policy_id text; policy_revision integer; strength integer; weight numeric; bulk numeric; missing integer;
 weight_cap numeric; bulk_cap numeric; contributions jsonb; bonus_weight numeric; bonus_bulk numeric; state text; penalties jsonb;
BEGIN
 SELECT content_release_id INTO pinned_release FROM runs WHERE id=target;
 SELECT e.entity_id,e.revision,v.definition->'mechanics'->'inventoryRules' INTO policy_id,policy_revision,policy
 FROM release_entries e JOIN content_entities ce ON ce.id=e.entity_id AND ce.kind='TUNING'
 JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision
 WHERE e.release_id=pinned_release AND v.definition->'mechanics'->'inventoryRules' IS NOT NULL ORDER BY e.entity_id LIMIT 1;
 SELECT (attribute_projection(target)->>'strength')::integer INTO strength;
 SELECT coalesce(sum(i.quantity::numeric*coalesce((v.definition->'mechanics'->'inventory'->>'unitWeight')::numeric,0)),0),
 coalesce(sum(i.quantity::numeric*coalesce((v.definition->'mechanics'->'inventory'->>'unitBulk')::numeric,0)),0),
 count(*) FILTER(WHERE v.definition->'mechanics'->'inventory'->>'version' IS DISTINCT FROM '2')::integer
 INTO weight,bulk,missing FROM inventory_items i JOIN inventory_containers c ON c.id=i.container_id AND c.kind='CARRIED'
 JOIN state_scopes s ON s.id=c.scope_id AND s.run_id=target AND s.lifecycle='ACTIVE'
 JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision WHERE i.quantity>0;
 SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',entity_id,'revision',revision,'itemId',item_id,'name',(SELECT label.definition->>'name' FROM content_versions label WHERE label.entity_id=owned.entity_id AND label.revision=owned.revision),
 'weight',spec->>'weight','bulk',spec->>'bulk')) ORDER BY entity_id COLLATE "C",item_id),'[]') INTO contributions FROM (
 SELECT e.entity_id,e.revision,NULL::text item_id,v.definition->'mechanics'->'inventoryCapacity' spec,c.native_level
 FROM run_class_levels c JOIN release_entries e ON e.release_id=pinned_release AND e.entity_id=c.class_id JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE c.run_id=target
 UNION ALL
 SELECT e.entity_id,e.revision,NULL::text,v.definition->'mechanics'->'inventoryCapacity',0 FROM run_feats f JOIN release_entries e ON e.release_id=pinned_release AND e.entity_id=f.feat_id AND e.revision=f.feat_revision JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE f.run_id=target
 UNION ALL
 SELECT e.entity_id,e.revision,NULL::text,v.definition->'mechanics'->'inventoryCapacity',0 FROM run_subclasses f JOIN release_entries e ON e.release_id=pinned_release AND e.entity_id=f.subclass_id AND e.revision=f.subclass_revision JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE f.run_id=target
 UNION ALL
 SELECT DISTINCT e.entity_id,e.revision,i.id::text,v.definition->'mechanics'->'inventoryCapacity',0
 FROM equipment_slots slot JOIN inventory_items i ON i.id=slot.item_id JOIN release_entries e ON e.release_id=pinned_release AND e.entity_id=i.definition_id AND e.revision=i.definition_revision JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision
 WHERE slot.run_id=target AND (slot.set_id='WORN' OR slot.set_id=coalesce((SELECT active_set FROM run_equipment WHERE run_id=target),'A'))
 ) owned WHERE spec IS NOT NULL AND native_level>=(spec->>'minimumNativeLevel')::integer;
 SELECT coalesce(sum((x->>'weight')::numeric),0),coalesce(sum((x->>'bulk')::numeric),0) INTO bonus_weight,bonus_bulk FROM jsonb_array_elements(contributions) x;
 IF policy IS NOT NULL THEN
  weight_cap:=(policy->>'baseWeight')::numeric+coalesce(strength,0)*(policy->>'weightPerStrength')::numeric+bonus_weight;
  bulk_cap:=(policy->>'baseBulk')::numeric+coalesce(strength,0)*(policy->>'bulkPerStrength')::numeric+bonus_bulk;
 END IF;
 state:=CASE WHEN policy IS NULL THEN 'UNCONFIGURED' WHEN missing>0 OR strength IS NULL THEN 'UNMEASURED'
 WHEN weight*10000>weight_cap*(policy->>'encumberedBps')::numeric OR bulk*10000>bulk_cap*(policy->>'encumberedBps')::numeric THEN 'OVERLOADED'
 WHEN weight*10000>weight_cap*(policy->>'burdenedBps')::numeric OR bulk*10000>bulk_cap*(policy->>'burdenedBps')::numeric THEN 'ENCUMBERED'
 WHEN weight*10000>weight_cap*(policy->>'comfortableBps')::numeric OR bulk*10000>bulk_cap*(policy->>'comfortableBps')::numeric THEN 'BURDENED' ELSE 'COMFORTABLE' END;
 penalties:=CASE WHEN state='BURDENED' THEN policy->'burdened' WHEN state IN('ENCUMBERED','OVERLOADED') THEN policy->'encumbered' ELSE '{"initiative":0,"stealth":0,"mobility":0}'::jsonb END;
 RETURN jsonb_strip_nulls(jsonb_build_object('enabled',policy IS NOT NULL,'rulesId',policy_id,'rulesRevision',policy_revision,'rules',policy,
 'quantityWatermark',coalesce((SELECT max(operation_no) FROM inventory_quantity_order),0)::text,'movementWatermark',coalesce((SELECT max(id) FROM inventory_movements),0)::text,
 'strength',strength,'weight',weight::text,'bulk',bulk::text,'weightCapacity',CASE WHEN weight_cap IS NOT NULL THEN weight_cap::text END,
 'bulkCapacity',CASE WHEN bulk_cap IS NOT NULL THEN bulk_cap::text END,'unmeasuredItems',missing,'state',state,'penalties',penalties,'sources',contributions));
END $$;

CREATE FUNCTION guard_inventory_encounter_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE load jsonb;
BEGIN
 load:=inventory_carry_load(NEW.run_id);
 IF load->>'state' IN('OVERLOADED','UNMEASURED') THEN RAISE EXCEPTION 'Inventory cannot enter dangerous encounter: %',load->>'state'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_encounter_entry BEFORE INSERT ON encounter_records FOR EACH ROW EXECUTE FUNCTION guard_inventory_encounter_entry();

-- Historical input objects remain byte-for-byte equivalent. New opted-in
-- snapshots include SQL-attested load evidence; recomputation never reads later inventory.
ALTER FUNCTION character_snapshot_inputs(uuid,text) RENAME TO character_snapshot_inputs_before_inventory;
CREATE FUNCTION character_snapshot_inputs(target uuid,profile text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE input jsonb; load jsonb;
BEGIN
 input:=character_snapshot_inputs_before_inventory(target,profile);load:=inventory_carry_load(target);
 IF (load->>'enabled')::boolean THEN input:=input||jsonb_build_object('inventory',load); END IF;
 RETURN input;
END $$;
ALTER FUNCTION character_snapshot_derived(jsonb) RENAME TO character_snapshot_derived_before_inventory;
CREATE FUNCTION character_snapshot_derived(input jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE output jsonb; adjustment integer;
BEGIN
 output:=character_snapshot_derived_before_inventory(input);
 IF input ? 'inventory' THEN
  adjustment:=(input->'inventory'->'penalties'->>'initiative')::integer;
  output:=jsonb_set(output,'{stats,initiative}',to_jsonb((output->'stats'->>'initiative')::integer+adjustment));
  IF NOT character_stats_valid(output->'stats') THEN RAISE EXCEPTION 'Invalid encumbered character stats'; END IF;
  output:=output||jsonb_build_object('inventory',input->'inventory');
 END IF;
 RETURN output;
END $$;

-- Rebind existing guard/view dependencies to the new wrapper, not renamed OIDs.
CREATE OR REPLACE FUNCTION guard_character_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE encounter encounter_records%ROWTYPE; authored_profile text;
BEGIN
  SELECT * INTO encounter FROM encounter_records WHERE instance_id=NEW.instance_id FOR SHARE;
  SELECT definition->'mechanics'->>'characterProfileId' INTO authored_profile FROM content_versions WHERE entity_id=encounter.definition_id AND revision=encounter.definition_revision;
  IF encounter.run_id IS DISTINCT FROM NEW.run_id OR encounter.revision<>0 OR encounter.outcome IS NOT NULL OR authored_profile IS DISTINCT FROM NEW.profile_id THEN RAISE EXCEPTION 'Character snapshot must match its opted-in encounter start'; END IF;
  IF NEW.inputs IS DISTINCT FROM character_snapshot_inputs(NEW.run_id,NEW.profile_id) THEN RAISE EXCEPTION 'Character snapshot inputs are server-derived'; END IF;
  IF NEW.derived IS DISTINCT FROM character_snapshot_derived(NEW.inputs) THEN RAISE EXCEPTION 'Character snapshot stats are server-derived'; END IF;
  IF NEW.release_id IS NOT NULL OR NEW.profile_revision IS NOT NULL OR NEW.build_event_id IS NOT NULL OR NEW.attribute_choice_id IS NOT NULL OR NEW.equipment_event_id IS NOT NULL THEN RAISE EXCEPTION 'Character snapshot pins are server-derived'; END IF;
  NEW.release_id:=(NEW.inputs->>'releaseId')::uuid;NEW.profile_revision:=(NEW.inputs->>'profileRevision')::integer;
  NEW.build_event_id:=(NEW.inputs->>'buildEventId')::uuid;NEW.attribute_choice_id:=(NEW.inputs->>'attributeChoiceId')::uuid;NEW.equipment_event_id:=(NEW.inputs->>'equipmentEventId')::uuid;
  NEW.created_at:=now();
  RETURN NEW;
END $$;
DO $$
DECLARE definition text;
BEGIN
 SELECT pg_get_viewdef('character_snapshot_integrity_issues'::regclass,true) INTO definition;
 definition:=replace(definition,'character_snapshot_derived_before_inventory','character_snapshot_derived');
 EXECUTE 'CREATE OR REPLACE VIEW character_snapshot_integrity_issues AS '||definition;
END $$;

-- Reconstruct the carried load from immutable quantity and custody evidence,
-- independent of today's quantities, location, or archived owner lifecycle.
CREATE FUNCTION inventory_load_at(target uuid,quantity_mark bigint,movement_mark bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$
 WITH deltas AS (
  SELECT to_item_id item_id,quantity::numeric amount FROM inventory_quantity_operations operation JOIN inventory_quantity_order ordinal ON ordinal.operation_id=operation.id WHERE ordinal.operation_no<=quantity_mark AND to_item_id IS NOT NULL
  UNION ALL SELECT from_item_id,-quantity::numeric FROM inventory_quantity_operations operation JOIN inventory_quantity_order ordinal ON ordinal.operation_id=operation.id WHERE ordinal.operation_no<=quantity_mark AND from_item_id IS NOT NULL
 ), quantities AS (SELECT item_id,sum(amount) quantity FROM deltas GROUP BY item_id HAVING sum(amount)>0),
 locations AS (
  SELECT i.*,q.quantity past_quantity,coalesce(
   (SELECT to_container_id FROM inventory_movements WHERE item_id=i.id AND id<=movement_mark ORDER BY id DESC LIMIT 1),
   (SELECT from_container_id FROM inventory_movements WHERE item_id=i.id ORDER BY id LIMIT 1),i.container_id) past_container
  FROM quantities q JOIN inventory_items i ON i.id=q.item_id
 )
 SELECT jsonb_build_object('weight',coalesce(sum(i.past_quantity*coalesce((v.definition->'mechanics'->'inventory'->>'unitWeight')::numeric,0)),0)::text,
 'bulk',coalesce(sum(i.past_quantity*coalesce((v.definition->'mechanics'->'inventory'->>'unitBulk')::numeric,0)),0)::text,
 'unmeasuredItems',count(*) FILTER(WHERE v.definition->'mechanics'->'inventory'->>'version' IS DISTINCT FROM '2'))
 FROM locations i JOIN inventory_containers c ON c.id=i.past_container AND c.kind='CARRIED'
 JOIN state_scopes scope ON scope.id=c.scope_id AND scope.run_id=target
 JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision
$$;

-- Rebuild the complete capacity vector from immutable build/choice/equipment
-- history. Receipt revisions order choices across transactions without relying
-- on transaction-start timestamps or today's projections.
CREATE FUNCTION inventory_capacity_at(target uuid,pinned_release uuid,build_id uuid,equipment_id uuid,start_action uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 WITH start_receipt AS (SELECT (result->>'revision')::integer revision FROM action_receipts WHERE action_id=start_action),
 owned AS (
  SELECT e.entity_id,e.revision,NULL::text item_id,v.definition->'mechanics'->'inventoryCapacity' spec,(chosen->>'nativeLevel')::integer native_level
  FROM run_build_events build JOIN action_receipts build_receipt ON build_receipt.action_id=build.action_id CROSS JOIN start_receipt
  CROSS JOIN LATERAL jsonb_array_elements(build.after_state->'classes') chosen
  JOIN release_entries e ON e.release_id=pinned_release AND e.entity_id=chosen->>'classId'
  JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision
  WHERE build.id=build_id AND build.run_id=target AND build.release_id=pinned_release AND (build_receipt.result->>'revision')::integer<start_receipt.revision
  UNION ALL
  SELECT e.entity_id,e.revision,NULL::text,v.definition->'mechanics'->'inventoryCapacity',0
  FROM run_feat_choices choice JOIN action_receipts receipt ON receipt.action_id=choice.action_id CROSS JOIN start_receipt
  JOIN release_entries e ON e.release_id=pinned_release AND e.entity_id=choice.feat_id AND e.revision=choice.feat_revision
  JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision
  WHERE choice.run_id=target AND (receipt.result->>'revision')::integer<start_receipt.revision
  UNION ALL
  SELECT e.entity_id,e.revision,NULL::text,v.definition->'mechanics'->'inventoryCapacity',0
  FROM run_subclass_choices choice JOIN action_receipts receipt ON receipt.action_id=choice.action_id CROSS JOIN start_receipt
  JOIN release_entries e ON e.release_id=pinned_release AND e.entity_id=choice.subclass_id AND e.revision=choice.subclass_revision
  JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision
  WHERE choice.run_id=target AND (receipt.result->>'revision')::integer<start_receipt.revision
  UNION ALL
  SELECT DISTINCT e.entity_id,e.revision,item.id::text,v.definition->'mechanics'->'inventoryCapacity',0
  FROM equipment_events equipment JOIN action_receipts equipment_receipt ON equipment_receipt.action_id=equipment.action_id CROSS JOIN start_receipt
  CROSS JOIN LATERAL jsonb_array_elements(equipment.after_state->'slots') slot
  JOIN inventory_items item ON item.id=(slot->>'itemId')::uuid AND item.release_id=pinned_release
  JOIN release_entries e ON e.release_id=pinned_release AND e.entity_id=item.definition_id AND e.revision=item.definition_revision
  JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision
  WHERE equipment.id=equipment_id AND equipment.run_id=target AND (equipment_receipt.result->>'revision')::integer<start_receipt.revision AND (slot->>'set'='WORN' OR slot->>'set'=equipment.after_state->>'activeSet')
 )
 SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',entity_id,'revision',revision,'itemId',item_id,
 'name',(SELECT definition->>'name' FROM content_versions WHERE content_versions.entity_id=owned.entity_id AND content_versions.revision=owned.revision),
 'weight',spec->>'weight','bulk',spec->>'bulk')) ORDER BY entity_id COLLATE "C",item_id),'[]'::jsonb)
 FROM owned WHERE spec IS NOT NULL AND native_level>=(spec->>'minimumNativeLevel')::integer
$$;

DO $$
DECLARE definition text;
BEGIN
 SELECT pg_get_viewdef('character_snapshot_integrity_issues'::regclass,true) INTO definition;
 definition:=regexp_replace(definition,';[[:space:]]*$','');
 EXECUTE 'CREATE OR REPLACE VIEW character_snapshot_integrity_issues AS '||definition||$view$
 UNION
 SELECT snapshot.instance_id FROM character_encounter_snapshots snapshot
 JOIN encounter_records started ON started.instance_id=snapshot.instance_id
 LEFT JOIN release_entries pin ON pin.release_id=snapshot.release_id AND pin.entity_id=snapshot.inputs->'inventory'->>'rulesId'
 LEFT JOIN content_versions rules ON rules.entity_id=pin.entity_id AND rules.revision=pin.revision
 WHERE snapshot.inputs ? 'inventory' AND (
  snapshot.inputs->'inventory'->'rules' IS DISTINCT FROM rules.definition->'mechanics'->'inventoryRules'
  OR (snapshot.inputs->'inventory'->>'rulesRevision')::integer IS DISTINCT FROM pin.revision
  OR snapshot.inputs->'inventory'->'strength' IS DISTINCT FROM snapshot.inputs->'attributes'->'strength'
  OR inventory_load_at(snapshot.run_id,(snapshot.inputs->'inventory'->>'quantityWatermark')::bigint,(snapshot.inputs->'inventory'->>'movementWatermark')::bigint)
    IS DISTINCT FROM jsonb_build_object('weight',snapshot.inputs->'inventory'->>'weight','bulk',snapshot.inputs->'inventory'->>'bulk','unmeasuredItems',snapshot.inputs->'inventory'->'unmeasuredItems')
  OR snapshot.inputs->'inventory'->'sources' IS DISTINCT FROM inventory_capacity_at(snapshot.run_id,snapshot.release_id,snapshot.build_event_id,snapshot.equipment_event_id,started.start_action_id)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot.inputs->'inventory'->'sources') source
   LEFT JOIN release_entries source_pin ON source_pin.release_id=snapshot.release_id AND source_pin.entity_id=source->>'id' AND source_pin.revision=(source->>'revision')::integer
   LEFT JOIN content_versions source_definition ON source_definition.entity_id=source_pin.entity_id AND source_definition.revision=source_pin.revision
   WHERE source_definition.definition->'mechanics'->'inventoryCapacity'->>'weight' IS DISTINCT FROM source->>'weight'
    OR source_definition.definition->'mechanics'->'inventoryCapacity'->>'bulk' IS DISTINCT FROM source->>'bulk')
 )
 $view$;
END $$;

CREATE FUNCTION guard_inventory_personal_storage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE destination_kind text; destination_run uuid; origin_run uuid; category text;
BEGIN
 SELECT c.kind,s.run_id INTO destination_kind,destination_run FROM inventory_containers c JOIN state_scopes s ON s.id=c.scope_id WHERE c.id=NEW.container_id;
 IF destination_kind='MATERIAL_VAULT' THEN
  SELECT coalesce(v.definition->'mechanics'->'inventory'->>'category',v.definition->'mechanics'->>'inventoryCategory') INTO category FROM content_versions v WHERE v.entity_id=NEW.definition_id AND v.revision=NEW.definition_revision;
  IF category IS DISTINCT FROM 'MATERIAL' THEN RAISE EXCEPTION 'Material Vault accepts materials only'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND NEW.container_id<>OLD.container_id THEN
  SELECT s.run_id INTO origin_run FROM inventory_containers c JOIN state_scopes s ON s.id=c.scope_id WHERE c.id=OLD.container_id;
  IF EXISTS(SELECT 1 FROM instance_participants p JOIN instances i ON i.id=p.instance_id WHERE p.run_id IN(origin_run,destination_run) AND i.lifecycle='ACTIVE')
  THEN RAISE EXCEPTION 'Inventory storage changes require leaving the active instance'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_personal_storage BEFORE INSERT OR UPDATE OF container_id ON inventory_items FOR EACH ROW EXECUTE FUNCTION guard_inventory_personal_storage();
