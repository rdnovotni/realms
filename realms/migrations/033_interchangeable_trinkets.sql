-- Broaden the three existing accessory identities without rewriting immutable history.
-- RING_1, RING_2 and TRINKET are displayed as Trinket 1, 2 and 3.
CREATE FUNCTION equipment_eligible_slots(spec jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT CASE WHEN (spec->'slots') ?| ARRAY['RING_1','RING_2','TRINKET']
 THEN coalesce((SELECT jsonb_agg(value) FROM jsonb_array_elements(spec->'slots') WHERE value #>> '{}' NOT IN('RING_1','RING_2','TRINKET')),'[]'::jsonb) || '["RING_1","RING_2","TRINKET"]'::jsonb
 ELSE spec->'slots' END;
$$;
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
    OR a.action_type IS DISTINCT FROM CASE WHEN chain.reason='PLAYER_SETUP' THEN 'SET_EQUIPMENT' ELSE 'ASCEND' END
    OR (chain.reason='ASCENSION_CLEAR' AND NOT EXISTS(SELECT 1 FROM run_history h WHERE h.run_id=r.id AND h.action_id=chain.action_id))
    OR NOT EXISTS(SELECT 1 FROM run_equipment p WHERE p.run_id=r.id)));
