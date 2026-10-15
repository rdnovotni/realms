import { equipmentSlots } from './equipment-content.js';
import { runFacts } from '../rules/facts.js';
import { prerequisite,type Prerequisite } from '../rules/prerequisites.js';
import type pg from 'pg';
import { transaction } from '../foundation/transaction.js';
import { executeAction,advanceRevision,requireActive,type Envelope,type ActionContext } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
import { carryLoad,publicCarryLoad } from './inventory-load.js';
import { writeState } from './state.js';

export type InventoryQuery={equipmentSlot?:string;slot?:string;equipmentState?:'ALL'|'EQUIPPED'|'UNEQUIPPED'|'USABLE';condition?:'ALL'|'NEEDS_REPAIR'|'BROKEN'|'FULL';container?:string;search?:string;category?:string;rarity?:string;binding?:string;protection?:'ALL'|'PROTECTED'|'UNPROTECTED';sort?:'NAME'|'NEWEST'|'QUANTITY'|'WEIGHT'|'BULK'|'QUALITY';direction?:'ASC'|'DESC';grouped?:boolean;definitionId?:string;offset?:number;expectedRevision?:number};
export const inventoryPageSize=48;
const sorts={NAME:'name COLLATE "C"',NEWEST:'created_at',QUANTITY:'quantity::numeric',WEIGHT:'"totalWeight"::numeric',BULK:'"totalBulk"::numeric',QUALITY:'"numericQuality"::numeric'};
export async function requireInventoryIdle(c:ActionContext) {
 requireActive(c);
 if((await c.client.query("SELECT 1 FROM instance_participants p JOIN instances i ON i.id=p.instance_id WHERE p.run_id=$1 AND i.lifecycle='ACTIVE' LIMIT 1",[c.run.id])).rowCount)throw new DomainError(409,'INSTANCE_STILL_ACTIVE');
}
export async function inventoryPreferences(client:pg.PoolClient,accountId:string) {
 if(!(await client.query("SELECT to_regclass('scoped_state') present")).rows[0].present)return {value:{autoStoreMaterials:false,autoOverflow:false},revision:null};
 const row=(await client.query("SELECT value,revision::text FROM scoped_state f JOIN state_scopes s ON s.id=f.scope_id WHERE s.account_id=$1 AND f.key='inventory.preferences.v1'",[accountId])).rows[0];
 return {value:row?.value??{autoStoreMaterials:false,autoOverflow:false},revision:row?.revision??null};
}
export function setInventoryPreferences(pool:pg.Pool,accountId:string,envelope:Envelope,preferences:{autoStoreMaterials:boolean;autoOverflow:boolean}) {
 if(envelope.actionType!=='SET_INVENTORY_PREFERENCES'||!preferences||Object.keys(preferences).sort().join(',')!=='autoOverflow,autoStoreMaterials'||typeof preferences.autoOverflow!=='boolean'||typeof preferences.autoStoreMaterials!=='boolean')throw new DomainError(400,'INVALID_INVENTORY_PREFERENCES');
 return executeAction(pool,accountId,envelope,{preferences},async c=>{
  requireActive(c);const scope=(await c.client.query("SELECT id FROM state_scopes WHERE account_id=$1 AND kind='ACCOUNT'",[accountId])).rows[0];
  const prior=await inventoryPreferences(c.client,accountId);
  await writeState(c.client,'inventory',scope.id,'inventory.preferences.v1',preferences,prior.revision);
  return {preferences,revision:await advanceRevision(c)};
 });
}
export async function personalStorage(c:ActionContext,kind:'CARRIED'|'HOME'|'MATERIAL_VAULT') {
 // New-life storage is run-scoped. Previous-life account storage retains its
 // existing Casual access rule; selecting a tab can never bypass that rule.
 const scope=(await c.client.query("SELECT id FROM state_scopes WHERE run_id=$1 AND lifecycle='ACTIVE'",[c.run.id])).rows[0];
 if(!scope)throw new DomainError(409,'INVALID_STATE_SCOPE');
 return (await c.client.query("INSERT INTO inventory_containers(scope_id,kind) VALUES($1,$2) ON CONFLICT(scope_id,kind,label) DO UPDATE SET label=EXCLUDED.label RETURNING id",[scope.id,kind])).rows[0].id as string;
}
export function inventoryView(pool:pg.Pool,accountId:string,q:InventoryQuery={}) {
 if((q.equipmentState&&!['ALL','EQUIPPED','UNEQUIPPED','USABLE'].includes(q.equipmentState))||(q.condition&&!['ALL','NEEDS_REPAIR','BROKEN','FULL'].includes(q.condition))||(q.slot&&q.slot!=='ALL'&&!equipmentSlots.includes(q.slot as typeof equipmentSlots[number]))||q.equipmentSlot&&!equipmentSlots.includes(q.equipmentSlot as typeof equipmentSlots[number]))throw new DomainError(400,'INVALID_INVENTORY_QUERY');
 if(!Object.hasOwn(sorts,q.sort??'NAME')||!['ASC','DESC'].includes(q.direction??'ASC')||!Number.isSafeInteger(q.offset??0)||(q.offset??0)<0||(q.offset??0)>1000000||(q.search??'').length>80)throw new DomainError(400,'INVALID_INVENTORY_QUERY');
 return transaction(pool,async client=>{
  await client.query('SELECT id FROM accounts WHERE id=$1 FOR SHARE',[accountId]);
  const run=(await client.query("SELECT r.* FROM runs r JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE') FOR SHARE OF r",[accountId])).rows[0];
  if(!run)throw new DomainError(404,'NO_ACTIVE_RUN');
  if(q.expectedRevision!==undefined&&q.expectedRevision!==run.revision)throw new DomainError(409,'STALE_REVISION');
  const containers=(await client.query(`SELECT c.id,c.kind,c.label,s.lifecycle,
   (s.lifecycle='ACTIVE' AND (s.run_id=$2 OR (s.account_id=$1 AND $3='CASUAL'))) AS accessible,
   (s.run_id IS NOT NULL AND s.run_id<>$2) AS archived,
   (SELECT count(*)::integer FROM inventory_items i WHERE i.container_id=c.id AND i.quantity>0) AS count
   FROM inventory_containers c JOIN state_scopes s ON s.id=c.scope_id
   WHERE c.kind IN('CARRIED','HOME','MATERIAL_VAULT','LEGACY') AND
   (s.account_id=$1 OR EXISTS(SELECT 1 FROM runs owned JOIN characters ch ON ch.id=owned.character_id WHERE owned.id=s.run_id AND ch.account_id=$1))
   ORDER BY CASE WHEN s.run_id=$2 THEN 0 WHEN s.account_id=$1 THEN 1 ELSE 2 END,c.kind,c.id LIMIT 201`,[accountId,run.id,run.mode])).rows;
  if(q.container&&q.container!=='ALL'&&!containers.some(c=>c.id===q.container))throw new DomainError(403,'CONTAINER_NOT_OWNED');
  const parameters:unknown[]=[accountId,run.id,run.mode];
  const terms:string[]=[];
  function bind(value:unknown){parameters.push(value);return '$'+parameters.length;}
  if(q.container&&q.container!=='ALL')terms.push(`"containerId"=${bind(q.container)}::uuid`);
  else if(!q.container)terms.push("kind='CARRIED' AND \"runId\"=$2");
  if(q.search)terms.push(`name ILIKE ${bind('%'+q.search.replace(/[\\%_]/g,'\\$&')+'%')} ESCAPE '\\'`);
  for(const [field,value] of [['category',q.category],['rarity',q.rarity],['binding',q.binding],['definitionId',q.definitionId]] as const)if(value&&value!=='ALL')terms.push(`"${field}"=${bind(value)}`);
  if(q.protection&&q.protection!=='ALL')terms.push(`protected=${q.protection==='PROTECTED'?'true':'false'}`);
  if(q.slot&&q.slot!=='ALL')terms.push(`(equipment->'slots') ? ${bind(q.slot)}`);
  if(q.equipmentState==='EQUIPPED')terms.push('equipped');
  if(q.equipmentState==='UNEQUIPPED')terms.push('equipment IS NOT NULL AND NOT equipped');
  if(q.condition==='NEEDS_REPAIR')terms.push('"maximumCondition" IS NOT NULL AND condition < "maximumCondition"');
  if(q.condition==='BROKEN')terms.push('"maximumCondition" IS NOT NULL AND condition=0');
  if(q.condition==='FULL')terms.push('"maximumCondition" IS NOT NULL AND condition="maximumCondition"');
  if(q.equipmentSlot||q.equipmentState==='USABLE'){
   terms.push(`kind='CARRIED' AND "runId"=$2 AND accessible AND eligible AND "proficiencyMet" AND quantity='1' AND "storageMode"='INSTANCE' AND equipment IS NOT NULL AND (equipment->>'minimumLevel')::integer <= (SELECT level FROM run_progression WHERE run_id=$2)`);
   if(q.equipmentSlot)terms.push(`(equipment->'slots') ? ${bind(q.equipmentSlot)}`);
   const expressions=(await client.query("SELECT e.entity_id,v.definition->'mechanics'->'prerequisite' expr FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=$1 AND v.definition->'mechanics'->'prerequisite' IS NOT NULL",[run.content_release_id])).rows;
   if(expressions.length){const facts=await runFacts({client,run,accountId}),denied=expressions.filter(e=>!prerequisite(e.expr as Prerequisite,facts).met).map(e=>e.entity_id);if(denied.length)terms.push(`"definitionId" <> ALL(${bind(denied)}::text[])`);}
  }
  const cte=`WITH owned AS (
   SELECT i.id,i.definition_id AS "definitionId",i.container_id AS "containerId",c.kind,s.run_id AS "runId",v.definition->>'name' AS name,v.definition->'public'->>'itemArt' AS artwork,v.definition->'public'->>'itemIcon' AS icon,i.quantity::text,i.binding,i.created_at,
   coalesce(v.definition->'mechanics'->'inventory'->>'category',v.definition->'mechanics'->>'inventoryCategory','OTHER') AS category,
   coalesce(v.definition->'public'->>'rarity','UNKNOWN') AS rarity,
   coalesce(v.definition->'public'->>'description','') AS description,
   coalesce(v.definition->'public'->>'family','') AS family,
   coalesce(v.definition->'public'->>'qualityLabel','Unassessed') AS "qualityLabel",
   CASE WHEN d.knowledge_level='ADVANCED' THEN i.quality::text END AS "numericQuality",
   CASE WHEN v.definition->'mechanics'->'inventory'->>'version'='2' THEN v.definition->'mechanics'->'inventory'->>'unitWeight' END AS "unitWeight",
   CASE WHEN v.definition->'mechanics'->'inventory'->>'version'='2' THEN v.definition->'mechanics'->'inventory'->>'unitBulk' END AS "unitBulk",
   CASE WHEN v.definition->'mechanics'->'inventory'->>'version'='2' THEN (i.quantity::numeric*(v.definition->'mechanics'->'inventory'->>'unitWeight')::numeric)::text END AS "totalWeight",
   CASE WHEN v.definition->'mechanics'->'inventory'->>'version'='2' THEN (i.quantity::numeric*(v.definition->'mechanics'->'inventory'->>'unitBulk')::numeric)::text END AS "totalBulk",
   jsonb_set(v.definition->'mechanics'->'equipment','{slots}',equipment_eligible_slots(v.definition->'mechanics'->'equipment')) AS equipment,
   (i.release_id=(SELECT content_release_id FROM runs WHERE id=$2) AND i.binding<>'SYSTEM_UNTRADEABLE' AND s.run_id=$2 AND s.lifecycle='ACTIVE') AS eligible,
   proficiency_requirements_met($2,v.definition->'mechanics'->'proficiencyRequirements') AS "proficiencyMet",
   CASE WHEN d.knowledge_level='ADVANCED' THEN (SELECT jsonb_object_agg(stat,amount) FROM (SELECT m->>'stat' stat,sum((m->>'amount')::integer) amount FROM jsonb_array_elements(v.definition->'mechanics'->'combatModifiers'->'modifiers') m GROUP BY m->>'stat') stat_values) END AS "knownStats",
   i.storage_mode AS "storageMode",coalesce(l.locked,false) AS locked,
   EXISTS(SELECT 1 FROM equipment_slots slot WHERE slot.item_id=i.id) AS equipped,
   ARRAY(SELECT t.template_key FROM equipment_loadout_items p JOIN equipment_loadouts t ON t.id=p.loadout_id WHERE p.item_id=i.id ORDER BY t.template_key) AS loadouts,
   (coalesce(l.locked,false) OR EXISTS(SELECT 1 FROM equipment_slots slot WHERE slot.item_id=i.id) OR EXISTS(SELECT 1 FROM equipment_loadout_items p WHERE p.item_id=i.id)) AS protected,
   (s.lifecycle='ACTIVE' AND (s.run_id=$2 OR (s.account_id=$1 AND $3='CASUAL'))) AS accessible,
   coalesce((SELECT w.after_condition FROM tactical_equipment_wear w WHERE w.item_id=i.id ORDER BY w.id DESC LIMIT 1),(v.definition->'mechanics'->'tacticalDurability'->>'maximum')::integer) AS condition,
   (v.definition->'mechanics'->'tacticalDurability'->>'maximum')::integer AS "maximumCondition"
   FROM inventory_items i JOIN inventory_containers c ON c.id=i.container_id JOIN state_scopes s ON s.id=c.scope_id
   JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision
   LEFT JOIN inventory_item_locks l ON l.item_id=i.id LEFT JOIN discoveries d ON d.account_id=$1 AND d.entity_id=i.definition_id
   WHERE i.quantity>0 AND c.kind IN('CARRIED','HOME','MATERIAL_VAULT','LEGACY') AND
    (s.account_id=$1 OR EXISTS(SELECT 1 FROM runs owned JOIN characters ch ON ch.id=owned.character_id WHERE owned.id=s.run_id AND ch.account_id=$1))
  ),filtered AS (SELECT * FROM owned WHERE ${terms.join(' AND ')||'true'}),numbered AS (
   SELECT *,count(*) OVER(PARTITION BY "definitionId") AS copies,
   (min("containerId"::text) OVER(PARTITION BY "definitionId")<>max("containerId"::text) OVER(PARTITION BY "definitionId")) AS "multipleLocations",
   (sum(quantity::numeric) OVER(PARTITION BY "definitionId"))::text AS "groupQuantity",
   CASE WHEN count("totalWeight") OVER(PARTITION BY "definitionId")=count(*) OVER(PARTITION BY "definitionId") THEN (sum("totalWeight"::numeric) OVER(PARTITION BY "definitionId"))::text END AS "groupWeight",
   CASE WHEN count("totalBulk") OVER(PARTITION BY "definitionId")=count(*) OVER(PARTITION BY "definitionId") THEN (sum("totalBulk"::numeric) OVER(PARTITION BY "definitionId"))::text END AS "groupBulk",
   max(created_at) OVER(PARTITION BY "definitionId") AS "groupNewest",
   row_number() OVER(PARTITION BY "definitionId" ORDER BY name COLLATE "C",id) AS representative FROM filtered
  ),selected AS (SELECT * FROM numbered ${q.grouped&&!q.equipmentSlot?'WHERE representative=1':''})`;
  const sortExpression=q.grouped&&q.sort==='NEWEST'?'"groupNewest"':q.grouped&&q.sort==='QUANTITY'?'"groupQuantity"::numeric':q.grouped&&q.sort==='WEIGHT'?'"groupWeight"::numeric':q.grouped&&q.sort==='BULK'?'"groupBulk"::numeric':sorts[q.sort??'NAME'];
  const total=Number((await client.query(cte+' SELECT count(*)::integer AS total FROM selected',parameters)).rows[0].total);
  const items=(await client.query(cte+` SELECT * FROM selected ORDER BY ${sortExpression} ${q.direction??'ASC'} NULLS LAST,id LIMIT ${inventoryPageSize} OFFSET ${q.offset??0}`,parameters)).rows.map(({representative,created_at,groupNewest,runId,...item})=>({...item,copies:Number(item.copies)}));
  const preferences=await inventoryPreferences(client,accountId);
  return {revision:run.revision,runId:run.id,items,total,offset:q.offset??0,pageSize:inventoryPageSize,containers:containers.slice(0,200),hasMoreContainers:containers.length>200,carry:publicCarryLoad(await carryLoad(client,run.id)),preferences:preferences.value};
 });
}

