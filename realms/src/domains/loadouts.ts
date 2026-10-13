import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { executeAction,advanceRevision,type ActionContext,type Envelope } from '../foundation/action.js';
import { checksum } from '../foundation/json.js';
import { DomainError } from '../foundation/errors.js';
import { applyEquipment,type EquipmentPlan } from './equipment.js';
type SavedState={name:string;plan:EquipmentPlan;protectItems:boolean};
function key(value:string){if(typeof value!=='string'||!/^[a-z][a-z0-9_-]{0,39}$/.test(value))throw new DomainError(400,'INVALID_LOADOUT_KEY');return value;}
function explicit(envelope:Envelope,type:string){if(envelope.actionType!==type)throw new DomainError(400,'INVALID_LOADOUT_ACTION');if(!['MANUAL_UI','API'].includes(envelope.authorizationSource??'MANUAL_UI'))throw new DomainError(403,'EXPLICIT_LOADOUT_ACTION_REQUIRED');}
async function prior(c:ActionContext,templateKey:string){return (await c.client.query('SELECT * FROM equipment_loadouts WHERE character_id=$1 AND template_key=$2 FOR UPDATE',[c.run.character_id,templateKey])).rows[0] as {id:string;state:SavedState|null;revision:string}|undefined;}
async function record(c:ActionContext,templateKey:string,after:SavedState|null,reason:string,source:string|null=null){
 const before=await prior(c,templateKey);if(checksum(before?.state??null)===checksum(after))return {changed:false,loadoutRevision:String(before?.revision??'0'),revision:c.run.revision};
 if(reason==='SAVE_LOADOUT'&&!before?.state&&(await c.client.query('SELECT count(*)::int AS n FROM equipment_loadouts WHERE character_id=$1 AND state IS NOT NULL',[c.run.character_id])).rows[0].n>=32)throw new DomainError(409,'LOADOUT_LIMIT_REACHED');
 const revision=BigInt(before?.revision??'0');if(revision>=9223372036854775807n)throw new DomainError(409,'LOADOUT_REVISION_EXHAUSTED');
 await c.client.query('INSERT INTO equipment_loadout_events(loadout_id,character_id,template_key,run_id,action_id,revision,before_state,after_state,reason,equipment_event_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[before?.id??randomUUID(),c.run.character_id,templateKey,c.run.id,c.actionId,(revision+1n).toString(),before?.state??null,after,reason,source]);
 return {changed:true,loadoutRevision:(revision+1n).toString(),revision:await advanceRevision(c)};
}
export function saveLoadout(pool:pg.Pool,accountId:string,envelope:Envelope,templateKey:string,name:string){
 explicit(envelope,'SAVE_LOADOUT');key(templateKey);if(typeof name!=='string'||!name.trim()||name.trim().length>80||/[\u0000-\u001f\u007f]/.test(name))throw new DomainError(400,'INVALID_LOADOUT_NAME');const label=name.trim();
 return executeAction(pool,accountId,envelope,{key:templateKey,name:label},async c=>{
 const current=(await c.client.query('SELECT equipment_snapshot($1) AS plan,(SELECT last_event_id FROM run_equipment WHERE run_id=$1) AS source',[c.run.id])).rows[0];
 return {key:templateKey,...await record(c,templateKey,{name:label,plan:current.plan,protectItems:true},'SAVE_LOADOUT',current.source)};
 });
}
export function setLoadoutProtection(pool:pg.Pool,accountId:string,envelope:Envelope,templateKey:string,protectedItems:boolean){
 explicit(envelope,'SET_LOADOUT_PROTECTION');key(templateKey);if(typeof protectedItems!=='boolean')throw new DomainError(400,'INVALID_LOADOUT_PROTECTION');
 return executeAction(pool,accountId,envelope,{key:templateKey,protectItems:protectedItems},async c=>{const before=await prior(c,templateKey);if(!before?.state)throw new DomainError(404,'LOADOUT_NOT_FOUND');return {key:templateKey,protectItems:protectedItems,...await record(c,templateKey,{...before.state,protectItems:protectedItems},'SET_LOADOUT_PROTECTION')};});
}
export function deleteLoadout(pool:pg.Pool,accountId:string,envelope:Envelope,templateKey:string){
 explicit(envelope,'DELETE_LOADOUT');key(templateKey);return executeAction(pool,accountId,envelope,{key:templateKey},async c=>{if(!await prior(c,templateKey))throw new DomainError(404,'LOADOUT_NOT_FOUND');return {key:templateKey,...await record(c,templateKey,null,'DELETE_LOADOUT')};});
}
export function applyLoadout(pool:pg.Pool,accountId:string,envelope:Envelope,templateKey:string){
 if(envelope.actionType!=='SET_EQUIPMENT')throw new DomainError(400,'INVALID_EQUIPMENT_ACTION');key(templateKey);
 // Hash the intent key, not the mutable saved state. Receipt replay must return
 // the original setup even after this template is renamed, replaced or deleted.
 return executeAction(pool,accountId,envelope,{loadoutKey:templateKey},async c=>{const saved=await prior(c,templateKey);if(!saved?.state)throw new DomainError(404,'LOADOUT_NOT_FOUND');return {loadoutKey:templateKey,loadoutRevision:String(saved.revision),...await applyEquipment(c,saved.state.plan)};});
}
export async function loadoutsView(pool:pg.Pool,accountId:string){return {loadouts:(await pool.query(`SELECT l.template_key AS key,l.revision::text AS revision,l.state->>'name' AS name,l.state->'plan' AS plan,(l.state->>'protectItems')::boolean AS "protectItems" FROM equipment_loadouts l JOIN characters c ON c.id=l.character_id WHERE c.account_id=$1 AND l.state IS NOT NULL ORDER BY l.template_key`,[accountId])).rows};}
export async function itemProtectionView(pool:pg.Pool,accountId:string,itemId:string){
 const row=(await pool.query(`SELECT i.id AS "itemId",coalesce(locks.locked,false) AS "manualLocked",EXISTS(SELECT 1 FROM equipment_slots WHERE item_id=i.id) AS equipped,
 ARRAY(SELECT l.template_key FROM equipment_loadout_items refs JOIN equipment_loadouts l ON l.id=refs.loadout_id WHERE refs.item_id=i.id ORDER BY l.template_key) AS "protectedLoadouts"
 FROM inventory_items i JOIN inventory_containers b ON b.id=i.container_id JOIN state_scopes s ON s.id=b.scope_id
 LEFT JOIN runs r ON r.id=s.run_id LEFT JOIN characters c ON c.id=r.character_id LEFT JOIN inventory_item_locks locks ON locks.item_id=i.id
 WHERE i.id=$1 AND i.quantity>0 AND s.lifecycle='ACTIVE' AND b.kind IN('CARRIED','MATERIAL_VAULT','HOME','LEGACY') AND (s.account_id=$2 OR c.account_id=$2)`,[itemId,accountId])).rows[0];
 if(!row)throw new DomainError(404,'ITEM_NOT_FOUND');return {...row,protected:row.manualLocked||row.equipped||row.protectedLoadouts.length>0};
}
