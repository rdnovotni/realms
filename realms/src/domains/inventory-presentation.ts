import type pg from 'pg';
import { executeAction,advanceRevision,type Envelope } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
import { writeState } from './state.js';
import { lockPersonalContainer } from './item-accounting.js';
import { applyItemLock } from './item-locks.js';
import { moveOwnedItem } from './inventory.js';
import { personalStorage,requireInventoryIdle } from './inventory-browser.js';
export const bulkOperations=['COLLECT','UNCOLLECT','LOCK','FAVORITE','UNFAVORITE','MARK_INSPECTED','MOVE_HOME','MOVE_CARRIED','MOVE_MATERIAL_VAULT'] as const;
export type BulkOperation=typeof bulkOperations[number];
export type ItemSelection={itemId:string;inspectionToken?:string};
export const defaultDisplayPreferences={healthyPercent:70,wornPercent:25,showSingleQuantity:true};
export async function workspacePreferences(client:pg.PoolClient,accountId:string){return (await client.query("SELECT value FROM scoped_state f JOIN state_scopes s ON s.id=f.scope_id WHERE s.account_id=$1 AND f.key='inventory.workspace.v1'",[accountId])).rows[0]?.value??{layout:'STANDARD'};}
export function setWorkspacePreferences(pool:pg.Pool,accountId:string,envelope:Envelope,layout:string){
 if(envelope.actionType!=='SET_INVENTORY_WORKSPACE'||!['COMPACT','STANDARD','DETAILED'].includes(layout))throw new DomainError(400,'INVALID_INVENTORY_LAYOUT');
 return executeAction(pool,accountId,envelope,{layout},async c=>{const prior=(await c.client.query("SELECT f.revision::text FROM scoped_state f JOIN state_scopes s ON s.id=f.scope_id WHERE s.account_id=$1 AND f.key='inventory.workspace.v1'",[accountId])).rows[0],scope=(await c.client.query("SELECT id FROM state_scopes WHERE account_id=$1 AND kind='ACCOUNT'",[accountId])).rows[0];await writeState(c.client,'inventory',scope.id,'inventory.workspace.v1',{layout},prior?.revision??null);return {layout,revision:c.run.revision};});
}
export type DisplayPreferences=typeof defaultDisplayPreferences;
export async function displayPreferences(client:pg.PoolClient,accountId:string){
 const row=(await client.query("SELECT f.value,f.revision::text FROM scoped_state f JOIN state_scopes s ON s.id=f.scope_id WHERE s.account_id=$1 AND f.key='inventory.display.v1'",[accountId])).rows[0];return {value:row?.value??defaultDisplayPreferences,revision:row?.revision??null};
}
export function setDisplayPreferences(pool:pg.Pool,accountId:string,envelope:Envelope,value:DisplayPreferences){
 if(envelope.actionType!=='SET_TILE_PREFERENCES'||!value||Object.keys(value).sort().join(',')!=='healthyPercent,showSingleQuantity,wornPercent'||!Number.isInteger(value.healthyPercent)||!Number.isInteger(value.wornPercent)||value.wornPercent<1||value.wornPercent>=value.healthyPercent||value.healthyPercent>100||typeof value.showSingleQuantity!=='boolean')throw new DomainError(400,'INVALID_TILE_PREFERENCES');
 return executeAction(pool,accountId,envelope,{preferences:value},async c=>{const prior=await displayPreferences(c.client,accountId),scope=(await c.client.query("SELECT id FROM state_scopes WHERE account_id=$1 AND kind='ACCOUNT'",[accountId])).rows[0];await writeState(c.client,'inventory',scope.id,'inventory.display.v1',value,prior.revision);return {preferences:value,revision:c.run.revision};});
}
/** Bounded physical identities only. One receipt/transaction; any denial rolls
 * the entire batch back. Cosmetic intent does not stale a gameplay draft. */
