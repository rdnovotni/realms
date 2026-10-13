import type pg from 'pg';
import { executeAction,advanceRevision,type Envelope,type ActionContext } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
import { consumeItem,grantItem } from './item-accounting.js';
import { recipeSpec } from './crafting-content.js';
const idPattern=/^[a-z][a-z0-9_.-]{2,119}$/;
async function knownRecipe(client:pg.PoolClient|pg.Pool,accountId:string,runId:string,recipeId:string){
  const row=(await client.query(`SELECT e.revision,r.content_release_id AS release_id,v.definition->>'name' AS name,v.definition->'mechanics'->'routineRecipe' AS spec
    FROM runs r JOIN characters c ON c.id=r.character_id JOIN release_entries e ON e.release_id=r.content_release_id
    JOIN content_entities k ON k.id=e.entity_id AND k.kind='RECIPE' JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision
    JOIN discoveries d ON d.entity_id=e.entity_id AND d.account_id=c.account_id
    WHERE r.id=$1 AND c.account_id=$2 AND e.entity_id=$3 AND r.status IN ('ACTIVE','AFTERCORE')`,[runId,accountId,recipeId])).rows[0];
  if(!row || !row.spec)throw new DomainError(404,'RECIPE_NOT_KNOWN');
  return {...row,spec:recipeSpec(row.spec)};
}
async function plan(context:ActionContext,recipeId:string,batches:number,itemIds:string[]){
  const recipe=await knownRecipe(context.client,context.accountId,context.run.id,recipeId);
  if(batches>recipe.spec.maxBatch || itemIds.length!==recipe.spec.inputs.length)throw new DomainError(400,'INVALID_CRAFT_BATCH');
  // All source stacks are locked together in UUID order; no automatic selection or substitutions.
  const items=(await context.client.query(`SELECT i.*,s.run_id,s.lifecycle,c.kind FROM inventory_items i
    JOIN inventory_containers c ON c.id=i.container_id JOIN state_scopes s ON s.id=c.scope_id
    WHERE i.id=ANY($1::uuid[]) ORDER BY i.id FOR UPDATE OF i FOR SHARE OF c,s`,[itemIds])).rows;
  let binding:'TRADEABLE'|'ACCOUNT_BOUND'|'RUN_BOUND'='TRADEABLE';
  for(let n=0;n<itemIds.length;n++){
    const item=items.find(i=>i.id===itemIds[n]),line=recipe.spec.inputs[n]!;
    if(!item || item.run_id!==context.run.id || item.lifecycle!=='ACTIVE' || !['CARRIED','MATERIAL_VAULT','HOME'].includes(item.kind))throw new DomainError(403,'CRAFT_MATERIAL_NOT_OWNED');
    if(item.definition_id!==line.itemId || item.release_id!==recipe.release_id || item.storage_mode!=='STACK' || Number(item.quality)!==1 || item.binding==='SYSTEM_UNTRADEABLE' || (Object.keys(item.metadata).length>0 && (item.source_code!=='ROUTINE_CRAFT' || Object.keys(item.metadata).some(k=>!['craftActionId','recipeId','makerCharacterId','batches'].includes(k)))))throw new DomainError(409,'CRAFT_MATERIAL_INELIGIBLE');
    if(BigInt(item.quantity)<BigInt(line.quantity*batches))throw new DomainError(409,'INSUFFICIENT_ITEM_QUANTITY');
    if(item.binding==='RUN_BOUND')binding='RUN_BOUND';else if(item.binding==='ACCOUNT_BOUND' && binding==='TRADEABLE')binding='ACCOUNT_BOUND';
  }
  const container=(await context.client.query(`SELECT c.id FROM inventory_containers c JOIN state_scopes s ON s.id=c.scope_id
    WHERE s.run_id=$1 AND s.lifecycle='ACTIVE' AND c.kind='CARRIED' FOR SHARE OF c,s`,[context.run.id])).rows[0];
  if(!container)throw new DomainError(409,'CRAFT_OUTPUT_CONTAINER_MISSING');
  return {recipe,binding,containerId:container.id as string};
}
export function craftRoutine(pool:pg.Pool,accountId:string,envelope:Envelope,recipeId:string,batches:number,itemIds:string[]){
  if(!idPattern.test(recipeId) || !Number.isInteger(batches) || batches<1 || batches>100 || !Array.isArray(itemIds) || itemIds.length<1 || itemIds.length>16 || itemIds.some(id=>typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))throw new DomainError(400,'INVALID_CRAFT_BATCH');
  const ids=itemIds.map(id=>id.toLowerCase());if(new Set(ids).size!==ids.length)throw new DomainError(400,'INVALID_CRAFT_BATCH');
  if(envelope.actionType!=='CRAFT_ROUTINE')throw new DomainError(400,'INVALID_CRAFT_ACTION');
  return executeAction(pool,accountId,envelope,{recipeId,batches,itemIds:ids},async context=>{
    if((await context.client.query(`SELECT 1 FROM instance_participants p JOIN instances i ON i.id=p.instance_id
      WHERE p.run_id=$1 AND i.lifecycle='ACTIVE' LIMIT 1`,[context.run.id])).rows.length)throw new DomainError(409,'INSTANCE_STILL_ACTIVE');
    const {recipe,binding,containerId}=await plan(context,recipeId,batches,ids),inputOperations:string[]=[];
    for(let n=0;n<ids.length;n++)inputOperations.push((await consumeItem(context,`craft.input.${n}`,ids[n]!,String(recipe.spec.inputs[n]!.quantity*batches),'ROUTINE_CRAFT_INPUT')).operationId);
    const output=await grantItem(context,'craft.output',{containerId,definitionId:recipe.spec.output.itemId,quantity:String(recipe.spec.output.quantity*batches),quality:'1',binding,sourceCode:'ROUTINE_CRAFT',metadata:{craftActionId:context.actionId,recipeId,makerCharacterId:context.run.character_id,batches}},'ROUTINE_CRAFT_OUTPUT');
    await context.client.query(`INSERT INTO craft_records(action_id,run_id,release_id,recipe_id,definition_revision,batches,output_operation_id)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[context.actionId,context.run.id,recipe.release_id,recipeId,recipe.revision,batches,output.operationId]);
    for(let n=0;n<inputOperations.length;n++)await context.client.query('INSERT INTO craft_inputs(action_id,line_index,operation_id) VALUES($1,$2,$3)',[context.actionId,n,inputOperations[n]]);
    return {recipeId,batches,itemId:output.itemId,quantity:String(recipe.spec.output.quantity*batches),binding,quality:'1',turnCost:0,revision:await advanceRevision(context)};
  });
}
export async function routineRecipeView(pool:pg.Pool,accountId:string,recipeId:string){
  const run=(await pool.query(`SELECT r.id FROM runs r JOIN characters c ON c.id=r.character_id WHERE c.account_id=$1 AND r.status IN ('ACTIVE','AFTERCORE')`,[accountId])).rows[0];
  if(!run)throw new DomainError(409,'NO_RUN');
  const recipe=await knownRecipe(pool,accountId,run.id,recipeId);
  return {recipeId,name:recipe.name,revision:recipe.revision,...recipe.spec,quality:'1',bindingPolicy:'PRESERVE_STRONGEST_INPUT',materialPolicy:'CURRENT_RUN_QUALITY_ONE'};
}
