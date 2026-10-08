import type pg from 'pg';
import { executeAction,advanceRevision,type ActionContext,type Envelope } from '../foundation/action.js';
import { checksum } from '../foundation/json.js';
import { DomainError } from '../foundation/errors.js';
import { equipmentSlots,wornSlots,equipmentSpec,type EquipmentSlot } from './equipment-content.js';
export type EquipmentAssignment={set:'WORN'|'A'|'B';slot:EquipmentSlot;itemId:string};
export type EquipmentPlan={activeSet:'A'|'B';slots:EquipmentAssignment[]};
export const emptyEquipment=():EquipmentPlan=>({activeSet:'A',slots:[]});
function normalize(input:EquipmentPlan):EquipmentPlan{
 if(!input||!['A','B'].includes(input.activeSet)||!Array.isArray(input.slots)||input.slots.length>16)throw new DomainError(400,'INVALID_EQUIPMENT_PLAN');
 const slots=input.slots.map(s=>{if(!s||!['WORN','A','B'].includes(s.set)||!equipmentSlots.includes(s.slot)||typeof s.itemId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.itemId)||Object.keys(s).some(k=>!['set','slot','itemId'].includes(k)))throw new DomainError(400,'INVALID_EQUIPMENT_PLAN');
 if((s.set==='WORN')!==wornSlots.includes(s.slot as typeof wornSlots[number]))throw new DomainError(400,'INVALID_EQUIPMENT_PLAN');return {...s,itemId:s.itemId.toLowerCase()};});
 slots.sort((a,b)=>{const x=a.set+a.slot,y=b.set+b.slot;return x<y?-1:x>y?1:0;});
 if(new Set(slots.map(s=>s.set+':'+s.slot)).size!==slots.length)throw new DomainError(400,'INVALID_EQUIPMENT_PLAN');
 return {activeSet:input.activeSet,slots};
}
async function snapshot(client:pg.PoolClient,runId:string){return (await client.query('SELECT equipment_snapshot($1) AS state',[runId])).rows[0].state as EquipmentPlan;}
async function record(c:ActionContext,after:EquipmentPlan,reason:'PLAYER_SETUP'|'ASCENSION_CLEAR'){
 const before=await snapshot(c.client,c.run.id);if(checksum(before)===checksum(after))return false;
 const revision=(await c.client.query('SELECT revision::text FROM run_equipment WHERE run_id=$1',[c.run.id])).rows[0]?.revision??'0';
 if(BigInt(revision)>=9223372036854775807n)throw new DomainError(409,'EQUIPMENT_REVISION_EXHAUSTED');
 await c.client.query('INSERT INTO equipment_events(action_id,run_id,revision,before_state,after_state,reason) VALUES($1,$2,$3,$4,$5,$6)',[c.actionId,c.run.id,(BigInt(revision)+1n).toString(),before,after,reason]);return true;
}
export function setEquipment(pool:pg.Pool,accountId:string,envelope:Envelope,input:EquipmentPlan){
 if(envelope.actionType!=='SET_EQUIPMENT')throw new DomainError(400,'INVALID_EQUIPMENT_ACTION');const plan=normalize(input);
 return executeAction(pool,accountId,envelope,plan,async c=>{
 if((await c.client.query("SELECT 1 FROM instances i JOIN instance_participants p ON p.instance_id=i.id WHERE p.run_id=$1 AND i.lifecycle='ACTIVE' LIMIT 1",[c.run.id])).rows.length)throw new DomainError(409,'INSTANCE_STILL_ACTIVE');
 const ids=[...new Set(plan.slots.map(s=>s.itemId))],items=(await c.client.query(`SELECT i.*,s.run_id,s.lifecycle,b.kind,v.definition->'mechanics'->'equipment' AS spec FROM inventory_items i JOIN inventory_containers b ON b.id=i.container_id JOIN state_scopes s ON s.id=b.scope_id JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision WHERE i.id=ANY($1::uuid[]) ORDER BY i.id FOR UPDATE OF i FOR SHARE OF b,s`,[ids])).rows;
 const level=(await c.client.query('SELECT level FROM run_progression WHERE run_id=$1 FOR SHARE',[c.run.id])).rows[0]?.level;
 for(const slot of plan.slots){const item=items.find(i=>i.id===slot.itemId);
 if(!item||item.run_id!==c.run.id||item.lifecycle!=='ACTIVE'||item.kind!=='CARRIED')throw new DomainError(403,'EQUIPMENT_NOT_OWNED');
 if(item.quantity!=='1'||item.storage_mode!=='INSTANCE'||item.release_id!==c.run.content_release_id||item.binding==='SYSTEM_UNTRADEABLE')throw new DomainError(409,'EQUIPMENT_INELIGIBLE');
 const spec=equipmentSpec(item.spec);if(!spec.slots.includes(slot.slot)||!level||level<spec.minimumLevel)throw new DomainError(409,'EQUIPMENT_REQUIREMENT_NOT_MET');
 const repeats=plan.slots.filter(s=>s.itemId===slot.itemId);if(repeats.length>1&&(repeats.some(s=>s.set==='WORN')||new Set(repeats.map(s=>s.set)).size!==repeats.length||new Set(repeats.map(s=>s.slot)).size!==1))throw new DomainError(409,'EQUIPMENT_DUPLICATE_IDENTITY');
 if(spec.hands===2&&plan.slots.some(s=>s.set===slot.set&&s.slot==='OFF_HAND'))throw new DomainError(409,'TWO_HANDED_CONFLICT');
 }
 const changed=await record(c,plan,'PLAYER_SETUP');const boundItemIds=(await c.client.query('SELECT item_id FROM item_binding_events WHERE action_id=$1 ORDER BY item_id',[c.actionId])).rows.map(r=>r.item_id as string);return {activeSet:plan.activeSet,slots:plan.slots,boundItemIds,changed,revision:changed?await advanceRevision(c):c.run.revision};
 });
}
export async function clearEquipmentForAscension(c:ActionContext){await record(c,emptyEquipment(),'ASCENSION_CLEAR');}
export async function equipmentView(pool:pg.Pool,accountId:string){
 const row=(await pool.query(`SELECT equipment_snapshot(r.id) AS state,coalesce(e.revision,0)::text AS revision FROM runs r JOIN characters c ON c.id=r.character_id LEFT JOIN run_equipment e ON e.run_id=r.id WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE')`,[accountId])).rows[0];
 if(!row)throw new DomainError(409,'NO_RUN');return {...row.state,equipmentRevision:row.revision};
}
