import { requireInventoryIdle,personalStorage } from './inventory-browser.js';
import type { ActionContext } from '../foundation/action.js';
import type pg from 'pg';
import { executeAction, requireActive, advanceRevision, type Envelope } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
export function moveItem(pool: pg.Pool, accountId: string, envelope: Envelope, itemId: string, destinationId: string) {
  return executeAction(pool, accountId, envelope, { itemId,destinationId }, async context => moveOwnedItem(context,itemId,destinationId));
}
export async function moveOwnedItem(context:ActionContext,itemId:string,destinationId:string,advance=true) {
    await requireInventoryIdle(context);const accountId=context.accountId;
    const item = (await context.client.query('SELECT * FROM inventory_items WHERE id=$1 FOR UPDATE', [itemId])).rows[0];
    if (!item || BigInt(item.quantity)===0n) throw new DomainError(404,'ITEM_NOT_FOUND');
    const containers = await context.client.query(`SELECT c.*,s.account_id,s.run_id,s.lifecycle FROM inventory_containers c
      JOIN state_scopes s ON s.id=c.scope_id WHERE c.id=ANY($1::uuid[]) ORDER BY c.id FOR UPDATE OF c FOR SHARE OF s`, [[item.container_id,destinationId]]);
    const from = containers.rows.find(c=>c.id===item.container_id), to = containers.rows.find(c=>c.id===destinationId);
    const owns = (c: { account_id:string; run_id:string; lifecycle:string } | undefined) => c && c.lifecycle==='ACTIVE' && (c.account_id===accountId || c.run_id===context.run.id);
    if (!owns(from) || !owns(to)) throw new DomainError(403,'CONTAINER_NOT_OWNED');
    if((await context.client.query('SELECT 1 FROM equipment_slots WHERE item_id=$1 LIMIT 1',[itemId])).rows.length)throw new DomainError(409,'ITEM_EQUIPPED');
    if (item.container_id===destinationId) throw new DomainError(409,'SAME_CONTAINER');
    if (!['CARRIED','HOME','MATERIAL_VAULT','LEGACY'].includes(from.kind) || !['CARRIED','HOME','MATERIAL_VAULT','LEGACY'].includes(to.kind)) throw new DomainError(409,'SPECIAL_CUSTODY_REQUIRED');
    if (item.binding==='SYSTEM_UNTRADEABLE' || (item.bound_account_id && item.bound_account_id!==accountId) || (item.bound_run_id && to.run_id!==item.bound_run_id)) throw new DomainError(409,'BINDING_RESTRICTED');
    if (context.run.mode!=='CASUAL' && (from.run_id!==context.run.id || to.run_id!==context.run.id)) throw new DomainError(409,'LEGACY_ACCESS_RESTRICTED');
    if(to.kind==='MATERIAL_VAULT'){const spec=(await context.client.query("SELECT coalesce(v.definition->'mechanics'->'inventory'->>'category',v.definition->'mechanics'->>'inventoryCategory') AS category FROM inventory_items i JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision WHERE i.id=$1",[itemId])).rows[0];if(spec.category!=='MATERIAL')throw new DomainError(409,'MATERIAL_VAULT_ONLY');}
    await context.client.query('UPDATE inventory_items SET container_id=$1 WHERE id=$2',[destinationId,itemId]);
    await context.client.query('INSERT INTO inventory_movements(item_id,from_container_id,to_container_id,action_id,reason) VALUES($1,$2,$3,$4,$5)', [itemId,from.id,to.id,context.actionId,'PLAYER_STORAGE_MOVE']);
    return { itemId,containerId:destinationId,revision:advance?await advanceRevision(context):context.run.revision };
}
export function moveToPersonalStorage(pool:pg.Pool,accountId:string,envelope:Envelope,itemId:string,kind:'CARRIED'|'HOME'|'MATERIAL_VAULT') {
 return executeAction(pool,accountId,envelope,{itemId,kind},async c=>{
  await requireInventoryIdle(c);const destination=await personalStorage(c,kind);return moveOwnedItem(c,itemId,destination);
 });
}
