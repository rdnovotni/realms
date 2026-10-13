import type pg from 'pg';

/** Owned preparation contracts only; no raw definitions or combat modifiers. */
export async function clientEquipmentView(client:pg.PoolClient,runId:string,accountId:string) {
 const equipment=(await client.query('SELECT equipment_snapshot($1) AS state',[runId])).rows[0].state;
 const gear=(await client.query(`SELECT i.id,v.definition->>'name' AS name,i.binding,
 v.definition->'mechanics'->'equipment'->'slots' AS slots,
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
 ORDER BY i.created_at,i.id LIMIT 101`,[runId])).rows;
 const loadouts=(await client.query(`SELECT l.template_key AS key,l.state->>'name' AS name,l.state->'plan' AS plan,(l.state->>'protectItems')::boolean AS "protectItems" FROM equipment_loadouts l JOIN characters c ON c.id=l.character_id WHERE c.account_id=$1 AND l.state IS NOT NULL ORDER BY l.template_key`,[accountId])).rows;
 return {equipment,gear:gear.slice(0,100),hasMoreGear:gear.length>100,loadouts};
}
