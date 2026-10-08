import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { DomainError } from '../foundation/errors.js';
import { checksum, type Json } from '../foundation/json.js';
import { type ActionContext, type Envelope, executeAction, advanceRevision, requireActive } from '../foundation/action.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxQuantity=9223372036854775807n;
export type ItemInventorySpec={version:1;storageMode:'STACK'|'INSTANCE';category:'MATERIAL'|'CONSUMABLE'|'EQUIPMENT'|'OTHER'};
export function validateInventorySpec(value:unknown): asserts value is ItemInventorySpec {
  if(typeof value!=='object' || value===null || Array.isArray(value)) throw new DomainError(400,'INVALID_ITEM_INVENTORY_SPEC');
  const spec=value as Record<string,unknown>;
  if(Object.keys(spec).some(k=>!['version','storageMode','category'].includes(k)) || spec.version!==1 ||
    !['STACK','INSTANCE'].includes(String(spec.storageMode)) || !['MATERIAL','CONSUMABLE','EQUIPMENT','OTHER'].includes(String(spec.category)) ||
    (spec.category==='EQUIPMENT' && spec.storageMode!=='INSTANCE') ||
    (['MATERIAL','CONSUMABLE'].includes(String(spec.category)) && spec.storageMode!=='STACK')) throw new DomainError(400,'INVALID_ITEM_INVENTORY_SPEC');
}
function quantity(value:string){
  if(!/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value)>maxQuantity) throw new DomainError(400,'INVALID_ITEM_QUANTITY');
  return BigInt(value);
}
function operation(key:string,reason:string){
  if(!/^[a-z][a-z0-9_.-]{0,63}$/.test(key) || reason.trim().length<1 || reason.length>200) throw new DomainError(400,'INVALID_ITEM_OPERATION');
}
function identity(value:string){if(!uuid.test(value)) throw new DomainError(400,'INVALID_ITEM_ID');return value.toLowerCase();}