export function bulkInventory(pool:pg.Pool,accountId:string,envelope:Envelope,operation:BulkOperation,selections:ItemSelection[]){
 if(envelope.actionType!=='BULK_INVENTORY'||!bulkOperations.includes(operation)||!Array.isArray(selections)||!selections.length||selections.length>48||selections.some(s=>!s||Object.keys(s).some(k=>!['itemId','inspectionToken'].includes(k))||typeof s.itemId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.itemId)||s.inspectionToken!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.inspectionToken))||new Set(selections.map(s=>s.itemId.toLowerCase())).size!==selections.length)throw new DomainError(400,'INVALID_INVENTORY_SELECTION');
 if(!['MANUAL_UI','API'].includes(envelope.authorizationSource??'MANUAL_UI'))throw new DomainError(403,'EXPLICIT_INVENTORY_ACTION_REQUIRED');
 const selected=selections.map(s=>({...s,itemId:s.itemId.toLowerCase()})).sort((a,b)=>a.itemId.localeCompare(b.itemId));
 return executeAction(pool,accountId,envelope,{operation,selections:selected},async c=>{
  const ids=selected.map(s=>s.itemId),items=(await c.client.query('SELECT id,container_id,quantity FROM inventory_items WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids])).rows;
  if(items.length!==ids.length||items.some(i=>BigInt(i.quantity)===0n))throw new DomainError(404,'ITEM_NOT_FOUND');
  for(const container of [...new Set(items.map(i=>i.container_id as string))].sort())await lockPersonalContainer(c,container);
  let changed=0;
  if(operation.startsWith('MOVE_')){
   await requireInventoryIdle(c);
   if((await c.client.query(`SELECT 1 FROM inventory_items i WHERE i.id=ANY($1::uuid[]) AND (EXISTS(SELECT 1 FROM equipment_slots e WHERE e.item_id=i.id) OR EXISTS(SELECT 1 FROM inventory_item_locks l WHERE l.item_id=i.id AND l.locked) OR EXISTS(SELECT 1 FROM equipment_loadout_items p WHERE p.item_id=i.id)) LIMIT 1`,[ids])).rowCount)throw new DomainError(409,'BULK_ITEM_PROTECTED');
   const kind=operation.slice(5) as 'HOME'|'CARRIED'|'MATERIAL_VAULT',destination=await personalStorage(c,kind);
   for(const item of items)if(item.container_id!==destination){await moveOwnedItem(c,item.id,destination,false);changed++;}
  }else if(operation==='LOCK'){for(const item of items)if((await applyItemLock(c,item.id,true)).changed)changed++;}
  else for(const item of items){
   const prior=(await c.client.query('SELECT collection_protected,favorite,seen_operation_no::text FROM inventory_item_annotations WHERE account_id=$1 AND item_id=$2 FOR UPDATE',[accountId,item.id])).rows[0];let favorite=prior?.favorite??false,seen=prior?.seen_operation_no??'0';
   if(operation==='COLLECT'||operation==='UNCOLLECT'){await c.client.query(`INSERT INTO inventory_item_annotations(account_id,item_id,collection_protected,last_action_id) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,item_id) DO UPDATE SET collection_protected=EXCLUDED.collection_protected,last_action_id=EXCLUDED.last_action_id`,[accountId,item.id,operation==='COLLECT',c.actionId]);changed++;continue;}
   if(operation==='MARK_INSPECTED'){
    const token=selected.find(s=>s.itemId===item.id)!.inspectionToken;if(token===undefined)throw new DomainError(400,'INSPECTION_TOKEN_REQUIRED');
    const observed=(await c.client.query('SELECT o.operation_no::text n FROM inventory_quantity_operations q JOIN inventory_quantity_order o ON o.operation_id=q.id WHERE q.to_item_id=$1 AND q.id=$2',[item.id,token])).rows[0];
    if(!observed)throw new DomainError(409,'INVALID_INSPECTION_TOKEN');seen=BigInt(seen)>BigInt(observed.n)?seen:observed.n;
   }else favorite=operation==='FAVORITE';
   if(favorite===(prior?.favorite??false)&&seen===(prior?.seen_operation_no??'0'))continue;
   await c.client.query(`INSERT INTO inventory_item_annotations(account_id,item_id,favorite,seen_operation_no,last_action_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,item_id) DO UPDATE SET favorite=EXCLUDED.favorite,seen_operation_no=EXCLUDED.seen_operation_no,last_action_id=EXCLUDED.last_action_id`,[accountId,item.id,favorite,seen,c.actionId]);changed++;
  }
  return {operation,itemIds:ids,selected:ids.length,changed,revision:changed&&(operation==='COLLECT'||operation==='UNCOLLECT'||operation==='LOCK'||operation.startsWith('MOVE_'))?await advanceRevision(c):c.run.revision};
 });
}
