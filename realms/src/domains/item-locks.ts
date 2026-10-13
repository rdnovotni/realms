import type pg from 'pg';
import { executeAction,advanceRevision,type Envelope } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
import { lockPersonalContainer } from './item-accounting.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function setItemLock(pool:pg.Pool,accountId:string,envelope:Envelope,itemId:string,locked:boolean){
  if(!uuid.test(itemId)||typeof locked!=='boolean'||envelope.actionType!=='SET_ITEM_LOCK')throw new DomainError(400,'INVALID_ITEM_LOCK');
  if(!['MANUAL_UI','API'].includes(envelope.authorizationSource??'MANUAL_UI'))throw new DomainError(403,'EXPLICIT_ITEM_LOCK_ACTION_REQUIRED');
  const id=itemId.toLowerCase();
  return executeAction(pool,accountId,envelope,{itemId:id,locked},async c=>{
    const item=(await c.client.query('SELECT container_id,quantity FROM inventory_items WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!item||BigInt(item.quantity)===0n)throw new DomainError(404,'ITEM_NOT_FOUND');
    await lockPersonalContainer(c,item.container_id);
    const prior=(await c.client.query('SELECT locked,revision::text FROM inventory_item_locks WHERE item_id=$1',[id])).rows[0];
    const revision=BigInt(prior?.revision??'0');
    if((prior?.locked??false)===locked)return {itemId:id,locked,changed:false,protectionRevision:revision.toString(),revision:c.run.revision};
    if(revision>=9223372036854775807n)throw new DomainError(409,'ITEM_LOCK_REVISION_EXHAUSTED');
    await c.client.query(`INSERT INTO inventory_lock_events(item_id,action_id,run_id,revision,previous_locked,locked) VALUES($1,$2,$3,$4,$5,$6)`,[id,c.actionId,c.run.id,(revision+1n).toString(),prior?.locked??false,locked]);
    return {itemId:id,locked,changed:true,protectionRevision:(revision+1n).toString(),revision:await advanceRevision(c)};
  });
}
export async function itemLockView(pool:pg.Pool,accountId:string,itemId:string){
  const row=(await pool.query(`SELECT i.id AS "itemId",coalesce(p.locked,false) AS locked,coalesce(p.revision,0)::text AS "protectionRevision"
    FROM inventory_items i JOIN inventory_containers b ON b.id=i.container_id JOIN state_scopes s ON s.id=b.scope_id
    LEFT JOIN runs r ON r.id=s.run_id LEFT JOIN characters c ON c.id=r.character_id LEFT JOIN inventory_item_locks p ON p.item_id=i.id
    WHERE i.id=$1 AND i.quantity>0 AND s.lifecycle='ACTIVE' AND b.kind IN('CARRIED','MATERIAL_VAULT','HOME','LEGACY')
      AND (s.account_id=$2 OR c.account_id=$2)`,[itemId,accountId])).rows[0];
  if(!row)throw new DomainError(404,'ITEM_NOT_FOUND');return row;
}
