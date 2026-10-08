import { Ajv } from 'ajv';
import type { ActionContext } from '../foundation/action.js';
import { DomainError } from '../foundation/errors.js';
import type { Json } from '../foundation/json.js';
import { beginEncounter,encounterCheckpoint,drawEncounter,finishEncounter } from './encounters.js';
import { grantItem,validateInventorySpec } from './item-accounting.js';
import type { ContentEntity } from './content.js';

export type LootEntry={itemId:string;weight:number;min:number;max:number;binding:'TRADEABLE'|'ACCOUNT_BOUND'|'RUN_BOUND';quality:string};
export type LootSpec={version:1;commitment:'ENCOUNTER_START';groups:{key:string;chance:{numerator:number;denominator:number};entries:LootEntry[]}[]};
const idPattern='^[a-z][a-z0-9_.-]{2,119}$';
const validator=new Ajv({strict:true,allErrors:true}).compile({type:'object',additionalProperties:false,required:['version','commitment','groups'],properties:{
  version:{const:1,type:'integer'},commitment:{const:'ENCOUNTER_START',type:'string'},groups:{type:'array',minItems:1,maxItems:16,items:{type:'object',additionalProperties:false,required:['key','chance','entries'],properties:{
    key:{type:'string',pattern:'^[a-z][a-z0-9_.-]{0,23}$'},chance:{type:'object',additionalProperties:false,required:['numerator','denominator'],properties:{numerator:{type:'integer',minimum:0,maximum:1000000},denominator:{type:'integer',minimum:1,maximum:1000000}}},
    entries:{type:'array',minItems:1,maxItems:32,items:{type:'object',additionalProperties:false,required:['itemId','weight','min','max','binding','quality'],properties:{
      itemId:{type:'string',pattern:idPattern},weight:{type:'integer',minimum:1,maximum:1000000},min:{type:'integer',minimum:1,maximum:1000000},max:{type:'integer',minimum:1,maximum:1000000},
      binding:{type:'string',enum:['TRADEABLE','ACCOUNT_BOUND','RUN_BOUND']},quality:{type:'string',pattern:'^(0|[1-9][0-9]{0,7})(\\.[0-9]{1,4})?$'}
    }}}
  }}}
}});
export function validateLootSpec(value:unknown): asserts value is LootSpec {
  if(!validator(value)) throw new DomainError(400,'INVALID_LOOT_SPEC');
  const spec=value as LootSpec;
  if(new Set(spec.groups.map(g=>g.key)).size!==spec.groups.length || spec.groups.some(g=>g.chance.numerator>g.chance.denominator ||
    g.entries.some(e=>e.min>e.max || Number(e.quality)<=0))) throw new DomainError(400,'INVALID_LOOT_SPEC');
}
export function validateLootReferences(entity:ContentEntity,entities:Map<string,ContentEntity>){
  const loot=entity.definition.mechanics?.loot;
  if(entity.kind==='LOOT_TABLE' && loot!==undefined){
    validateLootSpec(loot);
    for(const entry of loot.groups.flatMap(g=>g.entries)){
      const item=entities.get(entry.itemId);
      if(!item || item.kind!=='ITEM' || !entity.definition.dependencies.includes(entry.itemId)) throw new DomainError(400,'INVALID_LOOT_ITEM_REFERENCE');
      validateInventorySpec(item.definition.mechanics?.inventory);
      if(item.definition.mechanics!.inventory && (item.definition.mechanics!.inventory as {storageMode:Json}).storageMode==='INSTANCE' && entry.max!==1) throw new DomainError(400,'INVALID_LOOT_INSTANCE_QUANTITY');
    }
  }
  const encounter=entity.definition.mechanics?.encounter as {version?:number;lootTableId?:string}|undefined;
  if(entity.kind==='ENCOUNTER' && encounter?.version===2){
    const table=entities.get(encounter.lootTableId!);
    if(!table || table.kind!=='LOOT_TABLE' || !entity.definition.dependencies.includes(table.id)) throw new DomainError(400,'INVALID_ENCOUNTER_LOOT_REFERENCE');
    validateLootSpec(table.definition.mechanics?.loot);
  }
}
type Reward={key:string;itemId:string;quantity:string;binding:LootEntry['binding'];quality:string};
async function definition(context:ActionContext,id:string){
  const checkpoint=await encounterCheckpoint(context,id);
  const row=(await context.client.query(`SELECT e.*,v.definition->'mechanics'->'encounter' AS spec FROM encounter_records e
    JOIN content_versions v ON v.entity_id=e.definition_id AND v.revision=e.definition_revision WHERE e.instance_id=$1`,[id])).rows[0];
  if(row.spec?.version!==2) throw new DomainError(409,'AUTHORED_LOOT_REQUIRED');
  return {...row,checkpoint};
}
async function commitLoot(context:ActionContext,id:string){
  const encounter=await definition(context,id);
  const table=(await context.client.query(`SELECT e.revision,v.definition->'mechanics'->'loot' AS spec FROM release_entries e
    JOIN content_entities c ON c.id=e.entity_id AND c.kind='LOOT_TABLE'
    JOIN content_versions v ON v.entity_id=e.entity_id AND v.revision=e.revision WHERE e.release_id=$1 AND e.entity_id=$2`,[encounter.release_id,encounter.spec.lootTableId])).rows[0];
  if(!table) throw new DomainError(409,'LOOT_NOT_IN_RULES_SNAPSHOT');
  validateLootSpec(table.spec);const spec:LootSpec=table.spec,rewards:Reward[]=[];
  for(const group of spec.groups){
    if(await drawEncounter(context,id,'loot',`${group.key}.chance`,group.chance.denominator)>=group.chance.numerator) continue;
    const total=group.entries.reduce((sum,e)=>sum+e.weight,0);
    let roll=await drawEncounter(context,id,'loot',`${group.key}.pick`,total);
    const entry=group.entries.find(e=>{if(roll<e.weight)return true;roll-=e.weight;return false;})!;
    const count=entry.min+await drawEncounter(context,id,'loot',`${group.key}.quantity`,entry.max-entry.min+1);
    rewards.push({key:group.key,itemId:entry.itemId,quantity:String(count),binding:entry.binding,quality:entry.quality});
  }
  await context.client.query(`INSERT INTO encounter_reward_plans(instance_id,release_id,loot_table_id,definition_revision,commit_action_id,rewards)
    VALUES($1,$2,$3,$4,$5,$6)`,[id,encounter.release_id,encounter.spec.lootTableId,table.revision,context.actionId,JSON.stringify(rewards)]);
}
// Internal only. Location/quest/combat handlers authorize eligibility and the outcome.
export async function beginAuthoredEncounter(context:ActionContext,definitionId:string,initial:Record<string,Json>){
  const started=await beginEncounter(context,definitionId,initial);
  await commitLoot(context,started.instanceId);
  return started;
}
export async function settleAuthoredVictory(context:ActionContext,id:string,expectedRevision:number){
  const encounter=await definition(context,id);
  return finishEncounter(context,id,expectedRevision,'VICTORY',async c=>{
    const plan=(await c.client.query('SELECT * FROM encounter_reward_plans WHERE instance_id=$1',[encounter.instance_id])).rows[0];
    if(!plan) throw new DomainError(409,'REWARD_PLAN_MISSING');
    const rewards=plan.rewards as Reward[];
    const containers=(await c.client.query(`SELECT b.id FROM inventory_containers b JOIN state_scopes s ON s.id=b.scope_id
      WHERE s.run_id=$1 AND s.lifecycle='ACTIVE' AND b.kind='CARRIED' AND b.label=''`,[c.run.id])).rows;
    if(rewards.length && containers.length!==1) throw new DomainError(409,'REWARD_CONTAINER_MISSING');
    await c.client.query('INSERT INTO encounter_reward_claims(instance_id,action_id) VALUES($1,$2)',[encounter.instance_id,c.actionId]);
    const issued=[];
    for(const reward of rewards){
      const item=await grantItem(c,`loot.${reward.key}`,{containerId:containers[0]!.id,definitionId:reward.itemId,quantity:reward.quantity,quality:reward.quality,binding:reward.binding,sourceCode:'ENCOUNTER_LOOT',
        metadata:{encounterId:encounter.instance_id,lootTableId:plan.loot_table_id,group:reward.key}},'ENCOUNTER_REWARD');
      await c.client.query('INSERT INTO encounter_reward_items(instance_id,reward_key,operation_id) VALUES($1,$2,$3)',[encounter.instance_id,reward.key,item.operationId]);
      issued.push({key:reward.key,...item});
    }
    return {items:issued};
  });
}
