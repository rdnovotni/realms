import type pg from 'pg';
import { executeAction,advanceRevision,type Envelope } from '../foundation/action.js';
import { transaction } from '../foundation/transaction.js';
import { consumptionReadContext } from './consumption.js';
import { requireInventoryIdle } from './inventory-browser.js';
import { DomainError } from '../foundation/errors.js';
export type CombatSlot={slot:number;itemId:string};
export function setCombatQuickslots(pool:pg.Pool,accountId:string,e:Envelope,slots:CombatSlot[]){
 if(e.actionType!=='SET_COMBAT_QUICKSLOTS'||!['MANUAL_UI','API'].includes(e.authorizationSource??'MANUAL_UI')||!Array.isArray(slots)||slots.length>4||new Set(slots.map(s=>s.slot)).size!==slots.length||new Set(slots.map(s=>s.itemId)).size!==slots.length||slots.some(s=>Object.keys(s).sort().join()!=='itemId,slot'||!Number.isInteger(s.slot)||s.slot<1||s.slot>4||!/^[-a-f0-9]{36}$/.test(s.itemId)))throw new DomainError(400,'INVALID_COMBAT_QUICKSLOTS');
 slots=[...slots].sort((a,b)=>a.slot-b.slot);return executeAction(pool,accountId,e,{slots},async c=>{await requireInventoryIdle(c);await c.client.query('INSERT INTO combat_quickslot_events(account_id,action_id,slots) VALUES($1,$2,$3)',[accountId,c.actionId,JSON.stringify(slots)]);return {slots,revision:await advanceRevision(c)};});
}
export function combatPreparationView(pool:pg.Pool,accountId:string){return transaction(pool,async client=>{
 const c=await consumptionReadContext(client,accountId),slots=(await client.query('SELECT combat_quickslots_at($1,now()) AS slots',[accountId])).rows[0].slots as CombatSlot[];
 const active=!!(await client.query("SELECT 1 FROM instances i JOIN instance_participants p ON p.instance_id=i.id WHERE p.run_id=$1 AND i.lifecycle='ACTIVE'",[c.run.id])).rowCount;
 const items=(await client.query(`SELECT i.id,v.definition->>'name' AS name,i.quantity::text,v.definition->'mechanics'->'combatItem' AS spec,coalesce(a.favorite,false) AS favorite,coalesce(a.collection_protected,false) AS collection,EXISTS(SELECT 1 FROM inventory_item_locks WHERE item_id=i.id AND locked) locked,EXISTS(SELECT 1 FROM equipment_slots WHERE item_id=i.id) equipped,EXISTS(SELECT 1 FROM equipment_loadout_items WHERE item_id=i.id) saved FROM inventory_items i JOIN inventory_containers b ON b.id=i.container_id JOIN state_scopes s ON s.id=b.scope_id JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision JOIN discoveries d ON d.account_id=$1 AND d.entity_id=i.definition_id LEFT JOIN inventory_item_annotations a ON a.item_id=i.id AND a.account_id=$1 WHERE s.run_id=$2 AND b.kind='CARRIED' AND i.quantity>0 AND v.definition->'mechanics' ? 'combatItem' ORDER BY EXISTS(SELECT 1 FROM jsonb_array_elements(combat_quickslots_at($1,now())) q WHERE q->>'itemId'=i.id::text) DESC,name,i.id LIMIT 101`,[accountId,c.run.id])).rows;
 return {runId:c.run.id,revision:c.run.revision,active,slots,items:items.slice(0,100),hasMore:items.length>100};
 });}
