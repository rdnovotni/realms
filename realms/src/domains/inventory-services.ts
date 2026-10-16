import type pg from 'pg';
import { executeAction,advanceRevision,type ActionContext,type Envelope } from '../foundation/action.js';
import { transaction } from '../foundation/transaction.js';
import { checksum } from '../foundation/json.js';
import { DomainError } from '../foundation/errors.js';
import { requireInventoryIdle } from './inventory-browser.js';
import { lockPersonalContainer,consumeItem } from './item-accounting.js';
import { postTransfers } from './ledger.js';
import { requireEntityPrerequisite } from '../rules/requirements.js';
import { grantRuleRewards } from '../rules/settlement.js';
import { requireFeature } from '../rules/controls.js';
import { applyItemEffects } from './shared-rule-actions.js';
import { validateItemUse } from './inventory-services-content.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function selection(ids:string[]|null){if(ids!==null&&(!Array.isArray(ids)||!ids.length||ids.length>48||ids.some(id=>typeof id!=='string'||!uuid.test(id))||new Set(ids.map(i=>i.toLowerCase())).size!==ids.length))throw new DomainError(400,'INVALID_INVENTORY_SELECTION');return ids?.map(i=>i.toLowerCase()).sort()??null;}
function explicit(e:Envelope,type:string){if(e.actionType!==type)throw new DomainError(400,'INVALID_INVENTORY_ACTION');if(!['MANUAL_UI','API'].includes(e.authorizationSource??'MANUAL_UI'))throw new DomainError(403,'EXPLICIT_INVENTORY_ACTION_REQUIRED');}
async function readContext(client:pg.PoolClient,accountId:string,expectedRevision:number):Promise<ActionContext>{
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>2147483646)throw new DomainError(400,'INVALID_INVENTORY_QUERY');
 await client.query('SELECT id FROM accounts WHERE id=$1 FOR SHARE',[accountId]);
 const run=(await client.query("SELECT r.* FROM runs r JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND r.status IN('ACTIVE','AFTERCORE') FOR SHARE OF r",[accountId])).rows[0];if(!run)throw new DomainError(409,'NO_RUN');if(run.revision!==expectedRevision)throw new DomainError(409,'STALE_REVISION');
 return {client,run,accountId,actionId:'00000000-0000-0000-0000-000000000000',requestId:'00000000-0000-0000-0000-000000000000'};
}
async function quoteRepairs(c:ActionContext,ids:string[]|null){
 await requireInventoryIdle(c);await requireFeature(c.client,'action.REPAIR_ITEMS',c.accountId);
 const rows=(await c.client.query(`SELECT i.id AS "itemId",v.definition->>'name' AS name,inventory_condition(i.id) AS before,
 (v.definition->'mechanics'->'tacticalDurability'->>'maximum')::integer AS after,
 (v.definition->'mechanics'->'repair'->>'goldPerPoint')::integer AS rate,
 coalesce((SELECT max(id) FROM tactical_equipment_wear WHERE item_id=i.id),0)::text AS "wearId"
 FROM inventory_items i JOIN inventory_containers b ON b.id=i.container_id JOIN state_scopes s ON s.id=b.scope_id JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision
 WHERE s.run_id=$1 AND s.lifecycle='ACTIVE' AND b.kind IN('CARRIED','HOME') AND i.quantity>0 AND ( $2::uuid[] IS NULL OR i.id=ANY($2::uuid[])) ORDER BY i.id FOR UPDATE OF i`,[c.run.id,ids])).rows;
 if(ids&&rows.length!==ids.length)throw new DomainError(403,'REPAIR_ITEM_UNAVAILABLE');
 const unavailable=rows.filter(r=>r.after!==null&&r.before<r.after&&r.rate===null).map(r=>({itemId:r.itemId,name:r.name,reason:'No authored repair price'}));
 const items=rows.filter(r=>r.after!==null&&r.before<r.after&&r.rate!==null).map(r=>({...r,cost:(BigInt(r.after-r.before)*BigInt(r.rate)).toString()}));
 const total=items.reduce((s,r)=>s+BigInt(r.cost),0n).toString();
 const balance=(await c.client.query("SELECT w.balance::text FROM wallets w JOIN state_scopes s ON s.id=w.scope_id WHERE s.run_id=$1 AND s.lifecycle='ACTIVE' AND w.purpose='PLAYER' AND w.currency_id='GOLD'",[c.run.id])).rows[0]?.balance??'0';
 const token=checksum({runId:c.run.id,revision:c.run.revision,ids,items,total});
 return {runId:c.run.id,revision:c.run.revision,items,unavailable,total,balance,affordable:BigInt(balance)>=BigInt(total),token};
}
export function repairPreview(pool:pg.Pool,accountId:string,expectedRevision:number,ids:string[]|null){const normalized=selection(ids);return transaction(pool,async client=>quoteRepairs(await readContext(client,accountId,expectedRevision),normalized));}
export function repairItems(pool:pg.Pool,accountId:string,envelope:Envelope,ids:string[]|null,token:string){
 explicit(envelope,'REPAIR_ITEMS');const normalized=selection(ids);if(typeof token!=='string'||!/^[0-9a-f]{64}$/.test(token))throw new DomainError(400,'INVALID_REPAIR_QUOTE');
 return executeAction(pool,accountId,envelope,{itemIds:normalized,token},async c=>{
  const quote=await quoteRepairs(c,normalized);if(quote.token!==token)throw new DomainError(409,'REPAIR_QUOTE_CHANGED');if(!quote.items.length)throw new DomainError(409,'NOTHING_TO_REPAIR');if(!quote.affordable)throw new DomainError(409,'INSUFFICIENT_GOLD');
  const sources=(await c.client.query("SELECT w.id FROM wallets w JOIN state_scopes s ON s.id=w.scope_id WHERE s.run_id=$1 AND s.lifecycle='ACTIVE' AND w.currency_id='GOLD' AND w.purpose='PLAYER'",[c.run.id])).rows;
  const sinks=(await c.client.query("SELECT w.id FROM wallets w JOIN state_scopes s ON s.id=w.scope_id WHERE s.kind='WORLD' AND s.lifecycle='ACTIVE' AND w.currency_id='GOLD' AND w.purpose='FAUCET_SINK' ORDER BY w.id LIMIT 2")).rows;
  if(sources.length!==1||sinks.length!==1)throw new DomainError(409,'RULE_GOLD_SOURCE_NOT_CONFIGURED');
  await postTransfers(c,[{key:'inventory.repair',currencyId:'GOLD',from:sources[0].id,to:sinks[0].id,amount:quote.total,reason:'INVENTORY_REPAIR'}]);
  for(const item of quote.items)await c.client.query('INSERT INTO inventory_repairs(action_id,item_id,run_id,wear_id,before_condition,after_condition,cost) VALUES($1,$2,$3,$4,$5,$6,$7)',[c.actionId,item.itemId,c.run.id,item.wearId,item.before,item.after,item.cost]);
  return {items:quote.items,total:quote.total,revision:await advanceRevision(c)};
 });
}
async function usable(c:ActionContext,itemId:string){
 if(!uuid.test(itemId))throw new DomainError(400,'INVALID_ITEM_ID');await requireInventoryIdle(c);
 const row=(await c.client.query(`SELECT i.*,b.kind,s.run_id,v.definition->>'name' AS name,v.definition->'mechanics'->'itemUse' AS use FROM inventory_items i JOIN inventory_containers b ON b.id=i.container_id JOIN state_scopes s ON s.id=b.scope_id JOIN content_versions v ON v.entity_id=i.definition_id AND v.revision=i.definition_revision WHERE i.id=$1 AND i.quantity>0 FOR UPDATE OF i`,[itemId])).rows[0];
 if(!row)throw new DomainError(404,'ITEM_NOT_FOUND');await lockPersonalContainer(c,row.container_id);
 if(row.kind!=='CARRIED'||row.run_id!==c.run.id||row.release_id!==c.run.content_release_id||row.binding==='SYSTEM_UNTRADEABLE'||row.bound_account_id&&row.bound_account_id!==c.accountId||row.bound_run_id&&row.bound_run_id!==c.run.id)throw new DomainError(409,'ITEM_USE_UNAVAILABLE');
 if(!row.use)throw new DomainError(409,'ITEM_HAS_NO_USE');validateItemUse(row.use);await requireFeature(c.client,'action.USE_ITEM',c.accountId);await requireFeature(c.client,`content.${row.definition_id}`,c.accountId);await requireEntityPrerequisite(c,row.definition_id);
 const protection=(await c.client.query(`SELECT coalesce((SELECT collection_protected FROM inventory_item_annotations WHERE account_id=$1 AND item_id=$2),false) collection,coalesce((SELECT favorite FROM inventory_item_annotations WHERE account_id=$1 AND item_id=$2),false) favorite,EXISTS(SELECT 1 FROM inventory_item_locks WHERE item_id=$2 AND locked) locked,EXISTS(SELECT 1 FROM equipment_loadout_items WHERE item_id=$2) saved,EXISTS(SELECT 1 FROM equipment_slots WHERE item_id=$2) equipped`,[c.accountId,row.id])).rows[0];
 return {row,protection,token:checksum({itemId:row.id,revision:c.run.revision,definitionRevision:row.definition_revision,quantity:row.quantity,use:row.use,protection})};
}
export function itemUsePreview(pool:pg.Pool,accountId:string,expectedRevision:number,itemId:string){return transaction(pool,async client=>{
 const c=await readContext(client,accountId,expectedRevision),{row,protection,token}=await usable(c,itemId);
 const names=(await client.query("SELECT e.entity_id,v.definition->>'name' AS name FROM release_entries e JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=$2 WHERE e.release_id=$1",[c.run.content_release_id,accountId])).rows;
 return {runId:c.run.id,revision:c.run.revision,itemId:row.id,name:row.name,kind:row.use.kind,quantity:'1',remaining:(BigInt(row.quantity)-1n).toString(),protection,eligible:!protection.collection&&!protection.locked&&!protection.saved&&!protection.equipped,token,
 effects:row.use.effects.map((id:string)=>names.find(n=>n.entity_id===id)?.name??'Unidentified effect'),
 rewards:row.use.rewards.map((r:{kind:string;id:string;quantity:number})=>({kind:r.kind,name:r.kind==='GOLD'?'Gold':names.find(n=>n.entity_id===r.id)?.name??'Unidentified reward',quantity:r.quantity}))};
 });}
export function useInventoryItem(pool:pg.Pool,accountId:string,envelope:Envelope,itemId:string,token:string,allowFavorite:boolean){
 explicit(envelope,'USE_ITEM');if(typeof token!=='string'||!/^[0-9a-f]{64}$/.test(token)||typeof allowFavorite!=='boolean')throw new DomainError(400,'INVALID_ITEM_USE_CONFIRMATION');
 return executeAction(pool,accountId,envelope,{itemId,token,allowFavorite},async c=>{
  const {row,protection,token:current}=await usable(c,itemId);if(token!==current)throw new DomainError(409,'ITEM_USE_QUOTE_CHANGED');if(protection.favorite&&!allowFavorite)throw new DomainError(409,'FAVORITE_CONFIRMATION_REQUIRED');
  const consumed=await consumeItem(c,'inventory.use',row.id,'1','PLAYER_ITEM_USE');
  const effects=row.use.effects.length?await applyItemEffects(c,row.definition_id,row.definition_revision,row.use.effects):0;
  const rewards=row.use.rewards.length?await grantRuleRewards(c,row.use.rewards,row.definition_id):[];
  return {itemId:row.id,kind:row.use.kind,remaining:consumed.remaining,effects,rewards,revision:await advanceRevision(c)};
 });
}