/** Optional routing changes initial custody, never reward quantity or provenance. */
export async function autoStorageDestination(c:ActionContext,requested:{id:string;kind:string},definitionId:string,spec:{version:number;category:string;unitWeight?:number;unitBulk?:number;mundane?:boolean},amount:bigint,binding:string) {
 if(requested.kind!=='CARRIED'||binding==='SYSTEM_UNTRADEABLE')return requested.id;
 const preferences=(await inventoryPreferences(c.client,c.accountId)).value;
 if(!preferences.autoStoreMaterials&&!preferences.autoOverflow)return requested.id;
 const material=spec.category==='MATERIAL';
 if(material&&preferences.autoStoreMaterials)return personalStorage(c,'MATERIAL_VAULT');
 if(!preferences.autoOverflow||spec.version!==2||(!material&&!spec.mundane))return requested.id;
 const load=await carryLoad(c.client,c.run.id);
 if(!load.enabled||!load.rules||load.weightCapacity===null||load.bulkCapacity===null||load.unmeasuredItems)return requested.id;
 const overflow=(BigInt(load.weight)+amount*BigInt(spec.unitWeight!))*10000n>BigInt(load.weightCapacity)*BigInt(load.rules.comfortableBps)||
  (BigInt(load.bulk)+amount*BigInt(spec.unitBulk!))*10000n>BigInt(load.bulkCapacity)*BigInt(load.rules.comfortableBps);
 return overflow?personalStorage(c,material?'MATERIAL_VAULT':'HOME'):requested.id;
}