// Personal inventory only. Guild, escrow, museum, mail, trade and loan custody
// require their own authority and transaction services; clients never choose grants.
export async function lockPersonalContainer(context:ActionContext,containerId:string){
  requireActive(context);
  const row=(await context.client.query(`SELECT c.*,s.run_id,s.account_id,s.lifecycle FROM inventory_containers c
    JOIN state_scopes s ON s.id=c.scope_id WHERE c.id=$1 FOR SHARE OF c,s`,[identity(containerId)])).rows[0];
  if(!row || row.lifecycle!=='ACTIVE' || !['CARRIED','MATERIAL_VAULT','HOME','LEGACY'].includes(row.kind) ||
    (row.account_id!==context.accountId && row.run_id!==context.run.id)) throw new DomainError(403,'CONTAINER_NOT_OWNED');
  if(context.run.mode!=='CASUAL' && row.run_id!==context.run.id) throw new DomainError(409,'LEGACY_ACCESS_RESTRICTED');
  return row as {id:string;run_id:string|null;account_id:string|null;kind:string};
}
type ItemRow={id:string;container_id:string;quantity:string;storage_mode:string;binding:string;metadata:Record<string,Json>};
async function lockItems(context:ActionContext,ids:string[]){
  const rows=(await context.client.query<ItemRow>('SELECT * FROM inventory_items WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids.map(identity)])).rows;
  if(rows.length!==new Set(ids.map(identity)).size || rows.some(i=>BigInt(i.quantity)===0n)) throw new DomainError(404,'ITEM_NOT_FOUND');
  for(const containerId of [...new Set(rows.map(i=>i.container_id))].sort()) await lockPersonalContainer(context,containerId);
  return rows;
}
async function assertUnlocked(context:ActionContext,ids:string[]){
  if((await context.client.query('SELECT 1 FROM equipment_slots WHERE item_id=ANY($1::uuid[]) LIMIT 1',[ids])).rows.length)throw new DomainError(409,'ITEM_EQUIPPED');
  if((await context.client.query('SELECT 1 FROM inventory_item_locks WHERE item_id=ANY($1::uuid[]) AND locked LIMIT 1',[ids])).rows.length)throw new DomainError(409,'ITEM_LOCKED');
}
async function record(context:ActionContext,key:string,kind:string,from:string|null,to:string|null,amount:string,reason:string){
  return (await context.client.query(`INSERT INTO inventory_quantity_operations(action_id,operation_key,kind,from_item_id,to_item_id,quantity,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[context.actionId,key,kind,from,to,amount,reason])).rows[0].id as string;
}
export type ItemGrant={containerId:string;definitionId:string;quantity:string;quality?:string;binding?:'TRADEABLE'|'ACCOUNT_BOUND'|'RUN_BOUND'|'SYSTEM_UNTRADEABLE';sourceCode:string;metadata?:Record<string,Json>};

// Internal reward/crafting API. The calling domain must validate entitlement,
// ingredients, Turn costs and outcomes before issuing its authoritative plan.
export async function grantItem(context:ActionContext,key:string,input:ItemGrant,reason:string){
  const grant=structuredClone(input);operation(key,reason);const amount=quantity(grant.quantity);
  if(!/^[a-z][a-z0-9_.-]{2,119}$/.test(grant.definitionId) || grant.sourceCode.trim().length<1 || grant.sourceCode.length>200 ||
    !/^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,4})?$/.test(grant.quality??'1') || Number(grant.quality??'1')<=0 ||
    !['TRADEABLE','ACCOUNT_BOUND','RUN_BOUND','SYSTEM_UNTRADEABLE'].includes(grant.binding??'TRADEABLE')) throw new DomainError(400,'INVALID_ITEM_GRANT');
  const metadata=grant.metadata??{};checksum(metadata);
  if(Array.isArray(metadata) || metadata===null || Buffer.byteLength(JSON.stringify(metadata))>8192) throw new DomainError(400,'INVALID_ITEM_METADATA');
  const container=await lockPersonalContainer(context,grant.containerId);
  const content=(await context.client.query(`SELECT e.revision,v.definition->'mechanics'->'inventory' AS spec FROM release_entries e
    JOIN content_entities c ON c.id=e.entity_id AND c.kind='ITEM'
    JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=$1 AND e.entity_id=$2`,[context.run.content_release_id,grant.definitionId])).rows[0];
  if(!content) throw new DomainError(409,'ITEM_NOT_IN_RULES_SNAPSHOT');
  validateInventorySpec(content.spec);
  if(content.spec.storageMode==='INSTANCE' && amount!==1n) throw new DomainError(400,'INSTANCE_QUANTITY_REQUIRED');
  const binding=grant.binding??'TRADEABLE';
  if(binding==='RUN_BOUND' && container.run_id!==context.run.id) throw new DomainError(409,'BINDING_RESTRICTED');
  const id=randomUUID();
  await context.client.query(`INSERT INTO inventory_items(id,container_id,definition_id,release_id,definition_revision,storage_mode,quantity,quality,binding,bound_account_id,bound_run_id,source_code,metadata)
    VALUES($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10,$11,$12)`,[id,container.id,grant.definitionId,context.run.content_release_id,content.revision,content.spec.storageMode,grant.quality??'1',binding,binding==='ACCOUNT_BOUND'?context.accountId:null,binding==='RUN_BOUND'?context.run.id:null,grant.sourceCode,metadata]);
  const operationId=await record(context,key,'GRANT',null,id,grant.quantity,reason);
  return {itemId:id,operationId};
}
export async function consumeItem(context:ActionContext,key:string,itemId:string,amount:string,reason:string){
  operation(key,reason);const count=quantity(amount);
  const item=(await lockItems(context,[itemId]))[0]!;
  await assertUnlocked(context,[item.id]);
  if(count>BigInt(item.quantity)) throw new DomainError(409,'INSUFFICIENT_ITEM_QUANTITY');
  return {itemId:item.id,operationId:await record(context,key,'CONSUME',item.id,null,amount,reason),remaining:(BigInt(item.quantity)-count).toString()};
}
export function splitStack(pool:pg.Pool,accountId:string,envelope:Envelope,itemId:string,amount:string){
  const id=identity(itemId);quantity(amount);
  return executeAction(pool,accountId,envelope,{itemId:id,amount},async context=>{
    const item=(await lockItems(context,[id]))[0]!;
    await assertUnlocked(context,[item.id]);
    if(item.storage_mode!=='STACK' || BigInt(amount)>=BigInt(item.quantity)) throw new DomainError(409,'INVALID_STACK_SPLIT');
    const child=randomUUID();
    await context.client.query(`INSERT INTO inventory_items(id,container_id,definition_id,definition_kind,release_id,definition_revision,storage_mode,quantity,quality,binding,bound_account_id,bound_run_id,source_code,metadata)
      SELECT $1,container_id,definition_id,definition_kind,release_id,definition_revision,storage_mode,0,quality,binding,bound_account_id,bound_run_id,source_code,metadata FROM inventory_items WHERE id=$2`,[child,item.id]);
    const operationId=await record(context,'split','SPLIT',item.id,child,amount,'PLAYER_STACK_SPLIT');
    return {itemId:item.id,splitItemId:child,operationId,revision:await advanceRevision(context)};
  });
}
export function mergeStacks(pool:pg.Pool,accountId:string,envelope:Envelope,sourceId:string,targetId:string){
  const from=identity(sourceId),to=identity(targetId);if(from===to) throw new DomainError(400,'SAME_ITEM');
  return executeAction(pool,accountId,envelope,{sourceId:from,targetId:to},async context=>{
    const items=await lockItems(context,[from,to]),source=items.find(i=>i.id===from)!,target=items.find(i=>i.id===to)!;
    await assertUnlocked(context,[from,to]);
    const compatible=(await context.client.query(`SELECT (to_jsonb(a)-ARRAY['id','quantity','created_at'])=(to_jsonb(b)-ARRAY['id','quantity','created_at']) AS matches FROM inventory_items a,inventory_items b WHERE a.id=$1 AND b.id=$2`,[from,to])).rows[0].matches;
    if(source.storage_mode!=='STACK' || target.storage_mode!=='STACK' || !compatible) throw new DomainError(409,'INCOMPATIBLE_STACKS');
    if(BigInt(source.quantity)+BigInt(target.quantity)>maxQuantity) throw new DomainError(409,'ITEM_QUANTITY_OVERFLOW');
    const operationId=await record(context,'merge','MERGE',from,to,source.quantity,'PLAYER_STACK_MERGE');
    return {itemId:to,retiredItemId:from,quantity:(BigInt(source.quantity)+BigInt(target.quantity)).toString(),operationId,revision:await advanceRevision(context)};
  });
}
