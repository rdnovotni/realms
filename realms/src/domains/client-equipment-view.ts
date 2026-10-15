import type pg from 'pg';

/** Owned preparation contracts only; no raw definitions or combat modifiers. */
export async function clientEquipmentView(client:pg.PoolClient,runId:string,accountId:string) {
 const equipment=(await client.query('SELECT equipment_snapshot($1) AS state',[runId])).rows[0].state;
 const gear=(await client.query(`WITH quick AS MATERIALIZED (
  SELECT sample.id FROM inventory_items sample JOIN inventory_containers bucket ON bucket.id=sample.container_id JOIN state_scopes scope ON scope.id=bucket.scope_id JOIN content_versions definition ON definition.entity_id=sample.definition_id AND definition.revision=sample.definition_revision
  WHERE scope.run_id=$1 AND scope.lifecycle='ACTIVE' AND bucket.kind='CARRIED' AND sample.quantity>0 AND definition.definition->'mechanics'->'equipment' IS NOT NULL ORDER BY sample.created_at DESC,sample.id LIMIT 100
 ), referenced AS MATERIALIZED (
  SELECT item_id FROM equipment_slots WHERE run_id=$1 UNION SELECT refs.item_id FROM equipment_loadout_items refs JOIN equipment_loadouts saved ON saved.id=refs.loadout_id JOIN runs owner_run ON owner_run.character_id=saved.character_id WHERE owner_run.id=$1
 ) SELECT i.id,v.definition->>'name' AS name,i.binding,v.definition->'public'->>'itemArt' AS artwork,v.definition->'public'->>'itemIcon' AS icon,
 equipment_eligible_slots(v.definition->'mechanics'->'equipment') AS slots,
 v.definition->'mechanics'->'inventory'->>'unitWeight' AS "unitWeight",
 v.definition->'mechanics'->'inventory'->>'unitBulk' AS "unitBulk",
 CASE WHEN EXISTS(SELECT 1 FROM discoveries known WHERE known.account_id=$2 AND known.entity_id=i.definition_id AND known.knowledge_level='ADVANCED') THEN (SELECT jsonb_object_agg(stat,amount) FROM (SELECT m->>'stat' stat,sum((m->>'amount')::integer) amount FROM jsonb_array_elements(v.definition->'mechanics'->'combatModifiers'->'modifiers') m GROUP BY m->>'stat') stat_values) END AS "knownStats",
 (v.definition->'mechanics'->'equipment'->>'hands')::integer AS hands,
 (v.definition->'mechanics'->'equipment'->>'minimumLevel')::integer AS "minimumLevel",
 v.definition->'mechanics'->'equipment'->>'bindingPolicy' AS "bindingPolicy",
 i.quantity='1' AND i.storage_mode='INSTANCE' AND i.release_id=r.content_release_id AND i.binding<>'SYSTEM_UNTRADEABLE' AS eligible,
 proficiency_requirements_met(r.id,v.definition->'mechanics'->'proficiencyRequirements') AS "proficiencyMet",
 coalesce(l.locked,false) AS "manualLocked",
 ARRAY(SELECT t.template_key FROM equipment_loadout_items p JOIN equipment_loadouts t ON t.id=p.loadout_id WHERE p.item_id=i.id ORDER BY t.template_key) AS "protectedLoadouts",
 coalesce((SELECT w.after_condition FROM tactical_equipment_wear w WHERE w.item_id=i.id ORDER BY w.id DESC LIMIT 1),(v.definition->'mechanics'->'tacticalDurability'->>'maximum')::integer) AS condition,
 (v.definition->'mechanics'->'tacticalDurability'->>'maximum')::integer AS "maximumCondition"
 FROM runs r JOIN state_scopes s ON s.run_id=r.id AND s.lifecycle='ACTIVE'
 JOIN inventory_containers b ON b.scope_id=s.id AND b.kind='CARRIED'
 JOIN inventory_items i ON i.container_id=b.id AND i.quantity>0
 JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision
 LEFT JOIN inventory_item_locks l ON l.item_id=i.id
 WHERE r.id=$1 AND v.definition->'mechanics'->'equipment' IS NOT NULL
 AND (i.id IN(SELECT id FROM quick) OR i.id IN(SELECT item_id FROM referenced))
 ORDER BY EXISTS(SELECT 1 FROM equipment_slots used WHERE used.item_id=i.id) DESC,i.created_at,i.id`,[runId,accountId])).rows;
 const loadouts=(await client.query(`SELECT l.template_key AS key,l.state->>'name' AS name,l.state->'plan' AS plan,(l.state->>'protectItems')::boolean AS "protectItems" FROM equipment_loadouts l JOIN characters c ON c.id=l.character_id WHERE c.account_id=$1 AND l.state IS NOT NULL ORDER BY l.template_key`,[accountId])).rows;
 return {equipment,gear,loadouts};
}