export function inventoryHistory(pool:pg.Pool,accountId:string,itemId:string,offset=0,expectedRevision?:number) {
 if(!/^[0-9a-f-]{36}$/i.test(itemId)||!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw new DomainError(400,'INVALID_INVENTORY_QUERY');
 return transaction(pool,async client=>{
  await client.query('SELECT id FROM accounts WHERE id=$1 FOR SHARE',[accountId]);
  const run=(await client.query("SELECT r.id,r.revision FROM runs r JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE') FOR SHARE OF r",[accountId])).rows[0];
  if(!run)throw new DomainError(404,'NO_ACTIVE_RUN');if(expectedRevision!==undefined&&run.revision!==expectedRevision)throw new DomainError(409,'STALE_REVISION');
  const owned=(await client.query(`SELECT i.id FROM inventory_items i JOIN inventory_containers c ON c.id=i.container_id JOIN state_scopes s ON s.id=c.scope_id
   WHERE i.id=$1 AND c.kind IN('CARRIED','HOME','MATERIAL_VAULT','LEGACY') AND (s.account_id=$2 OR EXISTS(SELECT 1 FROM runs r JOIN characters ch ON ch.id=r.character_id WHERE r.id=s.run_id AND ch.account_id=$2))`,[itemId,accountId])).rowCount;
  if(!owned)throw new DomainError(404,'ITEM_NOT_FOUND');
  const cte=`WITH events AS (
   SELECT 'quantity:'||o.operation_no::text id,q.kind||CASE WHEN q.from_item_id=$1 THEN '_OUT' WHEN q.kind IN('SPLIT','MERGE') THEN '_IN' ELSE '' END kind,q.quantity::text quantity,q.created_at at,NULL::text location
    FROM inventory_quantity_operations q JOIN inventory_quantity_order o ON o.operation_id=q.id WHERE q.from_item_id=$1 OR q.to_item_id=$1
   UNION ALL SELECT 'move:'||m.id::text,'MOVE',NULL,m.created_at,c.kind FROM inventory_movements m JOIN inventory_containers c ON c.id=m.to_container_id WHERE m.item_id=$1
   UNION ALL SELECT 'lock:'||l.id::text,CASE WHEN l.locked THEN 'LOCK' ELSE 'UNLOCK' END,NULL,l.created_at,NULL FROM inventory_lock_events l WHERE l.item_id=$1
  )`;
  const total=Number((await client.query(cte+' SELECT count(*)::integer total FROM events',[itemId])).rows[0].total);
  const events=(await client.query(cte+' SELECT kind,quantity,at,location FROM events ORDER BY at DESC,id COLLATE "C" DESC LIMIT 20 OFFSET $2',[itemId,offset])).rows;
  return {itemId,runId:run.id,revision:run.revision,events,total,offset,pageSize:20};
 });
}
